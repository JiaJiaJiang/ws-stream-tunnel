#subStream Tunnel

this tunnel can create many streams in one connection.

streams are separated to binary encapsulation frames.

When a subStream is created on one side,a "start stream" frame will be sent to another side,then a "stream started" frame will be sent back,so the subStream established.

When a subStream ended on one side,a "close stream" frame will be sent to another side,then the subStream closed.

stream frame data
	bits
	0-2 	0:data frame 		1:start stream 		2:close stream 
		 	4:stream started  	5:stream closed		6:error frame 
		 	7:read frame
	3-4		reserved
	5-7	 	following id bytes count,represents 0-4 bytes(0 for id 0)
	...		id
	...		data

If the id is 0,there is no followed idBytes.

data of:
	(0)data frame:data to be transported
	(1)start frame:none
	(2)close frame:none
	(4)started frame:none
	(5)closed frame:none
	(6)error frame:error message
	(7)read frame:read size that the remote advises

If one side received a start frame which sid already exists,the existing stream will be destroyed
