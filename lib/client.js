/*
Copyright luojia@luojia.me
MIT LICENSE
*/

/*
manners
connections in the client should be destroyed when:
	reaching connection retrylimit
	tunnel broken
connections are kept when:
	websocket connection lost(the client will reconnect and try to reuse the previous tunnel)
*/

'use strict';

const events=require('events'),
		Websocket=require('ws');

const Tunnel={
	stream:require('./tunnels/stream/streamTunnel.js'),
	subStream:require('./tunnels/subStream/subStreamTunnel.js'),
}

const errorCodes={
	4001:'Tunnel already created',//this is an impossible error unless there is something wrong in code
	4002:'Not allowed tunnel mode',
	4003:'Not supported tunnel mode',
	4004:'Tunnel of id not exsts',
	4005:'Wrong configuration msg',
	4006:'Binary data received before creating tunnel',
}


/*
options
	mode:
	  'stream'
	  'subStream'
*/
/*
events
	tunnel_open:(tunnel)
	tunnel_close:(tunnel)
	close
*/
class tunnelClient extends events{
	constructor(options){
		super();
		this.closed=false;
		if(!options.mode)options.mode='subStream';//default tunnel
		if(options.mode in Tunnel){
			this.tunnel=new Tunnel[options.mode].tunnel();
		}else{
			throw(new Error('Unsupported mode:'+options.mode));
		}

		//connection mng
		this.connectionMng=new connectionMng(options);
		this.connectionMng.on('_wsopen',ws=>{
			this._tunnelRequest(ws,options);
		}).on('_wsmessage',(ws,data)=>{
			if(data.byteLength){//tunnel eats every binary data
				this.tunnel.receive(data);
				return;
			}
			try{
				var data=JSON.parse(data);
			}catch(e){
				this.emit('invalid_data',data);
				return;
			}
			switch(data._){
				case 'created':{
					this.tunnelCreated=true;
					this.tunnelID=data.msg;
					this.tunnel.setID(data.msg);
					this.tunnel._open();
					this.emit('tunnel_open',this.tunnel);
					break;
				}
				case 'error':{
					switch(data.code){
						case 4001:{
							console.error();
							break;
						}
						case 4002:
						case 4003:
						case 4004:
						case 4005:
						case 4006:{
							this.emit('error',data.msg);
							this.close(data.code,errorCodes[data.code]);
							break;
						}
						default:{
							console.error(data.code,data.msg);
						}
					}
					break;
				}
			}
		}).once('close',(reason)=>{
			this.tunnelCreated=false;
			this.close(1000,reason);//normal close
		});

		
		//tunnel
		this.tunnelID;
		this.tunnelCreated=false;
		this.tunnel.send=this.connectionMng.send.bind(this.connectionMng);//set send method
		this.tunnel.sendable=()=>this.connectionMng.connected;//if connected,it is sendable
		this.tunnel.once('close',()=>{
			//close the client when the tunnel is closed
			this.tunnelCreated=false;
			this.emit('tunnel_close',this.tunnel);
			this.close(1000,'tunnel closed');
		})
		.on('stream_open',()=>{this.connectionMng.disableIdle=true;})//disable idle when there has streams in the tunnel
		.on('stream_close',()=>{if(this.tunnel.count()===0){this.connectionMng.disableIdle=false;}});

		//connect
		this.connectionMng.connect();
	}
	_tunnelRequest(ws,options){
		let msg;
		if(this.tunnelID && options.keepBrokenTunnel){//if tunnelID exists and the tunnel was kept
			msg={_:'use',id:this.tunnelID};
		}else{//request a new tunnel id
			msg={_:'create',mode:options.mode};
			if(options.keepBrokenTunnel){
				msg.keepBrokenTunnel=1;
			}
		}
		
		ws.send(JSON.stringify(msg));
	}
	closeTunnel(reason){
		if(!this.tunnelCreated)return;
		this.tunnel.close(reason);
	}
	close(code=1000,reason='closing client'){
		if(this.closed)return;
		this.closed=true;
		this.tunnelID=null;
		this.closeTunnel(reason);
		this.connectionMng.close(code,reason);
		this.emit('close');
	}
}

/*
options
	retry:max retry limit,0 as unlimited. defaults to 5
	addr:target websocket protocol address
	ws:options object for ws connection
		see https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options
	idleTimeout:millisecond before closing the connection,0 presents always keep the connection,defaults to 0
*/
/*
events
	_wsopen:(ws)
	_wsclose:(ws)
	_wsmessage:(data)
	_wserror:(error)
	close:(reason)
*/
class connectionMng extends events{
	constructor(options){
		super();
		this.options=Object.assign({},options);

		this.ws;
		this.addr=this.options.addr;
		this.closed=false;//only set this to true when closed by user

		//retry
		this.retryLimit=('retry' in this.options)?this.options.retry:5;
		this.retry=0;

		//for testing bad connection
		this._live=0;

		//idle
		this.idle=false;
		this.disableIdle=false;
		this._idleTimer;
		this._activeTime;
		//set a idle timer
		if(this.options.idleTimeout>0)
		this._idleTimer=setInterval(()=>{
			if(this.idle || this.disableIdle /*|| !this.connected || this.closed*/)return;
			if(Date.now()-this._activeTime >= this.options.idleTimeout){
				this.idle=true;
				this._closeWs();
				this.emit('idle');
			}
		},1000);
		
	}
	get connecting(){return !!(this.ws&&this.ws.readyState===0);}
	get connected(){return !!(this.ws&&this.ws.readyState===1);}
	set addr(v){
		if(typeof v !== 'string')
			throw(new Error('Address is not a string'));
		this.options.addr=v;
	}
	get addr(){return this.options.addr;}
	connect(addr,callback){
		if(this.connecting || this.closed)return false;

		if(typeof addr==='function'){callback=addr;addr=undefined;}
		if(addr !== undefined)this.addr=addr;

		if(this.ws)this._closeWs(4000,'starting a new connection');

		this.idle=false;

		this.ws=new Websocket(this.addr,this.options.ws);
		this.ws.once('open',()=>{
			this._active();
			this._live=Date.now();

			this.ws._pingTimer=setInterval(()=>{//set a ping interval
				if(this.connected){
					let diff=Date.now()-this._live;
					if(diff > 60000){//timeout
						this.ws.terminate();
					}else if(diff >40000){
						this.ws.ping();
					}
				}
			},1000);

			callback&&callback();
			this.emit('_wsopen',this.ws);
		}).once('close',(code,reason)=>{
			clearInterval(this.ws._pingTimer);
			if(!this.closed || !this.idle){//retry
				this.ws=null;
				if(this.retryLimit===0 || this.retry<this.retryLimit){
					this.retry++;
					setTimeout(()=>this.connect(),4000);
				}else{
					this.close(null,'retry limit');
				}
			}
			this.emit('_wsclose',this.ws);
		}).on('message',data=>{
			this._active();
			this._live=Date.now();
			this.emit('_wsmessage',this.ws,data);
		}).on('pong',()=>{
			this._live=Date.now();
		}).once('error',e=>{
			this.emit('_wserror',this.ws,e);
		});
	}
	send(...args){
		this._active();
		this.ws.send(...args);
	}
	_active(){//update the connection's active state
		if(this.idle && !this.connecting)
			this.connect();
		this._activeTime=Date.now();
	}
	_closeWs(code,msg){
		this.retry=0;
		if(this.connected)
			this.ws.close(code,msg);
	}
	close(code,reason){
		if(this.closed)return;
		this.closed=true;
		this._closeWs(code,reason);
		if(this._idleTimer)clearInterval(this._idleTimer);
		this.emit('close',reason);
	}
}


module.exports={
	tunnelClient,
}