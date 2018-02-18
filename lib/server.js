/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const events=require('events'),
		Websocket=require('ws'),
		{tunnelHelper}=require('./tunnel.js'),
		debug=require('debug')('ws-stream-tunnel:server');

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
		}).on('should-close',()=>{
			//close the server before exit
			this.close('exiting');
		});

		this._close=this.close.bind(this,'exiting');

		this.on('connection',(ws,req)=>{
			this._connection(ws,req);
		});
		
	}
	_connection(ws,req){
		ws._req=req;
		ws._live=Date.now();
		ws._timer=setInterval(()=>{
			if(Date.now()-ws._live > 30000)//time out
				ws.terminate();
		},10000);

		let socket=ws._socket;
		socket.setTimeout(30000);
		socket.on('timeout',()=>{
			socket.destroy(Error('socket time out'));
		});
		ws.on('message',data=>{
			ws._live=Date.now();
			this.tunnelHelper.handle(ws,data);
		}).on('ping',()=>{
			ws._live=Date.now();
		}).on('close',(code,reason)=>{
			// debug('ws','close',code,reason)
			let tunnel=this.tunnelHelper.getTunnel(ws);
			if(!tunnel){
				return;
			}

			(code!==1000)&&this.tunnelHelper.toBroken(tunnel,reason||'websocket lost');
			ws._req=null;
		}).on('error',err=>{
			debug('websocket error',err);
			if(ws.readyState!==3)ws.close();
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
		this.tunnelHelper.clear(reason);
		super.close();
	}
}

exports.tunnelServer=tunnelServer;