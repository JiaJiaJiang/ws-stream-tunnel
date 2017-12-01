/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';

const events=require('events'),
		Websocket=require('ws');

const {subStreamTunnel}=require('./tunnels/subStream/subStreamTunnel.js');
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
*/
class connectionManager extends events{
	constructor(options){
		super();
		this.options=Object.assign({},options);
		this.retryLimit=('retry' in this.options)?this.options.retry:5;
		this.retry=0;
		this.ws;
		this.addr=this.options.addr;
		this.connecting=false;
		this.closed=false;
		this.idle=false;
		this._disableIdle=false;
		this._idleTimer;
		this._activeTime;
		if(this.options.idleTimeout>0){
			this._idleTimer=setInterval(()=>{
				if(this._disableIdle || this.connecting || this.closed || this.idle || this.ws.readyState!==1 || !this.options.idleTimeout)return;
				if(Date.now()-this._activeTime >= this.options.idleTimeout){
					this.idle=true;
					this.ws.close();
				}
			},1000);
		}
	}
	get wsOptions(){return this.options.ws;}
	connect(addr,callback){
		if(this.connecting || this.closed)return false;
		if(typeof addr==='function'){
			callback=addr;
			addr=undefined;
		}
		if(addr === undefined)addr=this.addr;
		else{this.addr=addr;}
		if(typeof addr !== 'string')
			throw(new Error('Address is not a string'));
		if(this.ws&&this.ws.readyState<2){
			this._closeWs(3005,'starting a new connection');
		}
		let ws=this.ws=new Websocket(addr,this.options.ws);
		ws.on('open',()=>{
			this.connecting=false;
			this._active();
			ws._pingTimer=setInterval(()=>{
				ws.ping();
			},5000);
			callback&&callback();
			this.emit('_wsopen',ws);
		}).once('close',()=>{
			this.connecting=false;
			clearInterval(ws._pingTimer);
			if(!this.closed || !this.idle){//auto reconnect
				if(this.idle)
					this.emit('_wsclose',ws,'idle');
				else{
					this.retry++;
					this.emit('_wsclose',ws,'retry');
				}
				if(this.retry<=this.retryLimit)
					setTimeout(()=>{
						this.connect();
					},3000);
			}else{
				this.emit('_wsclose',ws,'normal');
			}
			setImmediate(()=>{
				ws.removeAllListeners();
			});
		}).on('message',data=>{
			this._active();
			this.emit('_wsmessage',ws,data);
		}).on('error',e=>{
			this.emit('_wserror',ws,e);
		});
		this.idle=false;
	}
	send(...args){
		this._active();
		this.ws.send(...args);
	}
	_active(){
		if(this.idle){
			this.connect();
		}
		this._activeTime=Date.now();
	}
	_closeWs(code,msg){
		if(this.ws.readyState<2){
			this.ws.close(code,msg);
		}
	}
	close(){
		if(this.closed)return;
		this.closed=true;
		this._closeWs(3004);
		if(this._idleTimer)clearInterval(this._idleTimer);
		setImmediate(()=>{
			this.removeAllListeners();
		});
	}
}

/*
options
	mode:'subStream'
*/
/*
events
	tunnel_open:(tunnel)
	tunnel_close:(tunnel)
*/
class tunnelClient extends events{
	constructor(options){
		super();
		this.connectionManager=new connectionManager(options);
		this.tunnelID;
		this.closed=false;
		this.tunnelCreated=false;
		switch(options.mode){
			case undefined:case 'subStream':{
				this.tunnel=new subStreamTunnel();
				break;
			}
			default:{
				throw(new Error('Unsupported mode:'+options.mode));
			}
		}
		this.tunnel.send=this.connectionManager.send.bind(this.connectionManager);//set send method

		this.connectionManager.on('_wsopen',ws=>{
			this._tunnelRequest(ws,options);
		}).on('_wsmessage',(ws,data)=>{
			if(this.tunnelCreated){
				this.tunnel.receive(data);
			}else{
				try{
					var data=JSON.parse(data);
				}catch(e){
					//do nothing
				}
				switch(data._){
					case 'created':{
						this.tunnelCreated=true;
						this.tunnelID=data.msg;
						this.tunnel.setID(data.msg);
						this.emit('tunnel_open',this.tunnel);
						break;
					}
					case 'error':{
						switch(data.code){
							case 3001:{//tunnel already created,this is a impossible error unless there is error in code
								console.error('tunnel already created');
								break;
							}
							case 3002://not allowed tunnel mode
							case 3003://not supported tunnel mode
							case 3004://tunnel of id not exsts
							case 3005://wrong configuration msg
							case 3006://binary data received before creating tunnel
							{
								this.emit('error',data.msg);
								this.close();
								break;
							}
							default:{
								console.error(data.code,data.msg);
							}
						}
						break;
					}
				}
			}
		}).on('_wsclose',(ws,msg)=>{
			this.tunnelCreated=false;
			if(msg==='normal'){
				this.tunnel.close('connection closed');
			}else{
				this.tunnelID=null;
			}
		});

		this.tunnel.once('close',()=>{
			//close the client when the tunnel is closed
			this.tunnelCreated=false;
			this.emit('tunnel_close',this.tunnel);
			this.close();
		})
		.on('stream_open',()=>{this.connectionManager._disableIdle=true;})
		.on('stream_close',()=>{if(this.tunnel.subStreams.size===0)this.connectionManager._disableIdle=false;});

		this.connectionManager.connect();
	}
	_tunnelRequest(ws,options){
		let msg;
		if(this.tunnelID){
			msg={_:'use',id:this.tunnelID};
		}else{
			msg={_:'create',mode:options.mode};
		}
		ws.send(JSON.stringify(msg));
	}
	closeTunnel(reason){
		if(!this.tunnelCreated)return;
		this.tunnelCreated=false;
		this.connectionManager.ws.send(JSON.stringify({_:'close'}));
		this.tunnel.close(reason);
	}
	close(){
		if(this.closed)return;
		this.closed=true;
		this.tunnelID=null;
		this.closeTunnel('closing client');
		this.connectionManager.close();
	}
}

module.exports={
	tunnelClient,
}