# Phoenix API

methods for reading and writing to the log from the phoenix gui

```js
var api = require('phoenix-api')(ssbRpcApi)

// initiate the indexing process
// - call this any time the connection is created (eg on init, after disconnects)
api.startIndexing(function (err) {
  if (err)
    throw err

  // get functions only work after startIndexing has called its cb

  api.on('post', cb) // emitted on each new toplevel post

  api.getMyId() // returns this user's id
  api.getMyProfile() // returns this user's profile

  api.getMsg(key, cb) // get message data
  api.getNumReplies(key) // returns # of replies to a message
  api.getNumThreadReplies(key) // returns # of replies to a message's thread
  api.getReplies(key, cb) // get replies to a message
  api.getPostParent(key, cb) // get parent post to a reply (null if none)
  api.getThread(key, cb) // get full thread (replies, replies to replies, etc)

  api.getFeed({ gt:, gte:, lt:, lte:, limit:, reverse: }, cb) // get raw messages. gt/e, lt/e can be message objects
  api.getPosts({ start:, end: }, cb) // get post messages. start/end are offsets
  api.getInbox({ start:, end: }, cb) // get post messages which reply to or mention the author. start/end are offsets
  api.getAdverts({ start:, end: }, cb) // get advert messages. start/end are offsets
  api.getRandomAdverts(num, oldest, cb) // get `num` adverts from the `oldest` most recent messages

  api.getProfile(id) // returns profile
  api.getAllProfiles() // returns all profiles in id->profile map
  api.getGraph(type, cb) // get friends graph (type may be 'follow', 'trust', or 'edge')
  api.getNames() // returns map of id->names
  api.getName(id) // returns user's name
  api.getNameById(id) // returns user's name
  api.getIdByName(name) // returns user's id

  api.postText(text, cb) // publish post
  api.postReply(text, parentKey, cb) // publish reply
  api.postAdvert(text, cb) // publish advert

  api.nameSelf(name, cb) // publish new name for self
  api.nameOther(target, name, cb) // publish new name for target

  api.addEdge(type, target, cb) // publish new edge from self to target (type may be 'follow', 'trust', or 'edge')
  api.delEdge(type, target, cb) // publish deleted edge from self to target (type may be 'follow', 'trust', or 'edge')

  api.useInvite(invite, cb)
})
```