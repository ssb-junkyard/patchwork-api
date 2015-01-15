# Phoenix API

scuttlebot rpc methods for accessing the log from the phoenix gui

```js
var phoenixAPI = require('phoenix-api')

phoenixAPI.manifest    // rpc manifest
phoenixAPI.permissions // rpc permissions

var api = phoenixAPI.init(sbot) // create plugin api instance

pull(api.events(), pull.drain(function (event))) // event emitting stream
// emits { type: 'post', post: Object } for each new toplevel post

api.getFeed({ gt:, gte:, lt:, lte:, limit:, reverse: }, cb) // get raw messages. gt/e, lt/e can be message objects

api.getPosts({ start:, end: }, cb) // get post messages. start/end are offsets
api.getPostCount(cb) // get number of post messages

api.getInbox({ start:, end: }, cb) // get post messages which reply to or mention the author. start/end are offsets
api.getInboxCount(cb) // get number of post messages in the inbox

api.getAdverts({ start:, end: }, cb) // get advert messages. start/end are offsets
api.getAdvertCount(cb) // get number of adverts
api.getRandomAdverts(num, oldest, cb) // get `num` adverts from the `oldest` most recent messages

api.getMsg(key, cb) // get message data
api.getReplies(key, cb) // get replies to a message
api.getPostParent(key, cb) // get parent post to a reply (null if none)
api.getThread(key, cb) // get full thread (replies, replies to replies, etc)
api.getThreadMeta(key, cb) // gets metadata for the thread at the given key
api.getAllThreadMetas(cb) // gets metadata for all threads in a key->meta map
// metadata object: { parent:, replies: [keys], numThreadReplies: }

api.getMyProfile(cb) // gets this user's profile
api.getProfile(id, cb) // gets profile
api.getAllProfiles(cb) // gets all profiles in id->profile map

api.getNamesById(cb) // gets map of id->names
api.getName(id, cb) // gets name for the given id
api.getIdsByName(cb) // gets map of names->id
```