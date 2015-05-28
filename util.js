var mlib = require('ssb-msgs')

module.exports.sortedInsert = function (index, ts, key) {
  var row = { ts: ts, key: key }
  for (var i=0; i < index.length; i++) {
    if (index[i].ts < ts) {
      index.splice(i, 0, row)
      return row
    }
  }
  index.push(row)
  return row
}

module.exports.sortedUpsert = function (index, ts, key) {
  var i = module.exports.indexOf(index, key)
  if (i !== -1) {
    // readd to index at new TS
    if (index[i].ts < ts) {
      index.splice(i, 1)
      return module.exports.sortedInsert(index, ts, key)
    } else
      return index[i]
  } else {
    // add to index
    return module.exports.sortedInsert(index, ts, key)
  }
}

module.exports.indexOf = function (index, key) {
  for (var i=0; i < index.length; i++) {
    if (index[i].key === key)
      return i
  }
  return -1
}

module.exports.find = function (index, key) {
  var i = module.exports.indexOf(index, key)
  if (i !== -1)
    return index[i]
  return null
}

module.exports.contains = function (index, key) {
  return module.exports.indexOf(index, key) !== -1
}


module.exports.getRootMsg = function (sbot, msg, cb) {
  var mid = mlib.link(msg.value.content.thread || msg.value.content.repliesTo, 'msg').msg
  up()
  function up () {
    sbot.ssb.get(mid, function (err, msgvalue) {
      if (err)
        return cb(err)

      // not found? stop here
      if (!msgvalue)
        return cb()

      // ascend
      var link = mlib.link(msgvalue.content.thread || msgvalue.content.repliesTo, 'msg')
      if (link) {
        mid = link.msg
        return up()
      }

      // topmost, finish
      cb(null, { key: mid, value: msgvalue })
    })
  }
}