/*
Copyright luojia@luojia.me
MIT LICENSE
*/

'use strict';
const events=require('events'),
		Websocket=require('ws');

const {subStreamTunnel}=require('./tunnels/subStream/subStreamTunnel.js');

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
		this.allowedStreamMode=['subStream'];
		this.tunnels=new Map();
		function getTunnel(){return server.tunnels.get(this.tunnelID);}
		this.on('connection',(ws,req)=>{
			Object.defineProperty(ws,'tunnel',{get:getTunnel,enumerable:true});
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
								ws.send(JSON.stringify({_:'error',msg:'tunnel already created'}));
								return;
							}
							//create tunnel
							if(this.allowedStreamMode.indexOf(c.mode)<0){//not an allowed mode
								ws.send(JSON.stringify({_:'error',msg:'not allowed mode:'+c.mode}));
								return;
							}
							let tunnel;
							switch(c.mode){
								case 'subStream':{
									tunnel=new subStreamTunnel();
									while(this.tunnels.has(tunnel.id))//generate a new id if exists
										tunnel._genTunnelID();
									tunnel.send=ws.send.bind(ws);
									ws.tunnelID=tunnel.id;
									this.tunnels.set(ws.tunnelID,tunnel);
									ws.send(JSON.stringify({_:'created',msg:tunnel.id}));
									break;
								}
								default:{
									ws.send(JSON.stringify({_:'error',msg:'not supported tunnel type:'+c.mode}));
									break;
								}
							}
							if(c.timeout>=0)tunnel.timeout=c.timeout;
							tunnel.once('close',()=>{
								this.tunnels.delete(tunnel.id);
							});
							this.emit('tunnel',tunnel);
							break;
						}
						case 'use':{
							let tunnel=this.tunnels.get(c.id);
							if(!tunnel){
								ws.send(JSON.stringify({_:'error',msg:`tunnel of id '${c.id}' not exists`}));
								break;
							}
							ws.send(JSON.stringify({_:'created',msg:tunnel.id}));
							ws.tunnelID=tunnel.id;
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
							ws.send(JSON.stringify({_:'error',msg:'wrong configuration msg'}));
							break;
						}
					}
				}else if(data instanceof ArrayBuffer || ArrayBuffer.isView(data)){
					let tunnel=ws.tunnel;
					if(tunnel){
						tunnel.receive(data);
					}else{
						ws.send(JSON.stringify({_:'error',msg:'binary data received before creating tunnel'}));
					}
				}else{
					console.error('unkonwn data',data)
				}
			}).once('close',(code,reason)=>{
				if(ws.error){//if the a error caused the closing
					//error of a ws connection won't cause the closing of a tunnel
					//the tunnel will be kept until the timeout
					let tunnel=ws.tunnel;
					if(!(tunnel.timeout>=0))tunnel.timeout=60000;
					tunnel._timer=setTimeout(()=>{
						tunnel.close('time out');
					},tunnel.timeout);
					return;
				}
				//normal close
				if(ws.tunnel && !ws.tunnel.closed)ws.tunnel.close('connection closed');
			}).on('error',e=>{
				ws.error=e;
			});
		}).on('error',e=>{
			//todo : do sth
			console.error(e);
		});
		
	}
}

exports.tunnelServer=tunnelServer;