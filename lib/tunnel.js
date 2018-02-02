/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const events=require('events');

/*
tunnelManager is used to manage subStream on both client and server side

when a tunnel is created on one side,the same tunnel will be created on another side,
a json message will be sent from the client before the tunnel created,to configure the tunnel type
{
	_:'create',
	mode:'subStream',//subStream  
	timeout:the timeout to wait aftfer connectionn lost before force closing the tunnel,defaults to 60000ms
}
or use an existing tunnel
{
	_:'use',
	id:tunnel id
}

then another side send back a json of the result
{
	_:'created' || 'error'
	msg:id||reason,
}
*/
const emptyOpt={};


class cacheObj{
	constructor(data,cb){
		this.data=data;
		this.callback=cb;
		this.next=null;
	}
}

/*
events
	error:(error)
	close
	invalid_data:(data)
	stream_open:(stream)
	stream_close:(stream)
*/
class tunnelManager extends events{
	constructor(){
		super();
		this.name='tunnelManager';
		this.closed=false;
		this.timeout=60000;

		this.cache=null;
		this.cacheEnd=null;
		this.cacheCount=0;
		this.cacheSending=false;

		this.scheduleTimer=0;

		this._sendCache=this._sendCache.bind(this);

		this._genTunnelID();

		this._close=()=>{this.close();};
		process.once('exit',this._close);
		process.on('SIGINT',()=>{
			process.exit(0);
		});
	}
	setID(id){
		Object.defineProperty(this,'id',{
			value:id,
			enumerable:true,
			configurable:true,
		});
	}
	_genTunnelID(){
		this.setID(`${conv(Date.now(),10,62)}-${conv(Math.round(Math.random()*14776335),10,62)}-${conv(process.cpuUsage().user,10,62)}`);
	}
	_addCache(data,callback){
		if(this.cacheEnd===null){
			this.cache=this.cacheEnd=new cacheObj(data,callback);
		}else{
			this.cacheEnd=this.cacheEnd.next=new cacheObj(data,callback);
		}
		this.cacheCount++;
		this.cacheSending||setImmediate(this._sendCache);
	}
	_removeFirstCache(){
		if(this.cache===null){//this should not happen
			throw(new Error('no cache to remove'));
		}
		this.cache=this.cache.next;
		if(this.cache===null)this.cacheEnd=null;
		this.cacheCount--;
		if(this.cacheCount<0)//this should not happen
			throw(new Error('cache count error:'+this.cacheCount));
	}
	_sendCache(){
		if(this.cacheSending|| !this.send  || !this.sendable() || this.cache===null)return;
		this.cacheSending=true;
		let cbc=0;
		let cache=this.cache;
		this.send(cache.data,emptyOpt,err=>{
			this.cacheSending=false;
			cbc++;
			if(cbc>1)throw(Error('a callback is called more than one time:'+cbc));
			if(err && !this.scheduleTimer){
				this.scheduleTimer=setTimeout(()=>{
					this.scheduleTimer=0;
					this._sendCache();
				},600);
				return;
			}
			if(cache===this.cache)this._removeFirstCache();
			else{
				this.emit('error',Error('Wrong cache order'));
				return;
			}
			if(cache.callback){
				cache.callback();
			}
			setImmediate(this._sendCache);
		});
		
	}
	_open(){
		setImmediate(this.emit.bind(this,'open'));
	}
	_sendViaCache(data,callback){//all data to be sent from sub class must use this method,unless the data is allowed to be lost
		this._addCache(data,callback);
	}
	sendable(){return true;}//to be overwritten
	send(data,options,callback){}//to be overwritten in server or client class.sends data through ws
	count(){}////to be overwritten by sub class,return steam number in this tunnel
	receive(data){}//to be overwritten by sub class,receive message from ws
	createStream(){}//to be overwritten by sub class,the common method to create a stream
	closeAllStreams(){}//to be overwritten by sub class
	close(reason){
		if(this.closed===true)return false;
		this.closed=true;
		this.closeAllStreams(reason);
		this.emit('close');
		process.removeListener('exit',this._close);
	}
}


//number convert
var defaultList='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function conv(n,o,t,olist,tlist){
    var tnum=[],m,negative=((n+='').trim()[0]=='-'),decnum=0;
    olist||(olist=defaultList);
    tlist||(tlist=defaultList);
    if(negative)n=n.slice(1);
    for(var i=n.length;i--;)
        decnum+=olist.indexOf(n[i])*Math.pow(o,n.length-i-1);
    for(;decnum!=0;tnum.unshift(tlist[m])){
        m=decnum%t;
        decnum=Math.floor(decnum/t);
    }
    decnum&&tnum.unshift(tlist[decnum]);
    return (negative?'-':'')+tnum.join('');
}

module.exports={
	tunnelManager,
}

