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
SubStream class is just used to save values of the substream.
The subStream instance should not appear in places other than subStreamTunnel class.
The tunnel's 'stream_open' event will take .stream as the arg.
*/


class SubStream extends events{
	constructor(sid,stream){
		super();
		if(!SubStream.isValidSubStreamID(sid))
			throw(new Error('SubStream id is not valid:'+sid));
		this.stream=stream;//stream for reading data to send and writing received data
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
	_send(data,encoding,callback){}//to be overwritten
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
		setImmediate(()=>{
			this.stream=null;
		});
	}




	static frameParser(buffer){//parse the frame
		let idBytes=buffer[0]&0b111,frame={};
		frame.type=buffer[0]>>>5;
		frame.sid=0;
		if(idBytes!==0){//calc the id
			for(let i=idBytes,bytes=idBytes;i--;bytes--){//get id
				frame.sid+=((buffer[bytes]<<((bytes-1)*8))>>>0);
			}
		}
		if(buffer.byteLength>1+idBytes){//still has extra bytes
			frame.data=buffer.slice(1+idBytes);
			if(frame.type===6)frame.data=frame.data.toString();
		}
		return frame;
	}
	static frameHead(type,sid){//type(number) sid(number). construct a frame head buffer
		let datas=[],
			idBytes=0;
		if(!SubStream.isValidSubStreamID(sid))
			throw(new Error('Invalid sid:'+sid));
		if(sid>=65536){
			if(sid>=16777216)idBytes=4;
			else{idBytes=3;}
		}else{
			if(sid>=256){idBytes=2;}
			else if(sid>0){idBytes=1;}
		}
		let head=Buffer.alloc(idBytes+1);
		head[0]=type<<5;//set type
		head[0]|=idBytes;//set idBytes count
		//set sid
		for(let byte=idBytes;byte;byte--){
			head[byte]=(sid>>>((idBytes-byte)*8))&0xFF;
		}
		return head;
	}
	static isValidSubStreamID(id){
		return	Number.isInteger(id)&&id>=0&&id<4294967296;//sid 0 is reserved
	}
}

for(let s in states)SubStream[s]=states[s];

exports.SubStream=SubStream;