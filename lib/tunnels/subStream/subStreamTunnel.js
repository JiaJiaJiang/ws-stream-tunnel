/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const {SubStream}=require('./subStream.js'),
		{ioStream}=require('../../ioStream.js'),
		{Tunnel}=require('../../tunnel.js');


/*
events
	Tunnel events
*/
class subStreamTunnel extends Tunnel{
	constructor(){
		super();
		this.name='subStreamTunnel';
		this._currentID=0;//max is 4294967295
		this.subStreams=new Map();//sid => subStream
		this.maxSubStream=0;//limit max number of subStreams,0 as unlimited
	}
	count(){//count steam number in this tunnel
		return this.subStreams.size;
	}
	_genSubStreamID(){
		if(this.subStreams.size===4294967296)return false;
		do{
			this._currentID++;
			if(this._currentID>=4294967296)this._currentID=0;
		}while(this.subStreams.has(this._currentID));
		return this._currentID;
	}
	_send(type,sid,data,callback){
		return this.cacheStream.write(SubStream.frame(type,sid,data),callback);
	}
	createStream(stream=null){//get a new stream
		return this.createSubStream(stream).stream;
	}
	createSubStream(stream=null,sid=this._genSubStreamID()){//note:the stream's _write method will be overwritten
		if(!stream)stream=new ioStream();

		let sub=this._newSubStream(sid,stream);
		this._send(1,sid);
		return sub;
	}
	_newSubStream(sid,stream){
		if(this.maxSubStream && this.subStreams.size>=this.maxSubStream)
			throw(new Error('up to stream limit'));
		if(sid===false)
			throw(new Error('no rest id'));
		else if(this.subStreams.has(sid))
			throw(new Error('sid exists'));

		stream.cork();//keep writing-in data in buffer before stream established
		let sub=new SubStream(sid,stream,this);
		this.subStreams.set(sid,sub);
		sub.once('close',()=>{//delete from list when closed
			if(this.subStreams.get(sub.sid)===sub){
				this.subStreams.delete(sub.sid);
			}
			//send a close frame if the stream is closed on this side
			if(!sub._closeMark){
				sub.state=SubStream.CLOSING;
				this._send(2,sub.sid);
			}
		});
		sub.stream.once('error',e=>{
			if(e.name==='RemoteError'){
				//do nothing
			}else{//local error
				//send error frame to remote
				this._errorMsg(sub.sid,(e instanceof Error)?e.message:e||'no msg');
			}
			this.emit('stream_error',sub.stream,e);
		});
		return sub;
	}
	clearTunnelStream(reason){
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
			throw(new Error('Error frame must contain a message'));
		this._send(6,sid,msg);
	}
	receive(data){//message from websocket
		let frame=SubStream.frameParser(data),
			sub=this.subStreams.get(frame.sid);
		switch(frame.type){
			case 0:{//data frame
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(frame.sid,'Stream not exists');
					return;
				}else if(sub.state!==SubStream.STARTED){
					this._errorMsg(frame.sid,'Stream not started');
					return;
				}
				if(sub.stream.readable){
					sub.data(frame.data);
				}
				return;
			}
			case 1:{//start frame
				if(sub){
					//destroy the existing stream
					sub.stream.destroy(Error('disappeared from remote'));
				}
				try{
					sub=this._newSubStream(frame.sid,new ioStream());
				}catch(e){
					this._send(6,frame.sid);//send started frame
					return;
				}
				this._send(4,frame.sid);//send started frame
				sub._open();
				return;
			}
			case 2:{//close frame
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(frame.sid,'Stream not exists : '+frame.sid);
					return;
				}else if(sub.state!==SubStream.STARTED){
					this._errorMsg(frame.sid,'Closing a not started stream');
					return;
				}
				sub._closeMark=true;//closed by remote
				sub._close();
				this._send(5,sub.sid);
				return;
			}
			case 4:{//stream started frame
				if(!sub){//stream not exists,send back an error frame
					this._errorMsg(frame.sid,'Stream not exists');
					return;
				}else if(sub.state!==SubStream.STARTING){
					this._errorMsg(frame.sid,'Stream not at starting state');
					return;
				}
				sub._open();
				return;
			}
			case 5:{//stream closed frame
				if(!sub){//stream not exists,ignore
					return;
				}else if(sub.state!==SubStream.CLOSING){
					this._errorMsg(frame.sid,'Stream not at closing state');
					return;
				}
				sub.state=null;
				sub._close();
				return;
			}
			case 6:{//error frame
				if(!sub)return;
				switch(sub.state){
					case SubStream.STARTING:{
						if(sub._retry>=10){
							sub.stream.destroy(Error('Up to retry limit'));
							return;
						}
						sub._retry++;
						this.subStreams.delete(frame.sid);//remove the old sid
						sub.sid=this._genSubStreamID();//re-generate an id
						this._send(1,sub.sid);//restart the stream
						this.subStreams.set(sub.sid,sub);//set the new sid
						break;
					}
					case SubStream.STARTED:{
						let e=Error(String(frame.data));
						e.name='RemoteError';//define as a remote error
						sub.stream.destroy(e);
						break;
					}
				}
				return;
			}
			case 7:{//read frame
				if(!sub)return;
				let readSize=frame.data?frame.data.readUIntBE(0,frame.data.byteLength):0;
				sub.setReadSize(readSize);
				return;
			}
		}
	}
}

exports.tunnel=subStreamTunnel;