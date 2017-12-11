/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const {Duplex}=require('stream');

const forceOpt={
	allowHalfOpen:false,//not allow half open
};
const ioStreamOpt={
	highWaterMark:10485760,//10MB
};

class ioStream extends Duplex{
	constructor(opt){
		super(Object.assign({},ioStreamOpt,opt,forceOpt));
		this.closed=false;
	}
	_write(){}//to be overwritten
	_read(){
		//do nothing cause the stream just waits for remote data here,nothing to fetch
		//the source should push data to this stream on its own
	}
}

exports.ioStream=ioStream;
