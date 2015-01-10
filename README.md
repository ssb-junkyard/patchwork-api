# Phoenix API

methods for reading and writing to the log from the phoenix gui

```js
require('phoenix-api')(ssbRpcApi, function(err, api) {
  if (err)
    throw err

  api.getMyId() // returns this user's id

  api.getMsg(key, cb) // get message data
  api.getNumReplies(key) // returns # of replies to a message
  api.getReplies(key, cb) // get replies to a message

  api.getPosts({ start:, end: }, cb) // get post messages
  api.getInbox({ start:, end: }, cb) // get post messages
  api.getAdverts({ start:, end: }, cb) // get post messages
  api.getRandomAdverts(num, oldest, cb) // get `num` adverts from the `oldest` most recent messages

  api.getProfile(id) // returns profile
  api.getAllProfiles() // returns all profiles in id->profile map
  api.getGraph(type, cb) // get friends graph (type may be 'follow', 'trust', or 'edge')
  api.getNameById(id) // returns user's name
  api.getIdByName(name) // returns user's id

  api.postText(text, cb) // publish post
  api.postReply(text, parentKey, cb) // publish reply
  api.postAdvert(text, cb) // publish advert

  api.nameSelf(name, cb) // publish new name for self
  api.nameOther(target, name, cb) // publish new name for target

  api.addEdge(type, target, cb) // publish new edge from self to target (type may be 'follow', 'trust', or 'edge')
  api.delEdge(type, target, cb) // publish deleted edge from self to target (type may be 'follow', 'trust', or 'edge')
})
```