/*
subStream tunnel test (without ws)
*/
setInterval(function(){},999999)//keep process running

const streamTunnel=require('../lib/tunnels/stream/streamTunnel.js').tunnel;

var clisntSide=new streamTunnel();
var serverSide=new streamTunnel();
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

//server side
serverSide.on('stream_open',stream=>{
	let dataReceived=[];
	console.log('server: open stream')
	stream.on('data',d=>{dataReceived.push(d);});
	stream.on('end',()=>{
		console.log('server','stream closed,comparing data')
		let receivedBuffer=Buffer.concat(dataReceived);
		if(receivedBuffer.compare(Buffer.concat(dataToSend))===0){
			console.log('comparing result:pass');
		}else{
			console.log('comparing result:error');
		}
	}).on('error',e=>{
		console.error('server','error',e)
	});
})


//client side
console.log('client: creating stream')
let stream=clisntSide.createStream();
stream.on('tunnel_stream_open',()=>{
	console.log('client','stream opened')
	console.log('client','write buffer')
	stream.write(dataToSend[0]);
	stream.write(dataToSend[1]);
	stream.write(dataToSend[2]);
	stream.end(dataToSend[3],()=>{
		console.log('client','buffer written')
	});
}).on('error',e=>{
	console.error('client','error',e)
});

clisntSide._open();
serverSide._open();