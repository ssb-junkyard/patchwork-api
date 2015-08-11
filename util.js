var mlib = require('ssb-msgs')
var EventEmitter = require('events').EventEmitter

module.exports.index = function () {
  var index = new EventEmitter()
  index.rows = []

  index.sortedInsert = function (ts, key) {
    var row = { ts: ts, key: key }
    for (var i=0; i < index.rows.length; i++) {
      if (index.rows[i].ts < ts) {
        index.rows.splice(i, 0, row)
        index.emit('add', row)
        return row
      }
    }
    index.rows.push(row)
    index.emit('add', row)
    return row
  }

  index.sortedUpsert = function (ts, key) {
    var i = index.indexOf(key)
    if (i !== -1) {
      // readd to index at new TS
      if (index.rows[i].ts < ts) {
        var oldrow = index.rows[i]
        index.rows.splice(i, 1)
        var newrow = index.sortedInsert(ts, key)
        for (var k in oldrow) {
          if (k != 'ts')
            newrow[k] = oldrow[k]
        }
        return newrow
      } else
        return index.rows[i]
    } else {
      // add to index
      return index.sortedInsert(ts, key)
    }
  }

  index.indexOf = function (key, keyname) {
    keyname = keyname || 'key'
    for (var i=0; i < index.rows.length; i++) {
      if (index.rows[i][keyname] === key)
        return i
    }
    return -1
  }

  index.find = function (key, keyname) {
    var i = index.indexOf(key, keyname)
    if (i !== -1)
      return index.rows[i]
    return null
  }

  index.contains = function (key) {
    return index.indexOf(index, key) !== -1
  }

  index.filter = index.rows.filter.bind(index.rows)

  return index
}


module.exports.getRootMsg = function (sbot, msg, cb) {
  var mid = mlib.link(msg.value.content.root || msg.value.content.branch, 'msg').link
  up()
  function up () {
    sbot.get(mid, function (err, msgvalue) {
      if (err)
        return cb(err)

      // not found? stop here
      if (!msgvalue)
        return cb()

      // ascend
      var link = mlib.link(msgvalue.content.root || msgvalue.content.branch, 'msg')
      if (link) {
        mid = link.link
        return up()
      }

      // topmost, finish
      cb(null, { key: mid, value: msgvalue })
    })
  }
}