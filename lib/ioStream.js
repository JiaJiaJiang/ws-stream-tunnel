/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const {Duplex}=require('stream');

class ioStream extends Duplex{
	constructor(){
		super({allowHalfOpen:false});
		this.closed=false;
		this.on('end',()=>{
			this._close();
		});
	}
	_close(err){
		if(this.closed)return;
		this.emit('close',err);
		this.closed=true;
	}
	_write(){}//to be overwritten
	_read(){
		//do nothing cause the stream just waits for remote data here,nothing to fetch
		//the source should push data to this stream on its own
	}
}

exports.ioStream=ioStream;
