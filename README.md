# ws-stream-tunnel
------

For node.js

use node.js stream over websocket.

## Usage
Create a `server`,then use `client` connect it. The client will negotiate with server about the tunnel and create the same type of the tunnel on both side.
Then the tunnel will be used to transfer stream.

## Tunnel types

* subStream : mix multi-streams in one tunnel

