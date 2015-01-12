var pull = require('pull-stream')
var ssbmsgs = require('ssb-msgs')
var multicb = require('multicb')

module.exports = function (ssb) {

  var state = {
    myid: null, // this user's id
    profiles: {},
    names: {}, // ids -> names
    ids: {}, // names -> ids

    // indexes
    posts: [],
    myposts: [], // reused by `postsByAuthor` for the local user
    postsByAuthor: {},
    threads: {}, // maps: post key -> { replies: [keys], parent:, numThreadReplies: }
    inbox: [],
    adverts: []
  }

  var indexer = require('./indexer')(state)
  var api = {

    // setup

    startIndexing: function (cb) {
      ssb.whoami(function (err, user) {
        if (err)
          return cb(err)
        state.myid = user.id
        state.postsByAuthor[user.id] = state.myposts // alias myposts inside postsByAuthor

        // index all current msgs
        var ts = Date.now()
        var done = multicb()
        // :NOTE: this may cause messages to index out of order along the type division
        //        that's currently ok because the indexer doesnt have causality deps between types
        //        but be wary of that as the indexer develops!
        pull(ssb.messagesByType({ type: 'init', keys: true }), pull.drain(indexer, done()))
        pull(ssb.messagesByType({ type: 'name', keys: true }), pull.drain(indexer, done()))
        pull(ssb.messagesByType({ type: 'post', keys: true }), pull.drain(indexer, done()))
        pull(ssb.messagesByType({ type: 'advert', keys: true }), pull.drain(indexer, done()))
        // pull(ssb.createLogStream({ keys: true }), pull.drain(indexer, function (err) {
        done(function (err) {
          if (err)
            return cb(err)

          // continue indexing in the background
          pull(ssb.messagesByType({ type: 'init', keys: true, live: true, gt: ts }), pull.drain(indexer))
          pull(ssb.messagesByType({ type: 'name', keys: true, live: true, gt: ts }), pull.drain(indexer))
          pull(ssb.messagesByType({ type: 'post', keys: true, live: true, gt: ts }), pull.drain(indexer))
          pull(ssb.messagesByType({ type: 'advert', keys: true, live: true, gt: ts }), pull.drain(indexer))
          // pull(ssb.createLogStream({ keys: true, live: true, gt: ts }), pull.drain(indexer))
          cb()
        })
      })
    },

    // getters

    getMyId: function () {
      return state.myid
    },
    getMyProfile: function () {
      return this.getProfile(state.myid)
    },

    getMsg: function (key, cb) {
      ssb.get(key, function (err, msg) {
        if (err) cb(err)
        else cb(null, { key: key, value: msg })
      })
    },
    getNumReplies: function(key) {
      return (state.threads[key]) ? state.threads[key].replies.length : 0
    },
    getReplies: function (key, cb) {
      if (key in state.threads && state.threads[key].replies.length) {
        var done = multicb({ pluck: 1 })
        state.threads[key].replies.forEach(function (rkey) { api.getMsg(rkey, done()) })
        return done(cb)
      }
      cb(null, [])
    },
    getPostParent: function (key, cb) {
      if (key in state.threads && state.threads[key].parent)
        api.getMsg(state.threads[key].parent, cb)
      else
        cb(null, null)
    },
    getNumThreadReplies: function(key) {
      return (state.threads[key]) ? state.threads[key].numThreadReplies : 0
    },
    getThread: function (key, cb) {
      var done = multicb()
      var thread = { key: key, value: null, replies: null }
      get(thread, done())

      function get(t, cb) {
        api.getMsg(t.key, function (err, msg) {
          if (err) return cb(err)
          t.value = msg.value
          cb(null, t)
        })
        replies(t)
      }

      function replies(t) {
        if (!state.threads[t.key])
          return
        t.replies = state.threads[t.key].replies.map(function (rkey) {
          var rt = { key: rkey, value: null, replies: null }
          get(rt, done())
          return rt
        })
      }

      done(function (err) {
        if (err) return cb(err)
        cb(null, thread)
      })
    },

    getFeed: function (opts, cb) {
      opts = opts || {}
      opts.keys = true
      opts.limit = opts.limit || 30

      // convert gt, gte, lt, lte so that you can do `getFeed({ gt: msg1, lt: msg2 })`
      opts.gt  = msgToFeedDBKey(opts.gt)
      opts.gte = msgToFeedDBKey(opts.gte)
      opts.lt  = msgToFeedDBKey(opts.lt)
      opts.lte = msgToFeedDBKey(opts.lte)

      pull(
        ssb.createFeedStream(opts),
        pull.collect(cb)
      )
    },
    getPosts: listGetter(state.posts),
    getPostsBy: function (author, opts, cb) {
      listGetter(state.postsByAuthor[author] || [])(opts, cb)
    },
    getInbox: listGetter(state.inbox),
    getAdverts: listGetter(state.adverts),
    getRandomAdverts: function (num, oldest, cb) {
      var done = multicb({ pluck: 1 })
      for (var i = 0; i < num && i < state.adverts.length; i++) {
        var index = (Math.random()*Math.min(state.adverts.length, oldest))|0
        api.getMsg(state.adverts[index], done())
      }
      return done(cb)
    },

    getProfile: function (id) {
      return state.profiles[id] || null
    },
    getAllProfiles: function () {
      return state.profiles
    },
    getGraph: function (type, cb) {
      ssb.friends.all(type, cb)
    },
    getNames: function () {
      return state.names
    },
    getName: function (id) {
      return state.names[id]
    },
    getNameById: function (id) {
      return state.names[id]
    },
    getIdByName: function (name) {
      return state.ids[name]
    },

    // publishers

    postText: function (text, cb) {
      if (!text.trim()) return cb(new Error('Can not post an empty string to the feed'))
      ssb.add(extractMentions({type: 'post', text: text}), indexer.whenIndexed(cb))
    },
    postReply: function (text, parent, cb) {
      if (!text.trim()) return cb(new Error('Can not post an empty string to the feed'))
      if (!parent) return cb(new Error('Must provide a parent message to the reply'))
      ssb.add(extractMentions({type: 'post', text: text, repliesTo: {msg: parent, rel: 'replies-to'}}), indexer.whenIndexed(cb))
    },
    postAdvert: function (text, cb) {
      if (!text.trim()) return cb(new Error('Can not post an empty string to the adverts'))
      ssb.add({type: 'advert', text: text}, indexer.whenIndexed(cb))
    },

    nameSelf: function (name, cb) {
      if (typeof name != 'string' || name.trim() == '') return cb(new Error('param 1 `name` string is required and must be non-empty'))
      ssb.add({type: 'name', name: name}, indexer.whenIndexed(cb))
    },
    nameOther: function (target, name, cb) {
      if (!target || typeof target != 'string') return cb(new Error('param 1 `target` feed string is required'))
      if (typeof name != 'string' || name.trim() == '') return cb(new Error('param 2 `name` string is required and must be non-empty'))
      ssb.add({type: 'name', rel: 'names', feed: target, name: name}, indexer.whenIndexed(cb))
    },
    
    addEdge: function (type, target, cb) {
      if (!type   || typeof type != 'string')   return cb(new Error('param 1 `type` string is required'))
      if (!target || typeof target != 'string') return cb(new Error('param 2 `target` string is required'))
      ssb.add({ type: type, rel: type+'s', feed: target }, cb)
    },
    delEdge: function (type, target, cb) {
      if (!type   || typeof type != 'string')   return cb(new Error('param 1 `type` string is required'))
      if (!target || typeof target != 'string') return cb(new Error('param 2 `target` string is required'))
      ssb.add({ type: type, rel: 'un'+type+'s', feed: target }, cb)
    },

    // other

    useInvite: function (invite, cb) {
      ssb.invite.addMe(invite, cb)
    }
  }

  // helper to get an option off an opt function (avoids the `opt || {}` pattern)
  function o (opts, k, def) {
    return opts && opts[k] !== void 0 ? opts[k] : def
  }

  // helper to get messages from an index
  function listGetter (index) {
    return function (opts, cb) {
      if (typeof opts == 'function') {
        cb = opts
        opts = null
      }
      var start = o(opts, 'start', 0)
      var end   = o(opts, 'end', start + 30)

      var done = multicb({ pluck: 1 })
      index
        .slice(start, end)
        .forEach(function (key) { api.getMsg(key, done()) })
      done(cb)
    }
  }

  // helper to find mentions in .text in put them in link objects
  function extractMentions (content) {
    var match
    var mentionRegex = /(\s|^)@([A-z0-9\/=\.\+]+)/g;
    while ((match = mentionRegex.exec(content.text))) {
      content.mentions = content.mentions || []
      content.mentions.push({ feed: match[2], rel: 'mentions' })
    }
    return content
  }

  // helper to convert gt,gte,lt,lte params from messages into proper keys for the feeddb index
  function msgToFeedDBKey(v) {
    if (v && v.key && v.value)
      return [v.value.timestamp, v.value.author]
  }

  return api
}