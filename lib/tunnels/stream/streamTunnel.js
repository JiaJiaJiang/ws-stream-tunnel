/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const subStreamTunnel=require('../subStream/subStreamTunnel.js').tunnel;


class streamTunnel extends subStreamTunnel{
	constructor(){
		super();
		this.name='streamTunnel';
		this.reuse=false;//not allow reuse by default
		this.maxSubStream=1;//only allows 1 stream
		this.on('stream_close',()=>{
			if(!this.reuse&&this.count()===0){//if not for resuing and no stream in this tunnel,close it
				setImmediate(()=>this.close());
			}
		});
	}
	createStream(stream){
		return this.createSubStream(stream,0).stream;//create a subStream with sid 0
	}
}

exports.tunnel=streamTunnel;