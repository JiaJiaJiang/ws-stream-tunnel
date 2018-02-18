/*
Copyright luojia@luojia.me
MIT LICENSE
*/

/*
for detecting network changing
*/
const os=require('os');

let networkInterfaces=os.networkInterfaces();
setInterval(()=>{
	//refresh the networkInterfaces
	networkInterfaces=os.networkInterfaces();
},1000);

function detect(socket){
	let changed=false;
	let timer=setInterval(()=>{//find changes
		if(changed || !socket.remoteAddress)return;
		for(let i in networkInterfaces){
			for(let addr of networkInterfaces[i]){
				if(addr.address===socket.localAddress){
					return;//not changed
				}
			}
		}
		changed=true;
		clearInterval(timer);
		socket.emit('networkChanged');
	},1000);
	socket.on('close',()=>{//detach the detector if socket closed
		clearInterval(timer);
	});
}

exports.detect=detect;