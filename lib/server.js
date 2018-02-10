/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const events=require('events'),
		Websocket=require('ws'),
		{tunnelHelper}=require('./tunnel.js');

//options:see https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback
/*
events
	tunnel_open:(tunnel)
	tunnel_close:(tunnel)
	Websocket Server events

properties
	Websocket Server properties
*/
class tunnelServer extends Websocket.Server{
	constructor(options,callback){//the optiosns obj is used as Websocket server's options
		options.clientTracking=false;//not tracking clients
		super(options,callback);

		let helper=this.tunnelHelper=new tunnelHelper();
		helper._sendable=ws=>ws.readyState===1;
		helper._send=(ws,data,opt,callback)=>{
			ws.send(data,opt,callback);
		};
		this.tunnelHelper.on('tunnel_open',tunnel=>{
			this.emit('tunnel_open',tunnel);
		}).on('tunnel_close',tunnel=>{
			this.emit('tunnel_close',tunnel);
		}).on('error',(obj,code,msg)=>{
			this.tunnelHelper.closeTunnel(obj,'tunnel error');
		});

		this._close=this.close.bind(this,'exiting');

		this.on('connection',(ws,req)=>{
			this._connection(ws,req);
		});
		
		//close the server before exit
		process.on('exit',this._close);
	}
	_connection(ws,req){
		ws._req=req;
		ws._live=Date.now();
		ws._timer=setInterval(()=>{
			if(Date.now()-ws._live > 100000)//time out
				ws.terminate();
		},120000);
		ws.on('message',data=>{
			ws._live=Date.now();
			this.tunnelHelper.handle(ws,data);
		}).on('ping',()=>{
			ws._live=Date.now();
		}).once('close',(code,reason)=>{
			clearInterval(ws._timer);
			let tunnel=this.tunnelHelper.getTunnel(ws);
			if(!tunnel){
				return;
			}

			this.tunnelHelper.toBroken(tunnel,reason||'websocket lost');
			ws._req=null;
		}).on('error',err=>{
			//console.error('ws error',err);
			//do nothing
		});
	}
	getWsOfTunnel(tunnel){
		return this.tunnelHelper.tunnelToObj.get(tunnel);
	}
	getReqOfWs(ws){
		return ws._req;
	}
	close(reason='unknown'){
		process.removeListener('exit',this._close);
		this.tunnelHelper.clear(reason);
		super.close();
	}
}

exports.tunnelServer=tunnelServer;