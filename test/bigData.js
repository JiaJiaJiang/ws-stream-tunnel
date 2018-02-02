/*
this file is for testing memory leak

the server and client sends data to each other
*/
const byteSize = require('byte-size');
const {tunnelServer}=require('../lib/server.js');
const {tunnelClient}=require('../lib/client.js');
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('starting tunnel server')
var tServer=new tunnelServer({
	port:65532,
	perMessageDeflate:false/*{
		level:9,
		memLevel:1,

	}*/,
});

console.log('starting tunnel client')
var tClient=new tunnelClient({
	addr:'ws://127.0.0.1:65532',
	mode:'stream',
	ws:{
		perMessageDeflate:false
	}
});

let serverBytesReceived=0;
//server
tServer.on('tunnel',t=>{
	console.log('server','new tunnel')
	t.on('stream_open',stream=>{
		console.log('server','stream opened')
		stream.on('data',d=>{
			serverBytesReceived+=d.byteLength;
			stream.write(d);//send back
		});
	}).once('close',()=>{
		console.log('server','tunnel closed')
	})
});


//client
let sentBytes=0;
let clientStream;
let totalSize=256000000;
let clientBytesReceived=0,clientLoggedSize=0;
let testEnded=false;
tClient.tunnel.on('stream_open',stream=>{
	console.log('client','stream opened')
	clientStream=stream;
	stream.on('data',d=>{clientBytesReceived+=d.byteLength;});

	setInterval(()=>{
		if(clientLoggedSize==clientBytesReceived){
			!testEnded&&askForTesting();
			testEnded=true;
			return;
		}
		let s=byteSize(clientBytesReceived-clientLoggedSize);
		console.log('server received size:',serverBytesReceived,' client received size:',clientBytesReceived,'speed: ',`${s.value}${s.unit}/s`,`${(clientBytesReceived/totalSize*100).toFixed(1)}%`);
		clientLoggedSize=clientBytesReceived;
	},1000);
	
	

}).on('stream_close',stream=>{
	console.log('client','stream closed')
}).on('error',e=>{
	console.error('client:error',e)
}).once('close',()=>{
	console.log('client','tunnel closed')
})

tClient.on('tunnel_open',()=>{
	console.log('client','tunnel opened')
	tClient.tunnel.createStream();
});

function clientSendData(size){
	testEnded=false;
	clientStream.write(Buffer.allocUnsafe(size));
	sentBytes+=size;
	if(sentBytes<totalSize)
		setImmediate(clientSendData,size);
}

function askForTesting(){
	rl.question('Strat the test? ', (answer) => {
		sentBytes=clientBytesReceived=serverBytesReceived=clientLoggedSize=serverLoggedSize=0;
		clientSendData(1024);
	});
}