# ws-stream-tunnel

For node.js

use node.js stream over websocket.

## Install

```
npm i ws-stream-tunnel --save
```

## Usage
Create a `server`,then use `client` to connect it. The client will negotiate with server about the tunnel type and create the same type of the tunnel on both side.
Then the tunnel will be used to transfer stream.

## Tunnel types

* subStream : mix multi-streams in one tunnel
* stream : extends from subStream,but only allows one stream in the tunnel

------

## server

### Class : tunnelServer(options)

The server class extends from `ws.server`,`options` is the same with [here](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback).

*One new event*
* 'tunnel_open' : (new tunnel)
* 'tunnel_close' : (the closed tunnel)

*One more property*
* tunnelHelper : see tunnelHelper below

## client
The server class extends from `events`.

### Class : tunnelClient(options)

*options*
* mode : tunnel type
* addr : target ws address
* ws : options object for ws connection,see [here](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options)
* idleTimeout : millisecond before closing the connection,0 presents always keep the connection,defaults to 0
* keepBrokenTunnel : millisecond before closing the broken tunnel. The tunnel will immediately close if this option is not set

*events*
* 'tunnel_open':(tunnel)
* 'tunnel_close':(tunnel)

*properties*
* connectionManager : connectionManager instance
* tunnelHelper : tunnelHelper instance
* closed : boolean

*getters*
* tunnelID
* tunnelCreated : boolean
* tunnel : tunnel of the `mode` options

*methods*
#### close()

close the client

#### closeTunnel(reason)

close the tunnel,this method will destroy all alive streams,the reason will be emit as the error event to each stream.

#### requestTunnel(options)

request a tunnell for the connection

options:
* mode : see `Tunnel types` on the top
* keepBrokenTunnel : see `tunnelClient` options

If tunnelID exists, the client will attempt to use the tunnel ID to resume the broken tunnel transfer.

# extra

Tunnel types extends from `tunnelManager` class in `lib/tunnel.js`,tunnels are defined in `tunnels` directory.See `README.md` in each dirs.