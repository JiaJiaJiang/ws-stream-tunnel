/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const subStreamTunnel=require('../subStream/subStreamTunnel.js').tunnel;


class streamTunnel extends subStreamTunnel{
	constructor(){
		super();
		this.reuse=false;
		this.name='streamTunnel';
		this.maxSubStream=1;
		this.on('stream_close',()=>{
			if(!this.reuse&&this.count()===0){//if not for resuing and there no stream in this tunnel,close it
				this.close();
			}
		});
	}
	createStream(stream){
		return this.createSubStream(stream,0).stream;//create a subStream with sid 0
	}
}

exports.tunnel=streamTunnel;