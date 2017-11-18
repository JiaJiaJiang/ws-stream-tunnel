/*
this file is for testing function of client.js and server.js
*/
const {tunnelServer}=require('../lib/server.js');
const {tunnelClient}=require('../lib/client.js');

let dataToSend=[
	Buffer.allocUnsafe(20),
	Buffer.allocUnsafe(20),
	Buffer.allocUnsafe(20),
];


//server
console.log('starting tunnel server')
var tServer=new tunnelServer({
	port:65532,
	perMessageDeflate:true,
});

tServer.on('tunnel',t=>{
	console.log('server','new tunnel')
	t.on('stream_open',subStream=>{
		let dataReceived=[];
		subStream.stream.on('data',d=>{dataReceived.push(d);});
		subStream.stream.on('end',()=>{
			console.log('server:','subStream ended,comparing data')
			let receivedBuffer=Buffer.concat(dataReceived);
			if(receivedBuffer.compare(Buffer.concat(dataToSend))===0){
				console.log('comparing result:pass');
			}else{
				console.log('comparing result:error');
			}
		});
	}).on('stream_close',subStream=>{
		console.log('server','subStream closed')
	}).once('close',()=>{
		console.log('server','tunnel closed')
	})
}).on('connection',ws=>{
	ws.on('close',()=>console.log('server','ws closed'))
});


//client
console.log('starting tunnel client')
var tClient=new tunnelClient({
	addr:'ws://127.0.0.1:65532',
	mode:'subStream',
	idleTimeout:3000,
});
tClient.connectionManager.on('_wsclose',ws=>{
	console.log('client','ws closed')
}).on('_wsopen',ws=>{
	console.log('client','ws opend')
});
tClient.tunnel.on('stream_open',subStream=>{
	console.log('client','subStream opened')
	console.log('client','write buffer')
	subStream.stream.write(dataToSend[0]);
	subStream.stream.write(dataToSend[1]);
	subStream.stream.write(dataToSend[2]);
	subStream.stream.end(dataToSend[3],()=>{
		console.log('client: buffer written')
	});

}).on('stream_close',subStream=>{
	console.log('client','subStream closed')
}).on('error',e=>{
	console.error('client','error',e)
}).once('close',()=>{
	console.log('client','tunnel closed')
});

tClient.on('tunnel_open',()=>{
	console.log('client','open tunnel')
	var sub=tClient.tunnel.createSubStream();
	sub.on('open',()=>{
		console.log('client','tunnel opened')
	})
});

//active idle connection
setInterval(()=>{
	console.log('client','open tunnel')
	var sub=tClient.tunnel.createSubStream();
	sub.on('open',()=>{
		console.log('client','tunnel opened')
	})
},10000);


process.on('uncaughtException',e=>{
	console.error(e)
})