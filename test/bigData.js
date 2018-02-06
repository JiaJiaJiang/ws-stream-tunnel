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
	host:'127.0.0.1',
	perMessageDeflate:false,//affects performance seriously
});

console.log('starting tunnel client')
var tClient=new tunnelClient({
	addr:'ws://127.0.0.1:65532',
	mode:'stream',
	ws:{
		perMessageDeflate:false
	}
});

let serverBytesReceived=0,clientBytesReceived=0;
//server
tServer.on('tunnel_open',t=>{
	console.log('server','new tunnel')
	t.on('stream_open',stream=>{
		console.log('server','stream opened')
		stream.on('data',d=>{
			serverBytesReceived+=d.byteLength;
			stream.write(d);//send back
		});
	}).on('stream_close',stream=>{
		console.log('server','stream closed')
	}).once('close',()=>{
		console.log('server','tunnel closed')
	});
});


//client
let clientStream;
let totalSize=256000000;
let testEnded=false;

tClient.on('tunnel_open',t=>{
	console.log('client','tunnel opened');
	t.on('stream_open',stream=>{
		console.log('client','stream opened')
		let sentBytes=0,clientLoggedSize=0;
		clientBytesReceived=serverBytesReceived=0;
		clientStream=stream;
		stream.on('data',d=>{clientBytesReceived+=d.byteLength;})
			.once('end',()=>{
				clearInterval(stream._logInterval);
				logProgress();
				setTimeout(()=>{
					askForTesting();
				},300);
			});

		clientStream._logInterval=setInterval(()=>{
			if(clientBytesReceived>=totalSize && clientBytesReceived===serverBytesReceived){
				clientStream.end();
				return;
			}
			logProgress();
		},1000);
		function logProgress(){
			if(testEnded)return;
			let s=byteSize(clientBytesReceived-clientLoggedSize);
			console.log('server received size:',serverBytesReceived,' client received size:',clientBytesReceived,'speed: ',`${s.value}${s.unit}/s`,`${(clientBytesReceived/totalSize*100).toFixed(1)}%`);
			clientLoggedSize=clientBytesReceived;
		}

		function clientSendData(size){
			testEnded=false;
			if(t.sendable() && clientStream.writable)
				clientStream.write(Buffer.allocUnsafe(1024));
			else{
				console.log('not sendable');
				return;
			}
			sentBytes+=size;
			if(sentBytes<totalSize)
				setImmediate(clientSendData,size);
		}

		clientSendData(1024);
	}).on('stream_close',stream=>{
		console.log('client','stream closed')
	}).on('error',e=>{
		console.error('client:error',e)
	}).once('close',()=>{
		console.log('client','tunnel closed')
	});

	function askForTesting(){
		rl.question('Strat the test? ', (answer) => {
			t.createStream();
		});
	}

	askForTesting();
});



