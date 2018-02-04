/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const events=require('events');

/*
events
	close
	open

properties
	sid
	tunnel : the tunnel which the subStream is in
	state : state of the subStream
	stream : the stream for write and read data
*/

/*
To close a subStream,just use sub.stream.end().
When the stream is closed,the subStream will be closed too.
*/
const states={
	STARTING:0,
	STARTED:1,
	CLOSED:3,
};

/*
SubStream class is just used to save state of the substream.
The subStream instance should not appear in places other than subStreamTunnel class.
The tunnel's 'stream_open' event will take subStream.stream as the arg.
*/


class SubStream extends events{
	constructor(sid,stream,tunnel){
		super();
		if(!SubStream.isValidSubStreamID(sid))
			throw(new Error('SubStream id is not valid:'+sid));
		this.stream=stream;//stream for reading data to send and writing received data
		this.tunnel=tunnel;
		if(!this.stream)throw(new Error('No stream provided'));

		this._retry=0;//retry count of stream creating failure
		this.sid=sid;
		this.state=SubStream.STARTING;//default to the starting state
		this._closeMark=false;//be true when received close frame,so we can know which side closed the stream


		stream._write=(...args)=>this._send(...args);
		stream.once('finish',e=>{
			this._close();
		}).once('end',e=>{
			this._close();
		}).once('error',e=>{
			this.emit('error',e);
			this._close();
		});
	}
	_send(data,encoding,callback){
		this.tunnel._dataMsg(this.sid,data,callback);
	}
	_open(){//to be invoked by outer code
		this.state=SubStream.STARTED;
		this.emit('open',this.stream);
	}
	_close(){//invoked when stream closed
		if(this.state===SubStream.CLOSED)return;

		this.state=SubStream.CLOSED;
		if(this.stream.readable)this.stream.push(null);
		if(this.stream.writable)this.stream.end();
		this.emit('close');
		setImmediate(()=>this.stream=null);
	}




	static frameParser(buf){//parse the frame
		let idBytes=buf[0]&0b111,type=buf[0]>>>5,sid=0;
		//calc the id
		if(idBytes===2){
			sid=(buf[1]<<8) + buf[2];
		}else if(idBytes===4){
			sid=(buf[1]<<24>>>0) + (buf[2]<<16) + (buf[3]<<8) + buf[4];
		}
		return {type,sid,data:(buf.byteLength>1+idBytes)?buf.slice(1+idBytes):null};
	}
	static frame(type,sid,data){//type(number) sid(number). build a frame buffer
		let datas=[],
			idBytes=0,
			dataLength=data?data.byteLength:0;
		if(sid){
			if(sid<16777216){
				idBytes=2;
			}else{
				idBytes=4;
			}
		}
		let buf=Buffer.allocUnsafe(idBytes+1+dataLength);
		buf[0]=(type<<5)|idBytes;//set type and idBytes count
		//set sid
		if(idBytes===2){
			buf[1]=sid>>>8;
			buf[2]=sid&0xFF;
		}else if(idBytes===4){
			buf[1]=sid>>>24;
			buf[2]=(sid>>>16)&0xFF;
			buf[3]=(sid>>>8)&0xFF;
			buf[4]=sid&0xFF;
		}
		dataLength&&data.copy(buf,idBytes+1);
		return buf;
	}
	static isValidSubStreamID(id){
		return	Number.isInteger(id)&&id>=0&&id<4294967296;//sid 0 is reserved
	}
}

for(let s in states)SubStream[s]=states[s];

exports.SubStream=SubStream;