/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const {Duplex}=require('stream');

const defaultChunkSize=24576;//24k

const forceOpt={
	allowHalfOpen:false,
};
const ioStreamOpt={
	highWaterMark:12,
	objectMode:true,
};
const emptyObj={};

class ioStream extends Duplex{
	constructor(opt=emptyObj){
		super(Object.assign({},ioStreamOpt,opt,forceOpt));

		this.chunkSize=opt.chunkSize||defaultChunkSize;
	}
	_writev(chunks, callback, processed){
		if(!processed){
			let tmp=[],count=0,newChunks=[];
			for(let i=chunks.length;i--;){
				chunks[i]=chunks[i].chunk;
			}
			while(chunks.length){
				let c=chunks.shift(),randSize;
				if((count+=c.byteLength) <= this.chunkSize+4096){
					tmp.push(c);
				}else{
					if(tmp.length!==0){
						if(tmp.length===1){
							newChunks.push(tmp[0]);
						}else{
							newChunks.push(Buffer.concat(tmp));//combine small chunks
						}
						count=tmp.length=0;
					}
					if(c.byteLength <= this.chunkSize){
						newChunks.push(c);
					}
					else{
						while(c.byteLength >= this.chunkSize){//slice too large chunks
							randSize=(this.chunkSize*(1-0.3*Math.random()))|0;
							newChunks.push(c.slice(0,randSize));
							c=c.slice(randSize);
						}
						c.byteLength&&chunks.unshift(c);
					}
				}
			}
			if(tmp.length)newChunks.push(Buffer.concat(tmp));
			chunks.length=0;
			chunks=newChunks;
		}
		let c;
		while(c=chunks.shift()){
			if(chunks.length===0){
				return this._write(c,null,callback);
			}else{
				return this._write(c,null,e=>{
					if(e){
						chunks.length=0;//clear the array
						callback(e);
						return;
					}
					this._writev(chunks,callback,true);
				});
			}
		}
	}
	_write(){}//to be overwritten
	_read(){
		//do nothing cause the stream just waits for remote data here,nothing to fetch
		//the source should push data to this stream on its own
	}
}

exports.ioStream=ioStream;
