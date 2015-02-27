var pull     = require('pull-stream')
var ssbmsgs  = require('ssb-msgs')
var multicb  = require('multicb')
var memview  = require('level-memview')
var pl       = require('pull-level')
var pushable = require('pull-pushable')

exports.manifest    = require('./manifest')
exports.permissions = require('./permissions')

exports.init = function (sbot) {

  var api = {}
  var phoenixdb = sbot.ssb.sublevel('phoenix')
  var db = {
    sys: phoenixdb.sublevel('sys'),
    isread: phoenixdb.sublevel('isread'),
    subscribed: phoenixdb.sublevel('subscribed')
  }
  var state = {
    // indexes (lists of {key:, ts:})
    mymsgs: [],
    inbox: [], // also has `.isread`
    adverts: [],

    // views
    profiles: {},
    trustedProfiles: {},
    names: {}, // ids -> names
    nameTrustRanks: {}, // ids -> trust-ranks
    ids: {} // names -> ids
  }

  var processor = require('./processor')(sbot, db, state)
  pull(pl.read(sbot.ssb.sublevel('log'), { live: true, onSync: onSync }), pull.drain(processor))

  // track sync state
  var isPreHistorySynced = false, nP = 0, syncCbs = []
  function onSync () {
    syncCbs.forEach(function (cb) { cb() })
    syncCbs.length = 0
  }
  function awaitSync (cb) {
    if (!isPreHistorySynced || nP > 0)
      syncCbs.push(cb)
    else cb()
  }
  state.pinc = function () { nP++ }
  state.pdec = function () {
    nP--
    if (nP === 0)
      onSync()
  }
  awaitSync(function () {
    isPreHistorySynced = true
  })

  // events stream
  var eventsStreams = []
  function emit(e) {
    eventsStreams.forEach(function (es) {
      es.push(e)
    })
  }
  processor.events.on('message', function (msg) {
    if (isPreHistorySynced)
      emit({ type: 'message', msg: msg })
  })
  processor.events.on('notification', function (msg) {
    if (isPreHistorySynced)
      emit({ type: 'notification', msg: msg })
  })

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
        adverts: state.adverts.length
      })
    })
  }

  api.createInboxStream = indexStreamFn(state.inbox)
  api.createAdvertStream = indexStreamFn(state.adverts)
  api.getRandomAdverts = function (num, oldest, cb) {
    awaitSync(function () {
      var done = multicb({ pluck: 1 })
      var used = [], index

      for (var i = 0; i < num && i < state.adverts.length; i++) {
        do {
          index = (Math.random()*Math.min(state.adverts.length, oldest))|0
        } while (used.indexOf(index) >= 0)

        used.push(index)

        ;(function (key, cb) {
          sbot.ssb.get(key, function (err, msg) {
            cb(err, (msg) ? { key: key, value: msg } : null)
          })
        })(state.adverts[index].key, done())
      }
      done(cb)
    })
  }

  api.markRead = function (key, cb) {
    var row = find(state.inbox, key)
    if (row)
      row.isread = true
    db.isread.put(key, 1, cb)
  }
  api.markUnread = function (key, cb) {
    var row = find(state.inbox, key)
    if (row)
      row.isread = false
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
    db.isread.get(key, function (err, v) {
      cb && cb(null, !!v)
    })
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

  // helper to get an option off an opt function (avoids the `opt || {}` pattern)
  function o (opts, k, def) {
    return opts && opts[k] !== void 0 ? opts[k] : def
  }

  // helper to get an item out of the given index
  function find (index, key) {
    for (var i=0; i < index.length; i++) {
      if (index[i].key === key)
        return index[i]
    }
    return null
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

          ;(function (key) {
              var msgCb = done()            
            sbot.ssb.get(key, function (err, value) {
              // if (err) {
                // suppress this error
                // the message isnt in the local cache (yet)
                // but it got into the index, likely due to a link
                // instead of an error, we'll put a null there to indicate the gap
              // }
              msgCb(null, { key: key, value: value })
            })
          })(row.key)
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