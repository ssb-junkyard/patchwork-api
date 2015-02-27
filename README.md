# Phoenix API v5

The backend logic for Phoenix, accessed through the scuttlebot RPC interface. Adds its functions

```js
var phoenixAPI = require('phoenix-api')

phoenixAPI.manifest    // rpc manifest
phoenixAPI.permissions // rpc permissions

var api = phoenixAPI.init(sbot) // create plugin api instance

pull(api.createEventStream(), pull.drain(function (event))) // event emitting stream
// emits { type: 'mesage', msg: Object }       for each new message
// emits { type: 'notification', msg: Object } for each reply/mention event

api.getIndexCounts(cb) // => { inbox: Number, inboxUnread: Number, adverts: Number }
api.createInboxStream({ gt: [ts], lt: [ts], gte: [ts], lte: [ts], limit: Number })
api.createAdvertStream({ gt: [ts], lt: [ts], gte: [ts], lte: [ts], limit: Number })
api.getRandomAdverts(num, oldest, cb) // get `num` adverts from the `oldest` most recent messages

api.markRead(key, cb)
api.markUnread(key, cb)
api.toggleRead(key, cb)
api.isRead(key, cb)

api.subscribe(key, cb)
api.unsubscribe(key, cb)
api.toggleSubscribed(key, cb)
api.isSubscribed(key, cb)

api.getMyProfile(cb) // gets this user's profile
api.getProfile(id, cb) // gets profile
api.getAllProfiles(cb) // gets all profiles in id->profile map

api.getNamesById(cb) // gets map of id->names
api.getNameTrustRanks(cb) // gets map of id->trust-ranks, where trust rank is a range from 0 (no confidence) to 1 (full confidence)
api.getName(id, cb) // gets name for the given id
api.getIdsByName(cb) // gets map of names->id
```