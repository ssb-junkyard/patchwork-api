# Patchwork API

[Patchwork's](/patchwork) rpc api module

**the api docs below are outdated, will update soon**

```js
var patchworkAPI = require('ssb-patchwork-api')

patchworkAPI.manifest    // rpc manifest
patchworkAPI.permissions // rpc permissions

var api = patchworkAPI.init(sbot) // create plugin api instance

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

api.getActionItems(cb) // gets tasks that need the user's attention

api.getNamesById(cb) // gets map of id->names
api.getName(id, cb) // gets name for the given id
api.getIdsByName(cb) // gets map of names->id
```