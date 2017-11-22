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

console.log('starting tunnel server')
var tServer=new tunnelServer({
	port:65532,
	perMessageDeflate:true,
});

console.log('starting tunnel client')
var tClient=new tunnelClient({
	addr:'ws://127.0.0.1:65532',
	mode:'subStream',
});

//server
tServer.on('tunnel',t=>{
	console.log('server','new tunnel')
	t.on('stream_open',stream=>{
		let dataReceived=[];
		stream.on('data',d=>{dataReceived.push(d);});
		stream.on('end',()=>{
			console.log('server:','stream ended,comparing data')
			let receivedBuffer=Buffer.concat(dataReceived);
			if(receivedBuffer.compare(Buffer.concat(dataToSend))===0){
				console.log('comparing result:pass');
			}else{
				console.log('comparing result:error');
			}
		});
	}).once('close',()=>{
		console.log('server','tunnel closed')
	})
});


//client
tClient.tunnel.on('stream_open',stream=>{
	console.log('client: stream opened')
	console.log('client: write buffer')
	stream.write(dataToSend[0]);
	stream.write(dataToSend[1]);
	stream.write(dataToSend[2]);
	stream.end(dataToSend[3],()=>{
		console.log('client: buffer written')
	});

}).on('stream_close',stream=>{
	console.log('client: subStream closed')
}).on('error',e=>{
	console.error('client:error',e)
}).once('close',()=>{
	console.log('client','tunnel closed')
})

tClient.on('tunnel_open',()=>{
	console.log('client','tunnel opened')
	var sub=tClient.tunnel.createSubStream();
});