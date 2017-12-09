/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

/*
subStream messages
	subStreams' creating,closing and error are binary frames.
	subStream creating demo
		→start
		←started
		→←stream data frames
		(→←)error frames(will casuse the stream being closed)
		→←close
		←→closed

if one side receives a close frame when it is closing,send an error frame back
*/

const {SubStream}=require('./subStream.js'),
		{ioStream}=require('../../ioStream.js'),
		{tunnelManager}=require('../../tunnel.js');

const noCompressOpt={compress:false};

/*
events
	tunnelManager events
*/
class subStreamTunnel extends tunnelManager{
	constructor(){
		super();
		this.name='subStreamTunnel';
		this._currentID=1;//max is 4294967295
		this.minBytesToCompress=128;
		this.subStreams=new Map();
		this.maxSubStream=0;//limit max number of subStreams,0 as unlimited
		this.closed=false;

	}
	count(){//count steam number in this tunnel
		return this.subStreams.size;
	}
	_genSubStreamID(){
		if(this.subStreams.size===4294967296)return false;
		while(this.subStreams.has(this._currentID)){
			this._currentID++;
			if(this._currentID>=4294967296)this._currentID=1;
		}
		return this._currentID;
	}
	_send(type,sid,data,callback){
		let datas=[SubStream.frameHead(type,sid)];
		if(!isEmptyData(data)){
			if(typeof data==='string')data=Buffer.from(data);
			datas.push(data);
		}
		let buf=datas.length>1?Buffer.concat(datas):datas[0];
		this._sendViaCache(buf,buf.byteLength<this.minBytesToCompress?noCompressOpt:null,callback);
	}
	createStream(stream){
		return this.createSubStream(stream).stream;
	}
	createSubStream(stream,sid){//note:the stream's _write method will be overwritten
		if(this.maxSubStream && this.subStreams.size>=this.maxSubStream)
			throw(new Error('up to stream limit'));
		if(sid===undefined){
			sid=this._genSubStreamID();
			if(sid===false)
				throw(new Error('no rest id'));
		}else{
			if(this.subStreams.has(sid))
				throw(new Error('sid exists'));
		}
		if(!stream)stream=new ioStream();

		let sub=this._newSubStream(sid,stream,this);
		this._send(1,sid);
		return sub;
	}
	_newSubStream(sid,stream){
		stream.cork();//keep writing-in data in buffer before stream established
		let sub=new SubStream(sid,stream,this);
		sub.state=SubStream.STARTING;
		this.subStreams.set(sid,sub);
		sub.once('open',()=>{
			sub.stream.uncork();
			stream.emit('tunnel_stream_open');
			this.emit('stream_open',sub.stream);
		}).once('close',()=>{//delete from list when closed
			if(this.subStreams.get(sub.sid)===sub){
				this.subStreams.delete(sub.sid);
				//if(sub.sid<this._currentID)this._currentID=sub.sid;
			}
			stream.emit('tunnel_stream_close');
			this.emit('stream_close',sub.stream);
		}).once('error',e=>{
			this.emit('stream_error',sub.stream,e);
		});
		return sub;
	}
	close(reason){//should be invoked by server or client
		if(this.closed===true)return false;
		this.closed=true;
		this.closeAllStreams(reason);
		super.close();
	}
	closeAllStreams(reason){
		if(this.subStreams.size===0)return;
		for(let [sid,sub] of this.subStreams){
			if(sub.stream.readable){
				sub.stream.destroy(Error('Force close:'+(reason||'no reason')));
			}else if(sub.stream.writable){
				sub.stream.destroy(Error('Force close:'+(reason||'no reason')));
			}
		}
	}
	_errorMsg(sid,msg){
		if(!msg)
			throw(new Error('Error frame must contains a message'));
		this._send(6,sid,msg);
	}
	receive(data){//message from websocket
		if(!Buffer.isBuffer(data)){
			this.emit('invalid_data',data);
			return;
		}
		let frame=SubStream.frameParser(data);
		let sid=frame.sid,
			sub=this.subStreams.get(sid);
		switch(frame.type){
			case 0:{//data frame
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(sid,'Stream not exists');
					return;
				}else if(sub.state!==SubStream.STARTED){
					this._errorMsg(sid,'Stream not started');
					return;
				}
				if(!sub.stream.writable){
					//this._errorMsg(sid,'Stream not writable');
					return;
				}
				sub.stream.push(frame.data);
				return;
			}
			case 1:{//start frame
				if(sub){
					// this._errorMsg(sid,'Stream already exists');
					sub.stream.destroy(Error('disappeared from remote'));
					// return;
				}
				sub=this._newSubStream(sid,new ioStream(),this);
				this._send(4,sid);
				sub._open();
				return;
			}
			case 2:{//close frame
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(sid,'Stream not exists : '+sid);
					return;
				}else if(sub.state!==SubStream.STARTED){
					this._errorMsg(sid,'Closing a not started stream');
					return;
				}
				sub._closeMark=true;
				sub._close();
				return;
			}
			case 4:{//stream started frame
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(sid,'Stream not exists');
					return;
				}else if(sub.state!==SubStream.STARTING){
					this._errorMsg(sid,'Stream not at starting state');
					return;
				}
				sub._open();
				return;
			}
			/*case 5:{
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(sid,'Stream not exists');
					return;
				}
				if(sub.state!==sub.CLOSING)return;
				return;
			}*/
			case 6:{//error frame
				if(!sub)return;
				switch(sub.state){
					case SubStream.STARTING:{
						if(sub._retry>=4294967296){
							sub.stream.destroy(Error('Up to retry limit'));
							return;
						}
						sub._retry++;
						this.subStreams.delete(sid);
						let nsid=this._genSubStreamID();//re-generate an id
						sub.sid=nsid;
						this._send(1,nsid);
						this.subStreams.set(nsid,sub);//change the sid
						break;
					}
					case SubStream.STARTED:{
						let e=Error(String(frame.data));
						e.name='RemoteError';
						sub.stream.destroy(e);
						break;
					}
				}
				return;
			}
		}
	}
}



function isEmptyData(data){
	if(data instanceof ArrayBuffer || ArrayBuffer.isView(data)){
		if(data.byteLength===0)return true;
	}else if(typeof data === 'string'){
		if(data === '')return true;
	}else{
		return true;
	}
	return false;
}

exports.tunnel=subStreamTunnel;