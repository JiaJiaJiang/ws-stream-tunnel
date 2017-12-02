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
		this.allowedStreamMode=['subStream','stream'];
		this.tunnels=new Map();
		this.wsMap=new WeakMap();
		this.reqMap=new WeakMap();
		function getTunnel(){return server.tunnels.get(this.tunnelID);}
		this.on('connection',(ws,req)=>{
			Object.defineProperty(ws,'tunnel',{get:getTunnel,enumerable:true});
			this.reqMap.set(ws,req);
			ws.on('message',data=>{
				if(ws.error)ws.error=null;//clear the error state
				if(typeof data === 'string'){//maybe a configuration message
					try{
						var c=JSON.parse(data);
					}catch(e){/*do nothing*/}
					switch(c._){
						case 'create':{
							if(ws.tunnel){//tunnel exists
								//send error message
								ws.send(JSON.stringify({_:'error',code:3001,msg:'tunnel already created'}));
								return;
							}
							//create tunnel
							if(this.allowedStreamMode.indexOf(c.mode)<0){//not an allowed mode
								ws.send(JSON.stringify({_:'error',code:3002,msg:'not allowed mode:'+c.mode}));
								return;
							}
							let tunnel;
							if(!(c.mode in Tunnel)){
								ws.send(JSON.stringify({_:'error',code:3003,msg:'not supported tunnel type:'+c.mode}));
								return;
							}

							tunnel=new Tunnel[c.mode].tunnel();
							while(this.tunnels.has(tunnel.id))//generate a new id if exists
								tunnel._genTunnelID();
							tunnel.send=ws.send.bind(ws);
							ws.tunnelID=tunnel.id;
							this.tunnels.set(ws.tunnelID,tunnel);
							this.wsMap.set(tunnel,ws);
							ws.send(JSON.stringify({_:'created',msg:tunnel.id}));

							if(c.timeout>=0)tunnel.timeout=c.timeout;
							tunnel.once('close',()=>{
								this.tunnels.delete(tunnel.id);
							});
							tunnel._open();
							this.emit('tunnel',tunnel);
							break;
						}
						case 'use':{
							let tunnel=this.tunnels.get(c.id);
							if(!tunnel){
								ws.send(JSON.stringify({_:'error',code:3004,msg:`tunnel of id '${c.id}' not exists`}));
								break;
							}
							tunnel.send=ws.send.bind(ws);
							ws.send(JSON.stringify({_:'created',msg:tunnel.id}));
							ws.tunnelID=tunnel.id;
							this.wsMap.set(tunnel,ws);
							if(tunnel._timer){
								clearTimeout(tunnel._timer);
							}
							break;
						}
						case 'close':{//force close tunnel
							if(ws.tunnel)ws.tunnel.close(c.msg||'closed by another side');
							break;
						}
						default:{
							ws.send(JSON.stringify({_:'error',code:3005,msg:'wrong configuration msg'}));
							break;
						}
					}
				}else{
					let tunnel=ws.tunnel;
					if(tunnel){
						tunnel.receive(data);
					}else{
						ws.send(JSON.stringify({_:'error',code:3006,msg:'binary data received before creating tunnel'}));
					}
				}
			}).once('close',(code,reason)=>{
				if(code===1000){
					//normal close
					if(ws.tunnel && !ws.tunnel.closed)ws.tunnel.close('connection closed');
				}else{//if a error caused the closing
					//error of a ws connection won't cause the closing of a tunnel
					//the tunnel will be kept until the timeout
					let tunnel=ws.tunnel;
					if(!(tunnel.timeout>=0))tunnel.timeout=60000;
					tunnel._timer=setTimeout(()=>{
						tunnel.close('time out');
					},tunnel.timeout);
					return;
				}
			}).on('error',e=>{
				ws.error=e;
			});
		}).on('error',e=>{
			//todo : do sth
			console.error(e);
		});
		
	}
	getWsOfTunnel(tunnel){
		return this.wsMap.get(tunnel);
	}
	getReqOfWs(ws){
		return this.reqMap.get(ws);
	}
}

exports.tunnelServer=tunnelServer;