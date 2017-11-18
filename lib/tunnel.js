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
const emptyOpt={}

/*
events
	error:(error)
*/
class tunnelManager extends events{
	constructor(){
		super();
		this.name='tunnelManager';
		this._genTunnelID();
		this.cache=null;
		this.closed=false;
		this.timeout=60000;
		this.cacheEnd=null;
		this.cacheCount=0;
		this.cacheSending=false;
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
	_addCache(data,options,callback){
		if(this.cacheEnd===null){
			this.cache=this.cacheEnd={data,options,callback,next:null};
		}else{
			this.cacheEnd=this.cacheEnd.next={data,options,callback,next:null};
		}
		this.cacheCount++;
	}
	_removeFirstCache(){
		if(this.cache===null)return;
		this.cache=this.cache.next;
		if(this.cache===null)this.cacheEnd=null;
		this.cacheCount--;
		if(this.cacheCount<0)
			throw(new Error('cache count error:'+this.cacheCount));
	}
	_sendCache(){
		if(this.cache===null || !this.send || this.cacheSending)return;
		this.cacheSending=true;
		//console.log('cache',this.cache)
		try{
			this.send(this.cache.data,this.cache.options||emptyOpt,()=>{
				this.cacheSending=false;
				if(this.cache.callback){
					try{
						this.cache.callback();
					}catch(e){
						this.emit('error',e);
					}
				}
				this._removeFirstCache();
				this.cache&&this._sendCache();
			});
		}catch(e){
			this.cacheSending=false;
			console.error(e);
		}
		
	}
	_sendViaCache(data,options,callback){//all data to be sent from sub class must use this method,unless the data is allowed to be lost
		this._addCache(data,options,callback);
		setImmediate(()=>{this._sendCache()});
	}
	send(data,options,callback){}//to be overwritten,send data through ws
	receive(data){}//to be overwritten,receive message from ws
	close(){}
}


function conv(n,o,t,olist,tlist){
    var dlist='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
        tnum=[],m,negative=((n+='').trim()[0]=='-'),decnum=0;
    olist||(olist=dlist);
    tlist||(tlist=dlist);
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

debugger;