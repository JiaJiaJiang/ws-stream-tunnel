# ws-stream-tunnel

For node.js

use node.js stream over websocket.

## Usage
Create a `server`,then use `client` to connect it. The client will negotiate with server about the tunnel type and create the same type of the tunnel on both side.
Then the tunnel will be used to transfer stream.

## Tunnel types

* subStream : mix multi-streams in one tunnel

------

## server

### Class : tunnelServer(options)

The server class extends from `ws.server`,`options` is the same with [here](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback).

*One new event*
* 'tunnel' : (new tunnel)

*Two new properties*
* allowedStreamMode : (Array)allowed stream mode
* tunnels : (Map)all created tunnels 

## client
The server class extends from `events`.

### Class : tunnelClient(options)

*options*
* mode : tunnel type.
* retry : max retry limit
* addr : target ws address
* ws : options object for ws connection,see [here](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options)
* idleTimeout : millisecond before closing the connection,0 presents always keep the connection,defaults to 0

*events*
* 'tunnel_open':(tunnel)
* 'tunnel_close':(tunnel)

*properties*
* connectionManager : connectionManager instance
* tunnelID
* closed : boolean
* tunnelCreated : boolean
* tunnel : tunnel of the `mode` options

*methods*
#### close()

close the client


### closeTunnel(reason)

close the tunnel,this method will destroy all alive streams,the reason will be emit as the error event to each stream.


# extra

Tunnel types extends from `tunnelManager` class in `tunnel.js`,tunnels are defined in `tunnels` directory.See `README.md` in each dirs.