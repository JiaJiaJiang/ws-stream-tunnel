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
		this.maxSubStream=1;
	}
	createStream(stream){
		return this.createSubStream(stream,0).stream;//create a subStream with sid 0
	}
}

exports.tunnel=streamTunnel;