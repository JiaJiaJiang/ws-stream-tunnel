/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const {SubStream}=require('./subStream.js'),
		{ioStream}=require('../../ioStream.js'),
		{tunnelManager}=require('../../tunnel.js');


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
		this.highWaterMark=10485760;//10MB
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
		this._sendViaCache(SubStream.frame(type,sid,data),callback);
	}
	createStream(stream=null){//get a new stream
		return this.createSubStream(stream).stream;
	}
	createSubStream(stream=null,sid=this._genSubStreamID()){//note:the stream's _write method will be overwritten
		if(this.maxSubStream && this.subStreams.size>=this.maxSubStream)
			throw(new Error('up to stream limit'));

		if(sid===false)
			throw(new Error('no rest id'));
		else if(this.subStreams.has(sid))
			throw(new Error('sid exists'));

		if(!stream)stream=new ioStream({highWaterMark:this.highWaterMark});

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
			sub.stream.uncork();//release corked buffer
			sub.stream.emit('tunnel_stream_open');
			this.emit('stream_open',sub.stream);
		}).once('close',()=>{//delete from list when closed
			if(this.subStreams.get(sub.sid)===sub){
				this.subStreams.delete(sub.sid);
				//if(sub.sid<this._currentID)this._currentID=sub.sid;
			}
			//send a close frame if the stream is closed on this side
			if(!sub._closeMark)this._send(2,sub.sid);
			sub.stream.emit('tunnel_stream_close');
			this.emit('stream_close',sub.stream);
		}).once('error',e=>{
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
	closeAllStreams(reason){
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
	_dataMsg(sid,data,callback){
		//send data frame
		this._send(0,sid,data,err=>callback&&callback(err||null));
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
					sub.stream.push(frame.data);
				}
				return;
			}
			case 1:{//start frame
				if(sub){
					//destroy the existing stream
					sub.stream.destroy(Error('disappeared from remote'));
				}
				sub=this._newSubStream(frame.sid,new ioStream({highWaterMark:this.highWaterMark}),this);
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
			case 6:{//error frame
				if(!sub)return;
				switch(sub.state){
					case SubStream.STARTING:{
						if(sub._retry>=50){
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
		}
	}
}


exports.tunnel=subStreamTunnel;