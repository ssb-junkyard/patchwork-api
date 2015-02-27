var ssbmsgs = require('ssb-msgs')
var EventEmitter = require('events').EventEmitter

var trustLinkOpts = { tofeed: true, rel: 'trusts' }
module.exports = function(sbot, db, state) {

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
          var target = getProfile(link.feed)
          target.assignedBy[author] = target.assignedBy[author] || {}
          target.assignedBy[author].name = name
          var source = getProfile(author)
          source.assignedTo[link.feed] = source.assignedTo[link.feed] || {}
          source.assignedTo[link.feed].name = name
          rebuildNamesFor(link.feed)
        })
      } else {
        // name assigned to self
        var profile = getProfile(author)
        profile.self.name = name
        rebuildNamesFor(author)          
      }
    },

    trust: function (msg) {
      var content = msg.value.content
      var author = msg.value.author

      // only process self-published trust edges for now
      if (author !== sbot.feed.id)
        return

      ssbmsgs.indexLinks(content, trustLinkOpts, function (link) {
        var profile = getProfile(link.feed)
        profile.trust = +link.value || 0
        if (profile.trust === 1) state.trustedProfiles[link.feed] = profile
        else                     delete state.trustedProfiles[link.feed]
        rebuildNamesBy(link.feed)
      })
    },

    advert: function (msg) {
      if (msg.value.content.text)
        sortedInsert(state.adverts, msg.value.timestamp, msg.key)
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
        assignedBy: {},
        assignedTo: {},
        trust: 0,
        createdAt: null
      }
    }
    return profile
  }

  function rebuildNamesFor(pid) {
    var profile = getProfile(pid)

    // default to self-assigned name
    var name = profile.self.name
    var trust = 0
    if (pid === sbot.feed.id) {
      // is me, trust the self-assigned name
      trust = 1
    } else if (profile.assignedBy[sbot.feed.id] && profile.assignedBy[sbot.feed.id].name) {
      // use name assigned by me
      name = profile.assignedBy[sbot.feed.id].name
      trust = 1
    } else {
      // try to use a name assigned by someone trusted
      for (var id in profile.assignedBy) {
        if (profile.assignedBy[id].name && state.trustedProfiles[id]) {
          name = profile.assignedBy[id].name
          trust = 0.5
          break
        }
      }
    }

    // store
    state.names[pid] = name
    if (!state.ids[name])
      state.ids[name] = pid
    else {
      if (trust >= state.nameTrustRanks[state.ids[name]])
        state.ids[name] = pid
    }
    state.nameTrustRanks[pid] = trust
  }

  function rebuildNamesBy(pid) {
    var profile = getProfile(pid)
    for (var id in profile.assignedTo)
      rebuildNamesFor(id)
  }

  var spacesRgx = /\s/g
  function noSpaces (str) {
    return str.replace(spacesRgx, '_')
  }

  function sortedInsert(index, ts, key) {
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

  function contains(index, key) {
    for (var i=0; i < index.length; i++) {
      if (index[i].key === key)
        return true
    }    
  }

  function attachIsRead (indexRow) {
    db.isread.get(indexRow.key, function (err, v) {
      indexRow.isread = !!v
    })
  }

  // exported api

  function fn (logkey) {
    state.pinc()
    var key = logkey.value
    sbot.ssb.get(logkey.value, function (err, value) {
      var msg = { key: key, value: value }
      try {
        var by_me = (msg.value.author === sbot.feed.id)
        if (by_me)
          state.mymsgs.push(msg.key)

        // type processing
        var process = processors[msg.value.content.type]
        if (process)
          process(msg)

        // common processing
        var c = msg.value.content
        if (!by_me) {
          var links = ssbmsgs.getLinks(c)
          for (var i =0; i < links.length; i++) {
            var link = links[i]
            if ((link.rel == 'replies-to' || link.rel == 'branch') && link.msg) {
              if (state.mymsgs.indexOf(link.msg) >= 0) {
                var row = sortedInsert(state.inbox, msg.value.timestamp, msg.key)
                attachIsRead(row)
                events.emit('notification', msg)
                break
              }
            }
            else if (link.rel == 'mentions' && link.feed === sbot.feed.id) {
              var row = sortedInsert(state.inbox, msg.value.timestamp, msg.key)
              attachIsRead(row)
              events.emit('notification', msg)
              break
            }
          }
        }
      }
      catch (e) {
        // :TODO: use sbot logging plugin
        console.error('Failed to process message', e, key, value)
      }
      state.pdec()
    })
  }
  fn.events = events

  return fn
}