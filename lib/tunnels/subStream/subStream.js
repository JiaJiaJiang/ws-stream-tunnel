/*
Copyright luojia@luojia.me
MIT LICENSE
*/

/*
When a subStream is created at one side,a message will be sent to another side to create it there,
then a 'stream started' message will be sent back,and the subStream established.
Manner of the 'close' is similar with 'start'.

stream frame
	bits
	0-2 	0:data frame 		1:start stream 		2:close stream 
		 	4:stream started 	*5:closed frame 		6:error frame
	3-4		reserved
	5-7	 	id bytes count following,0-4 bytes(0 for id 0)
	...		id
	...		data

if the sid is 0,there is no following idBytes

data of:
	data frame:data to be transported
	start frame:none
	close frame:none
	started frame:none
	//closed frame:none
	error frame:msg


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
	//CLOSING:2,
	CLOSED:3,
};

/*
SubStream class is just used to save values about the substream,
you can just use the .stream without caring about the subStream.
The tunnel's 'stream_open' event will take the .stream as the arg.
*/


class SubStream extends events{
	constructor(sid,stream,tunnel){
		super();
		if(!SubStream.isValidSubStreamID(sid))throw(new Error('SubStream id is not valid:'+sid));
		Object.defineProperty(this,'stream',{value:stream,enumerable:true,configurable:true});//stream for reading data to send and writing received data
		if(!this.stream)throw(new Error('No stream provided'));
		this.stream._subStream=this;

		this._retry=0;
		this.sid=sid;
		this.tunnel=tunnel;
		this.state=SubStream.STARTING;//default to the starting state
		this._closeMark=false;


		stream._write=(data,encoding,callback)=>{
			tunnel._send(0,this.sid,data,(err)=>{//sned data frame
				callback(err||null);
			});
		};
		stream.once('finish',e=>{//send close stream frame
			if(this.state===SubStream.CLOSED){;return;}
			this._close();
		}).once('end',e=>{//send close stream frame
			this._close();
		}).once('error',e=>{
			if(e.name==='RemoteError'){
				//do nothing
			}else{//local error
				//send error frame to remote
				tunnel._errorMsg(sid,(e instanceof Error)?e.message:e||'no msg');
				tunnel.emit('stream_error',stream,e);
			}
			this._close();
		});
	}
	_open(){
		this.state=SubStream.STARTED;
		this.emit('open',this.stream);
	}
	_close(){//invoked when stream ended
		if(this.state===SubStream.CLOSED)return;

		if(!this._closeMark){
			this.tunnel._send(2,this.sid);//close frame
		}
		this.state=SubStream.CLOSED;
		if(this.stream.readable)this.stream.push(null);
		if(this.stream.writable)this.stream.end();
		this.emit('close');
		setImmediate(()=>{
			this.tunnel=null;
			this.stream._write=null;
			this.stream._subStream=null;
			Object.defineProperty(this,'stream',{value:null,enumerable:true,configurable:true});//stream for reading data to send and writing received data
		});
	}




	static frameParser(buffer){
		let idBytes=buffer[0]&0b111,frame={};
		frame.type=buffer[0]>>>5;
		frame.sid=0;
		if(idBytes!==0){
			for(let i=idBytes,bytes=idBytes;i--;bytes--){//get id
				frame.sid+=((buffer[bytes]<<((bytes-1)*8))>>>0);
			}
		}
		if(buffer.byteLength>1+idBytes){
			frame.data=buffer.slice(1+idBytes);
			if(frame.type===6)frame.data=frame.data.toString();
		}
		return frame;
	}
	static frameHead(type,sid){//type(number) sid(number). return a frame head buffer
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
		head[0]|=idBytes;//set idBytes
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