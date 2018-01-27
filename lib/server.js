/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const events=require('events'),
		Websocket=require('ws');

const Tunnel={
	stream:require('./tunnels/stream/streamTunnel.js'),
	subStream:require('./tunnels/subStream/subStreamTunnel.js'),
}

//options:see https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback
/*
events
	tunnel:(new tunnel)
	Websocket Server events

properties
	allowedStreamMode : (Array)allowed stream mode
	tunnels : (Map)all created tunnels 
	Websocket Server properties
*/
class tunnelServer extends Websocket.Server{
	constructor(options,callback){//the optiosns obj is used as Websocket server's options
		super(options,callback);
		let server=this;
		this.allowedStreamMode=new Set(['subStream','stream']);

		this.tunnels=new Map();//ws.tunnelID=>tunnel
		this.wsMap=new WeakMap();//tunnel=>ws
		this.reqMap=new WeakMap();//ws=>req

		this.close=this.close.bind(this);

		function getTunnel(){return server.tunnels.get(this.tunnelID);}
		this.on('connection',(ws,req)=>{
			Object.defineProperty(ws,'tunnel',{get:getTunnel,enumerable:true});
			this.reqMap.set(ws,req);
			ws._live=Date.now();
			ws._timer=setInterval(()=>{
				if(Date.now()-ws._live > 100000)//time out
					ws.terminate();
			},120000);
			ws.on('message',data=>{
				//if(ws.error)ws.error=null;//clear the error state
				ws._live=Date.now();
				if(typeof data !== 'string'){
					let tunnel=ws.tunnel;
					if(tunnel)tunnel.receive(data);
					else this._sendTunnelError(ws,3006,'binary data received before creating tunnel');
					return;
				}
				try{
					var c=JSON.parse(data);
				}catch(e){return;/*do nothing*/}
				switch(c._){
					case 'create':{//tunnel create msg
						if(ws.tunnel){//tunnel exists
							this._sendTunnelError(ws,3001,'tunnel already created');
							return;
						}
						//create tunnel
						if(!this.allowedStreamMode.has(c.mode)){//not an allowed mode
							this._sendTunnelError(ws,3002,'not allowed mode:'+c.mode);
							return;
						}
						if(!(c.mode in Tunnel)){
							this._sendTunnelError(ws,3003,'not supported tunnel type:'+c.mode);
							return;
						}

						//set the tunnel
						let tunnel=new Tunnel[c.mode].tunnel();
						while(this.tunnels.has(tunnel.id))//generate a new id if exists
							tunnel._genTunnelID();
						tunnel.send=ws.send.bind(ws);
						tunnel.keepBrokenTunnel=c.keepBrokenTunnel;
						ws.tunnelID=tunnel.id;
						this.wsMap.set(tunnel,ws);
						this.tunnels.set(ws.tunnelID,tunnel);
						if(c.timeout>=0)tunnel.timeout=c.timeout;
						tunnel.once('close',()=>{
							this.tunnels.delete(tunnel.id);
							this.wsMap.delete(tunnel);
						})._open();

						ws.send(JSON.stringify({_:'created',msg:tunnel.id}));
						
						this.emit('tunnel',tunnel);
						break;
					}
					case 'use':{//tunnel reuse msg
						let tunnel=this.tunnels.get(c.id);
						if(!tunnel){
							this._sendTunnelError(ws,3004,`tunnel of id '${c.id}' not exists`);
							break;
						}
						//reset the tunnel
						tunnel.send=ws.send.bind(ws);
						this.wsMap.set(tunnel,ws);
						ws.tunnelID=tunnel.id;
						if(tunnel._timer)clearTimeout(tunnel._timer);

						ws.send(JSON.stringify({_:'created',msg:tunnel.id}));
						break;
					}
					case 'close':{//force close tunnel
						if(ws.tunnel)ws.tunnel.close(c.msg||'closed by another side');
						break;
					}
					default:{
						this._sendTunnelError(ws,3005,'wrong configuration msg');
						break;
					}
				}
			}).on('ping',()=>{
				ws._live=Date.now();
			}).once('close',(code,reason)=>{
				clearInterval(ws._timer);
				let tunnel=ws.tunnel;
				if(!tunnel){
					this.reqMap.delete(ws);
					return;
				}

				if(code!==1000 && tunnel.keepBrokenTunnel){//if an error caused the closing and the tunnel was kept
					//the tunnel will be kept until the timeout
					if(!(tunnel.timeout>=0))tunnel.timeout=60000;
					tunnel._timer=setTimeout(()=>{
						tunnel.close('time out');
					},tunnel.timeout);
				}else{
					tunnel.close(`(${code})${reason||'websocket lost'}`);
				}
				this.reqMap.delete(ws);
			});
		});
		
		//close the server before exit
		process.on('beforeExit',this.close);
	}
	_sendTunnelError(ws,code,msg){
		ws.send(JSON.stringify({_:'error',code:code,msg:msg}));
	}
	getWsOfTunnel(tunnel){
		return this.wsMap.get(tunnel);
	}
	getReqOfWs(ws){
		return this.reqMap.get(ws);
	}
	close(){
		process.removeListener('beforeExit',this.close);
		super.close();
	}
}

exports.tunnelServer=tunnelServer;