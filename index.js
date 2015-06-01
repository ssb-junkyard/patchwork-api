var pull     = require('pull-stream')
var multicb  = require('multicb')
var pl       = require('pull-level')
var pushable = require('pull-pushable')
var u        = require('./util')

exports.manifest    = require('./manifest')
exports.permissions = require('./permissions')

exports.init = function (sbot) {

  var api = {}
  var phoenixdb = sbot.ssb.sublevel('phoenix')
  var db = {
    isread: phoenixdb.sublevel('isread'),
    subscribed: phoenixdb.sublevel('subscribed')
  }
  var state = {
    // indexes (lists of {key:, ts:})
    mymsgs: [],
    home: [], // also has `.isread`
    inbox: [], // also has `.isread`

    // views
    profiles: {},
    trustedProfiles: {},
    names: {}, // ids -> names
    nameTrustRanks: {}, // ids -> trust-ranks
    ids: {}, // names -> ids
    actionItems: {}
  }

  var processor = require('./processor')(sbot, db, state, emit)
  pull(pl.read(sbot.ssb.sublevel('log'), { live: true, onSync: onPrehistorySync }), pull.drain(processor))

  // track sync state
  // - processor does async processing for each message that comes in
  // - awaitSync() waits for that processing to finish
  // - pinc() on message arrival, pdec() on message processed
  // - nP === 0 => all messages processed
  var nP = 0, syncCbs = []
  function awaitSync (cb) {
    if (nP > 0)
      syncCbs.push(cb)
    else cb()
  }
  state.pinc = function () { nP++ }
  state.pdec = function () {
    nP--
    if (nP === 0) {
      syncCbs.forEach(function (cb) { cb() })
      syncCbs.length = 0
    }
  }

  var isPreHistorySynced = false // track so we dont emit events for old messages
  // grab for history sync
  state.pinc()
  function onPrehistorySync () {
    awaitSync(function () { isPreHistorySynced = true })
    // release
    state.pdec()
  }

  // events stream
  var eventsStreams = []
  function emit (type) {
    if (!isPreHistorySynced)
      return
    eventsStreams.forEach(function (es) {
      es.push({ type: type })
    })
  }

  // getters

  api.createEventStream = function () {
    var es = pushable()
    eventsStreams.push(es)
    return es
  }

  api.getMyProfile = function (cb) {
    awaitSync(function () {
      api.getProfile(sbot.feed.id, cb)
    })
  }

  api.getIndexCounts = function (cb) {
    awaitSync(function () {
      cb(null, {
        inbox: state.inbox.length,
        inboxUnread: state.inbox.filter(function (row) { return !row.isread }).length,
        home: state.home.length
      })
    })
  }

  api.createInboxStream = indexStreamFn(state.inbox)
  api.createHomeStream = indexStreamFn(state.home)

  api.markRead = function (key, cb) {
    var row = u.find(state.inbox, key)
    if (row) {
      if (!row.isread)
        emit('inbox-remove')
      row.isread = true
    }
    db.isread.put(key, 1, cb)
  }
  api.markUnread = function (key, cb) {
    var row = u.find(state.inbox, key)
    if (row) {
      if (row.isread)
        emit('inbox-add')
      row.isread = false
    }
    db.isread.del(key, cb) 
  }
  api.toggleRead = function (key, cb) {
    api.isRead(key, function (err, v) {
      if (!v) {
        api.markRead(key, function (err) {
          cb(err, true)
        })
      } else {
        api.markUnread(key, function (err) {
          cb(err, false)
        })
      }
    })
  }
  api.isRead = function (key, cb) {
    if (Array.isArray(key)) {
      var done = multicb({ pluck: 1 })
      key.forEach(function (k, i) {
        var cb = done()
        db.isread.get(k, function (err, v) { cb(null, !!v) })
      })
      done(cb)
    } else {
      db.isread.get(key, function (err, v) {
        cb && cb(null, !!v)
      })
    }
  }
 
  api.subscribe = function (key, cb) {
    db.subscribed.put(key, 1, cb)
  }
  api.unsubscribe = function (key, cb) {
    db.subscribed.del(key, cb) 
  }
  api.toggleSubscribed = function (key, cb) {
    api.isSubscribed(key, function (err, v) {
      if (!v) {
        api.subscribe(key, function (err) {
          cb(err, true)
        })
      } else {
        api.unsubscribe(key, function (err) {
          cb(err, false)
        })
      }
    })
  }
  api.isSubscribed = function (key, cb) {
    db.subscribed.get(key, function (err, v) {
      cb && cb(null, !!v)
    })
  }

  api.getProfile = function (id, cb) {
    awaitSync(function () { cb(null, state.profiles[id]) })
  }
  api.getAllProfiles = function (cb) {
    awaitSync(function () { cb(null, state.profiles) })
  }
  api.getNamesById = function (cb) {
    awaitSync(function () { cb(null, state.names) })
  }
  api.getNameTrustRanks = function (cb) {
    awaitSync(function () { cb(null, state.nameTrustRanks) })
  }
  api.getName = function (id, cb) {
    awaitSync(function () { cb(null, state.names[id]) })
  }
  api.getIdsByName = function (cb) {
    awaitSync(function () { cb(null, state.ids) })
  }
  api.getActionItems = function (cb) {
    awaitSync(function () { cb(null, state.actionItems) })
  }

  // helper to get an option off an opt function (avoids the `opt || {}` pattern)
  function o (opts, k, def) {
    return opts && opts[k] !== void 0 ? opts[k] : def
  }

  // helper to get messages from an index
  function indexStreamFn (index) {
    return function (opts) {
      var stream = pushable()
      awaitSync(function () {

        // emulate the `ssb.createFeedStream` interface
        var lt    = o(opts, 'lt')
        var lte   = o(opts, 'lte')
        var gt    = o(opts, 'gt')
        var gte   = o(opts, 'gte')
        var limit = o(opts, 'limit')

        // lt, lte, gt, gte should look like:
        // [msg.value.timestamp, msg.value.author]

        var added = 0
        var done = multicb({ pluck: 1 })
        for (var i=0; i < index.length; i++) {
          var row = index[i]

          if (limit && added >= limit)
            break

          // we're going to only look at timestamp, because that's all that phoenix cares about
          var invalid = !!(
            (lt  && row.ts >= lt[0]) ||
            (lte && row.ts > lte[0]) ||
            (gt  && row.ts <= gt[0]) ||
            (gte && row.ts < gte[0])
          )
          if (invalid)
            continue
          added++

          ;(function (row) {
            var msgCb = done()            
            sbot.ssb.get(row.key, function (err, value) {
              // if (err) {
                // suppress this error
                // the message isnt in the local cache (yet)
                // but it got into the index, likely due to a link
                // instead of an error, we'll put a null there to indicate the gap
              // }
              msgCb(null, { key: row.key, value: value, isread: row.isread })
            })
          })(row)
        }

        done(function (err, msgs) {
          // send all in bulk
          // :TODO: stream, in order, as they load
          // note, `err` should always be null due to suppression
          for (var i = 0; i < msgs.length; i++)
            stream.push(msgs[i])
          stream.end()
        })
      })
      return stream
    }
  }

  return api
}