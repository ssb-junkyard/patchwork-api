var pull = require('pull-stream')
var ssbmsgs = require('ssb-msgs')
var multicb = require('multicb')

module.exports = function (ssb, cb) {

  // computed state

  var state = {
    myid: null, // this user's id
    profiles: {},
    names: {}, // ids -> names
    ids: {}, // names -> ids

    // indexes
    posts: [],
    myposts: [], // this user's posts
    replies: {}, // maps: post key -> [reply keys]
    inbox: [],
    adverts: []
  }
  var indexer = require('./indexer')(state)

  // setup api

  ssb.whoami(function (err, user) {
    if (err)
      return cb(err)
    state.myid = user.id

    // index all current msgs
    var ts = Date.now()
    pull(ssb.createLogStream(), pull.drain(indexer, function (err) {
      if (err)
        return cb(err)

      // continue indexing in the background
      pull(ssb.createLogStream({ live: true, gt: ts }), pull.drain(indexer))
      cb(null, {

        // getters

        getMyId: function () {
          return state.myid
        },
        getMyProfile: function () {
          return this.getProfile(state.myid)
        },

        getMsg: function (key, cb) {
          ssb.get(key, cb)
        },
        getNumReplies: function(key) {
          return (state.replies[key]) ? state.replies[key].length : 0
        },
        getReplies: function (key, cb) {
          if (key in state.replies && state.replies[key].length) {
            var done = multicb({ pluck: 1 })
            state.replies[key].forEach(function (rkey) { ssb.get(rkey, done()) })
            return done(cb)
          }
          cb(null, [])
        },

        getPosts: listGetter(state.posts),
        getInbox: listGetter(state.inbox),
        getAdverts: listGetter(state.adverts),
        getRandomAdverts: function (num, oldest, cb) {
          var done = multicb({ pluck: 1 })
          for (var i = 0; i < num && i < state.adverts.length; i++) {
            var index = (Math.random()*Math.min(state.adverts.length, oldest))|0
            console.log(index)
            ssb.get(state.adverts[index], done())
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
        }
      })
    }))
  })

  function o (opts, k, def) {
    return opts && opts[k] !== void 0 ? opts[k] : def
  }

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
        .forEach(function (key) { ssb.get(key, done()) })
      done(cb)
    }
  }

  function extractMentions (content) {
    var match
    var mentionRegex = /(\s|^)@([A-z0-9\/=\.\+]+)/g;
    while ((match = mentionRegex.exec(content.text))) {
      content.mentions = content.mentions || []
      content.mentions.push({ feed: match[2], rel: 'mentions' })
    }
    return content
  }
}