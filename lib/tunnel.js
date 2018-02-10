/*
Copyright luojia@luojia.me
MIT LICENSE
*/
'use strict';

const events=require('events'),
	{Writable}=require('stream');

const Tunnels={
	stream:'./tunnels/stream/streamTunnel.js',
	subStream:'./tunnels/subStream/subStreamTunnel.js',
};

/*
Tunnel is used to manage subStream on both client and server side

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


class cacheStream extends Writable{
	constructor(){
		super({
			objectMode:true,
			highWaterMark:9,
		});
	}
	_write(chunk, encoding, callback){}
}
/*
events
	error:(error)
	close
	//invalid_data:(data)
	stream_open:(stream)
	stream_close:(stream)
*/
class Tunnel extends events{
	constructor(){
		super();
		//this.id
		this.name='tunnel';
		this.closed=false;
		this.timeout=60000;
		this.reuse=false;//false:the connection will be closed after tunnel closed. true:the connection won't be closed

		this.cacheStream=new cacheStream();
		this.cacheStream._write=(chunk, encoding, callback)=>{
			this.send(chunk, emptyOpt, callback);
		};

		this.scheduleTimer=0;

		this._genTunnelID();
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
	_open(){
		setImmediate(this.emit.bind(this,'open'));
	}
	_sendViaCache(data,callback){//all data to be sent from sub class must use this method,unless the data is allowed to be lost
		return this.cacheStream.write(data,null,callback);
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
		this.emit('close',reason);
	}
}




/*
tunnelHelper
	help to establish tunnels and transport data
*/
const tunnelErrorCodes={
	4001:'',//free message
	4001:'Tunnel already created',//this is an impossible error unless there is something wrong in code
	4002:'Not allowed tunnel mode',
	4003:'Not supported tunnel mode',
	4004:'Tunnel of id not exsts',
	4005:'Wrong configuration msg',
	4006:'Binary data received without a tunnel',
	4007:'Cannot parse the data',
},tunnelErrorMsgs={};
for(let code in tunnelErrorCodes){
	tunnelErrorMsgs[code]=JSON.stringify({_:'error',code:Number(code),msg:tunnelErrorCodes[code]});
}


/*
events
	tunnel_open:(tunnel)
	tunnel_close:(tunnel)
	error:(obj,code,message)

properties
	allowedStreamMode : (Array)allowed stream mode
	tunnels : (Map) tunnelID=>tunnel
*/
class tunnelHelper extends events{
	constructor(){
		super();
		this.tunnels=new Map();//tunnelID=>tunnel
		this.tunnelID=new WeakMap();//object=>tunnel id
		this.tunnelToObj=new WeakMap();//tunnel=>object

		this.allowedStreamMode=new Set(['subStream','stream']);


		this._clear=this.clear.bind(this,'exiting');
		process.once('exit',this._clear);
		process.once('SIGINT',this._clear);
	}
	handle(obj,data){
		let tid=this.tunnelID.get(obj),
			tunnel=this.tunnels.get(tid);
		if(data.byteLength !== undefined){
			if(tunnel)tunnel.receive(data);
			else this.sendError(obj,4006);
			return;
		}
		try{
			var c=JSON.parse(data);
		}catch(e){
			// this.emit('invalid_data',data);
			console.debug('cannot parse data',e);
			this.sendError(obj,4007);
			return;
		}
		switch(c._){
			case 'create':{//tunnel create msg
				if(tunnel){//tunnel exists
					this.sendError(obj,4001);
					return;
				}
				//create tunnel
				tunnel=this.createTunnel(obj,c);
				c._='created';
				c.tunnelID=tunnel.id;
				this.send(obj,JSON.stringify(c));
				break;
			}
			case 'use':{//tunnel reuse msg
				tunnel=this.tunnels.get(c.tunnelID);
				if(!tunnel){
					this.sendError(obj,4004);
					return;
				}
				//reset the tunnel
				this._bindTunnel(obj,c.tunnelID);
				if(tunnel._timer)clearTimeout(tunnel._timer);

				this.send(obj,JSON.stringify({_:'created',msg:tunnel.id}));
				break;
			}
			case 'close':{//force close tunnel
				if(tunnel)tunnel.close(c.msg||'closed by another side');
				break;
			}
			case 'created':{
				if(tunnel)this._bindTunnel(obj,tunnel.id);
				else this.createTunnel(obj,c);
				break;
			}
			case 'error':{
				if(!tunnel)return;
				if(c.code>=4000 && c.code<=4007){
					if(!tunnel.keepBrokenTunnel){
						this.closeTunnel(obj,c.msg);
						this.emit('error',obj,c.code,c.msg);
					}
					return;
				}
				console.error(c.code,c.msg);//for debug
				break;
			}
			default:{
				this.sendError(obj,4005);
				break;
			}
		}
	}
	createTunnel(obj,opts){
		if(!this.allowedStreamMode.has(opts.mode)){//not an allowed mode
			this.sendError(obj,4002);
			return;
		}
		if(!(opts.mode in Tunnels)){
			this.sendError(obj,4003);
			return;
		}

		//set the tunnel
		let tunnel=new (require(Tunnels[opts.mode]).tunnel);
		if(opts.tunnelID){
			tunnel.setID(opts.tunnelID);
		}else{
			while(this.tunnels.has(tunnel.id))//generate a new id if exists
				tunnel._genTunnelID();
		}
		this.tunnels.set(tunnel.id,tunnel);
		tunnel.keepBrokenTunnel=opts.keepBrokenTunnel;//timeout
		this._bindTunnel(obj,tunnel.id);
		tunnel.once('close',reason=>{
			this.send(obj,JSON.stringify({_:'close',msg:reason}));
			this._clearTunnelMap(tunnel.id);
			this.tunnels.delete(tunnel.id);//the tunnel should just be removed from the Map here,so it's not in the _clearTunnelMap function
			this.emit('tunnel_close',tunnel);
		})._open();
		this.emit('tunnel_open',tunnel);
		return tunnel;
	}
	toBroken(tunnel,msg){
		if(tunnel.keepBrokenTunnel>0){
			//the tunnel will be kept until the timeout
			tunnel._timer=setTimeout(()=>{
				tunnel.close('broken timeout');
			},tunnel.keepBrokenTunnel);
		}else{
			tunnel.close(msg);
		}
	}
	closeTunnel(obj,reason){
		let tunnel=this.tunnels.get(this.tunnelID.get(obj));
		tunnel&&tunnel.close(reason);
	}
	getTunnel(obj){
		return this.tunnels.get(this.tunnelID.get(obj));
	}
	hasTunnel(obj){
		return this.tunnels.has(this.tunnelID.get(obj));
	}
	_clearTunnelMap(tunnelID){//clear map data after tunnel closed
		let tunnel=this.tunnels.get(tunnelID);
		if(tunnel){
			let obj=this.tunnelToObj.get(tunnel);
			this.tunnelToObj.delete(tunnel);
			this.tunnelID.delete(obj);
		}
	}
	_bindTunnel(obj,tid){
		let tunnel=this.tunnels.get(tid);
		if(!tunnel){
			throw(Error('TunnelID not exists:'+tid));
		}
		if(tunnel._timer){
			clearTimeout(tunnel._timer);
			tunnel._timer=0;
		}
		//if the tunnel already belongs to an obj,clear the previos obj
		if(this.tunnelToObj.has(tunnel)){
			if(tunnel.id===tid){//the same tunnel
				return;
			}
			this._clearTunnelMap(tunnel.id);
		}
		//if the obj abready has an tunnel,break the tunnel
		if(this.tunnelID.has(obj)){
			this.closeTunnel(obj,'broken tunnel');
		}

		tunnel.send=this.send.bind(this,obj);
		tunnel.sendable=this.sendable.bind(this,obj);
		this.tunnelID.set(obj,tid);
		this.tunnelToObj.set(tunnel,obj);
	}
	sendError(obj,code,msg=tunnelErrorMsgs[code]){
		this.send(obj,msg);
	}
	send(obj,data,opt=emptyOpt,callback){
		let tunnelID=this.tunnelID.get(obj);
		try{
			this._send(obj,data,opt,err=>{
				if(err){
					//keep retry if the tunnel still exists
					let tunnel=this.tunnels.get(tunnelID);
					if(!tunnel){
						callback&&callback(Error('tunnel closed'));
						return;
					}
					let obj=this.tunnelToObj.get(tunnel);//re-get obj of the tunnel,in case the obj changed

					setTimeout(()=>{
						this.send(obj,data,opt,callback);
					},500);
					// console.debug('send error:',err);
					return;
				}
				callback&&callback(null);
			});
		}catch(e){
			//send method only throws error when no callback provided
			//important data all sends with a callback
			//so do nothing
		}
	}
	sendable(obj){
		return this._sendable(obj);
	}
	_send(obj,data,opt,callback){}//to be overwritten
	_sendable(obj){}//to be overwritten

	clear(reason='unknown'){
		process.removeListener('exit',this._clear);
		process.removeListener('SIGINT',this._clear);

		for(let [tid,tunnel] of this.tunnels){
			let obj=this.tunnelToObj.get(tunnel);
			this.closeTunnel(obj,reason,true);
		}
	}

	static errorMessage(code){
		return tunnelErrorCodes[code];
	}
}


//number convert
var defaultList='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function conv(n,o,t){
    var tnum=[],m,negative=((n+='').trim()[0]=='-'),decnum=0;
    if(negative)n=n.slice(1);
    for(var i=n.length;i--;)
        decnum+=defaultList.indexOf(n[i])*Math.pow(o,n.length-i-1);
    for(;decnum!=0;tnum.unshift(defaultList[m])){
        m=decnum%t;
        decnum=Math.floor(decnum/t);
    }
    decnum&&tnum.unshift(defaultList[decnum]);
    return (negative?'-':'')+tnum.join('');
}


module.exports={
	Tunnel,
	tunnelHelper,
};

