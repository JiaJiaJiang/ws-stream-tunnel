/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const events=require('events');

const Tunnel={
	stream:'./tunnels/stream/streamTunnel.js',
	subStream:'./tunnels/subStream/subStreamTunnel.js',
};

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
	//invalid_data:(data)
	stream_open:(stream)
	stream_close:(stream)
*/
class tunnelManager extends events{
	constructor(){
		super();
		this.name='tunnelManager';
		this.closed=false;
		this.timeout=60000;
		this.reuse=false;//false:the connection will be closed after tunnel closed. true:the connection won't be closed

		this.cache=null;
		this.cacheEnd=null;
		this.cacheCount=0;
		this.cacheSending=false;

		this.scheduleTimer=0;

		this._sendCache=this._sendCache.bind(this);

		this._genTunnelID();

		this._close=()=>{this.close();};
		process.once('exit',this._close);
		process.once('SIGINT',()=>{
			this.close();
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
		// let cbc=0;
		let cache=this.cache;
		this.send(cache.data,emptyOpt,err=>{
			this.cacheSending=false;
			// cbc++;
			// if(cbc>1)throw(Error('a callback is called more than one time:'+cbc));
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




/*
tunnelHelper
	help to establish tunnels and transport data
*/
const tunnelErrorCodes={
	4000:'Cannot parse the data',
	4001:'Tunnel already created',//this is an impossible error unless there is something wrong in code
	4002:'Not allowed tunnel mode',
	4003:'Not supported tunnel mode',
	4004:'Tunnel of id not exsts',
	4005:'Wrong configuration msg',
	4006:'Binary data received before creating tunnel',
},tunnelErrorMsgs={};
for(let code in tunnelErrorCodes){
	tunnelErrorMsgs[code]=JSON.stringify({_:'error',code:code,msg:tunnelErrorCodes[code]});
}


/*
events
	tunnel
*/
class tunnelHelper extends events{
	constructor(){
		super();
		this.tunnels=new Map();//ws.tunnelID=>tunnel
		this.tunnelID=new WeakMap();//object=>tunnel id
		this.tunnelToObj=new WeakMap();//tunnel=>object

		this.allowedStreamMode=new Set(['subStream','stream'])

	}
	handle(obj,data){
		let tid=this.tunnelID.get(obj),
			tunnel=this.tunnels.get(tid);
		if(data.byteLength){
			if(tunnel)tunnel.receive(data);
			else this.sendUnsafe(obj,tunnelErrorMsgs[4006]);
			return;
		}
		try{
			var c=JSON.parse(data);
		}catch(e){
			// this.emit('invalid_data',data);
			this.sendUnsafe(obj,tunnelErrorMsgs[4000]);
			return;
		}
		switch(c._){
			case 'create':{//tunnel create msg
				if(tunnel){//tunnel exists
					this.sendUnsafe(obj,tunnelErrorMsgs[4001]);
					return;
				}
				//create tunnel
				tunnel=this.createTunnel(obj,c);
				c._='created';
				c.tunnelID=tunnel.id;
				this.sendUnsafe(obj,JSON.stringify(c));
				break;
			}
			case 'use':{//tunnel reuse msg
				tunnel=this.tunnels.get(c.id);
				if(!tunnel){
					this.sendUnsafe(obj,tunnelErrorMsgs[4004]);
					return;
				}
				//reset the tunnel
				this._bindTunnel(obj,tunnelID);
				if(tunnel._timer)clearTimeout(tunnel._timer);

				this.sendUnsafe(obj,JSON.stringify({_:'created',msg:tunnel.id}));
				break;
			}
			case 'close':{//force close tunnel
				if(tunnel)tunnel.close(c.msg||'closed by another side');
				break;
			}
			case 'created':{
				this.createTunnel(obj,c);
				break;
			}
			case 'error':{
				if(c.code>=4000 && c.code<=4006){
					this.close(c.code,errorCodes[c.code]);
					return;
				}
				console.error(c.code,errorCodes[c.code]);
				break;
			}
			default:{
				this.sendUnsafe(obj,tunnelErrorMsgs[4005]);
				break;
			}
		}
	}
	createTunnel(obj,opts){
		if(!this.allowedStreamMode.has(opts.mode)){//not an allowed mode
			this.sendUnsafe(obj,tunnelErrorMsgs[4002]);
			return;
		}
		if(!(opts.mode in Tunnel)){
			this.sendUnsafe(obj,tunnelErrorMsgs[4003]);
			return;
		}

		//set the tunnel
		let tunnel=new (require(Tunnel[opts.mode]).tunnel);
		if(opts.tunnelID){
			tunnel.setID(opts.tunnelID);
		}else{
			while(this.tunnels.has(tunnel.id))//generate a new id if exists
				tunnel._genTunnelID();
		}
		this.tunnels.set(tunnel.id,tunnel);
		tunnel.keepBrokenTunnel=opts.keepBrokenTunnel;//timeout
		this._bindTunnel(obj,tunnel.id);
		tunnel.once('close',()=>{
			this._clearTunnel(tunnel.id);
			this.emit('tunnel_close',tunnel);
		})._open();

		this.emit('tunnel_open',tunnel);
		return tunnel;
	}
	closeTunnel(obj,reason,sendMessage=false){
		let tunnel=this.tunnels.get(this.tunnelID.get(obj));
		tunnel&&tunnel.close(reason);
		if(sendMessage){
			this.sendUnsafe(obj,JSON.stringify({_:'close',msg:reason}));
		}
	}
	getTunnel(obj){
		return this.tunnels.get(this.tunnelID.get(obj));
	}
	hasTunnel(obj){
		return this.tunnels.has(this.tunnelID.get(obj));
	}
	_clearTunnel(tunnelID){//clear map data after tunnel closed
		let tunnel=this.tunnels.get(tunnelID);
		if(tunnel){
			let obj=this.tunnelToObj.get(tunnel);
			this.tunnelToObj.delete(tunnel);
			this.tunnelID.delete(obj);
			this.tunnels.delete(tunnelID);
		}
	}
	_bindTunnel(obj,tunnelID){
		let tunnel=this.tunnels.get(tunnelID);
		if(!tunnel){
			throw(Error('TunnelID not exists:'+tunnelID));
		}
		tunnel.send=this.send.bind(this,obj);
		tunnel.sendable=this.sendable.bind(this,obj);
		//if the tunnel already belongs to an obj,clear the previos obj
		if(this.tunnelToObj.has(tunnel)){
			let preObj=this.tunnelToObj.get(tunnel);
			this.tunnelID.delete(preObj);
			this.tunnelToObj.delete(tunnel);
		}
		//if the obj abready has an tunnel,break the tunnel
		if(this.tunnelID.has(obj)){
			let preTun=this.tunnels.get(this.tunnelID.get(obj));
			this.tunnelID.delete(obj);
			if(preTun)preTun.close('broken tunnel');
			//the tunnel will be removed from Map after closed
		}

		this.tunnelID.set(obj,tunnelID);
		this.tunnelToObj.set(tunnel,obj);
	}
	sendUnsafe(obj,msg){
		if(!this.sendable(obj))return;
		this.send(obj,msg);
	}
	send(obj,...args){
		return this._send(obj,...args);
	}
	sendable(obj){
		return this._sendable(obj);
	}
	_send(obj,...args){}//to be overwritten
	_sendable(obj){}//to be overwritten

	static errorMessage(code){
		return tunnelErrorCodes[code];
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
	tunnelHelper,
};

