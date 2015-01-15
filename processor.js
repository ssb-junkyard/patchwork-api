var ssbmsgs = require('ssb-msgs')
var EventEmitter = require('events').EventEmitter

module.exports = function(sbot, state) {

  var events = new EventEmitter()
  var processors = {
    init: function (msg) {
      var profile = getProfile(msg.value.author)
      profile.createdAt = msg.value.timestamp      
    },

    name: function (msg) {
      var content = msg.value.content
      var author = msg.value.author
      if (empty(content.name))
        return
      var name = noSpaces(content.name)

      var links = ssbmsgs.getLinks(content, 'names')
      if (links.length) {
        links.forEach(function(link) {
          if (!link.feed)
            return

          // name assigned to other
          var profile = getProfile(link.feed)
          profile.given[author] = profile.given[author] || {}
          profile.given[author].name = name

          if (author === sbot.feed.id) {
            // author is me, use name
            state.names[link.feed]  = name
            state.ids[name] = link.feed
          }
        })
      } else {
        // name assigned to self
        var profile = getProfile(author)
        profile.self.name = name

        if (author === sbot.feed.id) {
          // author is me, use name
          state.names[author] = name
          state.ids[name] = author
        }
        else if (!state.names[author] || !profile.given[sbot.feed.id] || !profile.given[sbot.feed.id].name) {
          // no name assigned by me, use their claimed name
          state.names[author] = '"' + name + '"'
          state.ids['"' + name + '"'] = author
        }
      }
    },

    post: function (msg) {
      var content = msg.value.content
      if (empty(content.text))
        return

      var isreply = false, isinboxed = false
      ssbmsgs.indexLinks(content, function(link) {
        if (link.rel == 'replies-to' && link.msg) {
          isreply = true

          // index thread
          if (!state.threads[link.msg])
            state.threads[link.msg] = { parent: null, replies: [], numThreadReplies: 0 }
          state.threads[link.msg].replies.unshift(msg.key)
          state.threads[msg.key] = { parent: link.msg, replies: [], numThreadReplies: 0 }

          var t = state.threads[link.msg]
          do {
            t.numThreadReplies++
            t = state.threads[t.parent]
          } while (t)

          // add to inbox if it's a reply to this user's message
          if (state.myposts.indexOf(link.msg) !== -1 && !isinboxed) {
            state.inbox.unshift(msg.key)
            isinboxed = true
          }
        }
        else if (link.rel == 'mentions' && link.feed === sbot.feed.id && !isinboxed) {
          state.inbox.unshift(msg.key)
          isinboxed = true
        }
      })

      if (!isreply) {
        state.posts.unshift(msg.key)
        events.emit('post', msg)
      }

      if (!state.postsByAuthor[msg.value.author])
        state.postsByAuthor[msg.value.author] = []
      state.postsByAuthor[msg.value.author].unshift(msg.key)
    },

    advert: function(msg) {
      var content = msg.value.content
      if (empty(content.text))
        return

      state.adverts.unshift(msg.key)
    }
  }

  function empty(str) {
    return !str || !(''+str).trim()
  }

  function getProfile(pid) {
    var profile = state.profiles[pid]
    if (!profile) {
      state.profiles[pid] = profile = {
        id: pid,
        self: { name: null },
        given: {},
        createdAt: null
      }
    }
    return profile
  }

  var spacesRgx = /\s/g
  function noSpaces (str) {
    return str.replace(spacesRgx, '_')
  }

  // exported api

  function fn (msg) {
    var process = processors[msg.value.content.type]
    if (process) {
      try { process(msg) }
      catch (e) {
        // :TODO: use sbot logging plugin
        console.warn('Failed to process message', e, msg)
      }
    }
  }
  fn.events = events

  return fn
}