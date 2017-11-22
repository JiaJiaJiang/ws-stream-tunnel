/*
subStream tunnel test (without ws)
*/
setInterval(function(){},999999)//keep process running

const {subStreamTunnel}=require('../lib/tunnels/subStream/subStreamTunnel.js');

var clisntSide=new subStreamTunnel();
var serverSide=new subStreamTunnel();
clisntSide.name='clientSide';
serverSide.name='serverSide';
clisntSide.on('invalid_data',d=>console.log('client: invalid_data',d))
serverSide.on('invalid_data',d=>console.log('server: invalid_data',d))

clisntSide.send=function(data,options,callback){
	setImmediate(()=>{
		callback&&callback();
		serverSide.receive(data);
	});
}


serverSide.send=function(data,options,callback){
	setImmediate(()=>{
		callback&&callback();
		clisntSide.receive(data)
	});
}

let dataToSend=[
	Buffer.allocUnsafe(20),
	Buffer.allocUnsafe(20),
	Buffer.allocUnsafe(20),
	Buffer.allocUnsafe(20),
];

serverSide.on('stream_open',stream=>{
	let dataReceived=[];
	console.log('server: open stream')
	stream.on('data',d=>{dataReceived.push(d);});
	stream.on('end',()=>{
		console.log('server: stream closed,comparing data')
		let receivedBuffer=Buffer.concat(dataReceived);
		if(receivedBuffer.compare(Buffer.concat(dataToSend))===0){
			console.log('comparing result:pass');
		}else{
			console.log('comparing result:error');
		}
	});
})

for(let i=0;i<20;i++){//start 20 subStreams to test
	console.log('client: creating subStream')
	let sub=clisntSide.createSubStream();
	sub.on('open',stream=>{
		console.log('client',sub.sid,': subStream opened')
		console.log('client',sub.sid,': write buffer')
		stream.write(dataToSend[0]);
		stream.write(dataToSend[1]);
		stream.write(dataToSend[2]);
		stream.end(dataToSend[3],()=>{
			console.log('client',sub.sid,': buffer written')
		});
	}).on('close',()=>{
		console.log('client',sub.sid,': subStream closed')
	}).on('error',e=>{
		console.error('client',sub.sid,':error',e)
	})
}


