/*
Copyright luojia@luojia.me
MIT LICENSE
*/

/*
manners
connections in the client should be destroyed when:
	reaching retrylimit
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

		//idle
		this.idle=false;
		this.disableIdle=false;
		this._idleTimer;
		this._activeTime;

		//set a idle timer
		if(this.options.idleTimeout>0)
		this._idleTimer=setInterval(()=>{
			if(this.disableIdle || !this.connected || this.closed)return;
			if(Date.now()-this._activeTime >= this.options.idleTimeout){
				this.idle=true;
				this._closeWs();
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

		if(this.ws)this._closeWs(3000,'starting a new connection');

		this.idle=false;

		this.ws=new Websocket(this.addr,this.options.ws);
		this.ws.once('open',()=>{
			this._active();

			this.ws._pingTimer=setInterval(()=>{//set a ping interval
				if(this.connected===1)this.ws.ping();
			},50000);

			callback&&callback();
			this.emit('_wsopen',this.ws);
		}).once('close',(code,reason)=>{
			clearInterval(this.ws._pingTimer);
			if(!this.closed || !this.idle){//retry
				this.ws=null;
				if(this.retryLimit===0 || this.retry<this.retryLimit){
					this.retry++;
					setTimeout(()=>this.connect(),3000);
				}else{
					this.close(null,'retry limit');
				}
			}
			this.emit('_wsclose',this.ws);
		}).on('message',data=>{
			this._active();
			this.emit('_wsmessage',this.ws,data);
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
			if(typeof data !== 'string'){//tunnel eats every binary data
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
						case 3001:{//tunnel already created,this is an impossible error unless there is error in code
							console.error('tunnel already created');
							break;
						}
						case 3002://not allowed tunnel mode
						case 3003://not supported tunnel mode
						case 3004://tunnel of id not exsts
						case 3005://wrong configuration msg
						case 3006:{//binary data received before creating tunnel
							this.emit('error',data.msg);
							this.close(3000,'client received an error');
							break;
						}
						default:{
							console.error(data.code,data.msg);
						}
					}
					break;
				}
			}
		}).on('_wsclose',()=>{
			this.tunnelCreated=false;
			if(this.tunnel){
				this.tunnel.closeAllStreams();//close all streams before creating a new tunnel
			}
		}).once('close',(reason)=>{
			this.close(reason);
		});

		
		//tunnel
		this.tunnelID;
		this.tunnelCreated=false;
		this.tunnel.send=this.connectionMng.send.bind(this.connectionMng);//set send method
		this.tunnel.sendable=()=>this.connectionMng.connected;
		this.tunnel.once('close',()=>{
			//close the client when the tunnel is closed
			this.tunnelCreated=false;
			this.emit('tunnel_close',this.tunnel);
			this.close(1000,'tunnel closed');
		})
		.on('stream_open',()=>{this.connectionMng.disableIdle=true;})
		.on('stream_close',()=>{if(this.tunnel.count().size===0)this.connectionMng.disableIdle=false;});

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

module.exports={
	tunnelClient,
}