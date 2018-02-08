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
		Websocket=require('ws'),
		{tunnelHelper}=require('./tunnel.js');

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
	beforeConnect:(callback)emits before the connection,you can pass a new address to the callback to change the address
	close
*/
class tunnelClient extends events{
	constructor(options){
		super();
		this.closed=false;
		if(!options.mode)options.mode='subStream';//default tunnel

		this.connection={};//just an empty object

		this.tunnelHelper=new tunnelHelper();
		this.tunnelHelper._sendable=ws=>this.connectionMng.connected;
		this.tunnelHelper._send=(ws,...args)=>{
			this.connectionMng.send(...args);
		};
		this.tunnelHelper.on('tunnel_open',tunnel=>{
			tunnel.on('stream_open',()=>{//disable idle when there has streams in the tunnel
				this.connectionMng.disableIdle=true;
			}).on('stream_close',()=>{
				if(tunnel.count()===0){
					this.connectionMng.disableIdle=false;
				}
			});
			this.emit('tunnel_open',tunnel);
		}).on('tunnel_close',tunnel=>{
			this.emit('tunnel_close',tunnel);
			//close the client when the tunnel is closed
			if(!tunnel.reuse)this.close(1000,'tunnel closed');
		}).on('error',(obj,code,msg)=>{
			if(code==4004)
				this.tunnelHelper.closeTunnel(obj,msg);
			this.connectionMng._closeWs();
		});

		//connection mng
		this.connectionMng=new connectionMng(options);
		this.connectionMng.on('_wsopen',ws=>{
			this.requestTunnel(ws,options);
		}).on('_wsmessage',(ws,data)=>{
			this.tunnelHelper.handle(this.connection,data);
		}).once('close',(reason)=>{
			// this.tunnelCreated=false;
			this.close(1000,reason);//normal close
		}).on('idle',()=>{
			this.tunnelHelper.closeTunnel(this.connection,'idle',true);
			this.emit('idle');
		}).on('beforeConnect',func=>{
			this.emit('beforeConnect',func);
		});

		//connect
		this.connectionMng.connect();
	}
	get tunnel(){return this.tunnelHelper.getTunnel(this.connection);}
	get tunnelID(){return this.tunnelHelper.tunnelID.get(this.connection);}
	get tunnelCreated(){return this.tunnelHelper.hasTunnel(this.connection);}
	requestTunnel(ws,options){
		let msg;
		if(this.tunnelID && options.keepBrokenTunnel){//if tunnelID exists and the tunnel was kept
			msg={_:'use',id:this.tunnelID};
		}else{//request a new tunnel id
			msg={_:'create',mode:options.mode};
			if(options.keepBrokenTunnel){
				msg.keepBrokenTunnel=options.keepBrokenTunnel;
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
		this.tunnelHelper.clear(reason);
		// this.closeTunnel(reason);
		this.connectionMng.close(code,reason);
		this.emit('close');
	}
}

/*
options
	//retry:max retry limit,0 as unlimited. defaults to 5
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
			if(this.idle || this.disableIdle)return;
			if(Date.now()-this._activeTime >= this.options.idleTimeout){
				this.idle=true;
				this.emit('idle');
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
		this.emit('beforeConnect',newAddr=>newAddr&&(addr=newAddr));

		if(typeof addr==='function'){callback=addr;addr=undefined;}
		if(addr !== undefined)this.addr=addr;

		if(this.connected)this._closeWs(4000,'starting a new connection');

		this.idle=false;

		let ws=this.ws=new Websocket(this.addr,this.options.ws);
		ws.once('open',()=>{
			this._active();
			this._live=Date.now();
			ws._pingTimer=setInterval(()=>{//set a ping interval
				if(this.connected){
					let diff=Date.now()-this._live;
					if(diff > 60000){//timeout
						ws.terminate();
					}else if(diff >40000){
						ws.ping();
					}
				}
			},1000);

			callback&&callback();
			this.emit('_wsopen',ws);
		}).once('close',(code,reason)=>{
			clearInterval(ws._pingTimer);
			this.ws=null;
			if(!this.closed || !this.idle){//retry
				setTimeout(()=>this.connect(),3000);
			}
			this.emit('_wsclose',ws);
		}).on('message',data=>{
			this._active();
			this._live=Date.now();
			this.emit('_wsmessage',ws,data);
		}).on('pong',()=>{
			this._live=Date.now();
		}).once('error',e=>{
			this.emit('_wserror',ws,e);
		});
	}
	send(...args){
		this._active();
		try{
			this.ws.send(...args);
		}catch(e){
			// console.debug('failed to send',e);
		}
	}
	_active(){//update the connection's active state
		if(this.idle && !this.connecting)
			this.connect();
		this._activeTime=Date.now();
	}
	_closeWs(code,msg){
		// this.retry=0;
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