var ssbmsgs = require('ssb-msgs')

module.exports = function(state) {

  var cbsAwaitingIndex = {} // map of key -> cb
  var indexers = {
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

          if (author === state.myid) {
            // author is me, use name
            state.names[link.feed]  = name
            state.ids[name] = link.feed
          }
        })
      } else {
        // name assigned to self
        var profile = getProfile(author)
        profile.self.name = name

        if (author === state.myid) {
          // author is me, use name
          state.names[author] = name
          state.ids[name] = author
        }
        else if (!state.names[author] || !profile.given[state.myid] || !profile.given[state.myid].name) {
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

          // index reply
          if (!state.replies[link.msg])
            state.replies[link.msg] = []
          state.replies[link.msg].unshift(msg.key)

          // add to inbox if it's a reply to this user's message
          if (state.myposts.indexOf(link.msg) !== -1 && !isinboxed) {
            state.inbox.unshift(msg.key)
            isinboxed = true
          }
        }
        else if (link.rel == 'mentions' && link.feed === state.myid && !isinboxed) {
          state.inbox.unshift(msg.key)
          isinboxed = true
        }
      })

      if (!isreply)
        state.posts.unshift(msg.key)
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

  function fn (msg) {
    var indexer = indexers[msg.value.content.type]
    if (indexer) {
      try { indexer(msg) }
      catch (e) {
        console.warn('Failed to index message', e, msg)
      }
    }

    var cb = cbsAwaitingIndex[msg.key]
    if (cb) {
      delete cbsAwaitingIndex[msg.key]
      cb()
    }
  }

  fn.whenIndexed = function (cb) {
    return function (err, msg, key) {
      cbsAwaitingIndex[key] = cb.bind(null, err, msg, key)
    }
  }

  return fn
}