var mlib = require('ssb-msgs')
var EventEmitter = require('events').EventEmitter

module.exports = function (sbot, db, state) {

  var events = new EventEmitter()
  var processors = {
    init: function (msg) {
      var profile = getProfile(msg.value.author)
      profile.createdAt = msg.value.timestamp      
    },

    contact: function (msg) {
      var content = msg.value.content
      var author = msg.value.author
      mlib.asLinks(content.contact, 'feed').forEach(function (link) {
        if (author === link.feed) {
          // about self
          var profile = getProfile(author)

          if (typeof content.name == 'string' && content.name.trim()) {
            profile.self.name = noSpaces(content.name)
            rebuildNamesFor(link.feed)
          }

          if (typeof content.profilePic == 'object' && mlib.isHash(content.profilePic.ext)) {
            profile.self.profilePic = content.profilePic
          }
        } else {
          // about other
          var target = getProfile(link.feed)
          var source = getProfile(author)
          target.assignedBy[author] = target.assignedBy[author] || {}
          source.assignedTo[link.feed] = source.assignedTo[link.feed] || {}

          // only process self-published trust edges for now
          if ('trust' in content && source.id === sbot.feed.id) {
            target.trust = content.trust || 0
            if (target.trust === 1) state.trustedProfiles[target.id] = target
            else                    delete state.trustedProfiles[target.id]
            rebuildNamesBy(target.id)
          }

          if (typeof content.name == 'string' && content.name.trim()) {
            target.assignedBy[source.id].name = noSpaces(content.name)
            source.assignedTo[target.id].name = noSpaces(content.name)
            rebuildNamesFor(target.id)
          }

          if (typeof content.profilePic == 'object' && mlib.isHash(content.profilePic.ext)) {
            target.assignedBy[source.id].profilePic = content.profilePic
            source.assignedTo[target.id] = source.assignedTo[link.feed] || {}
          }

          if (content.myuser === true)
            source.users[target.id] = true
          else if (content.myuser === false)
            delete source.users[target.id]

          if (content.myapp === true)
            source.apps[target.id] = true
          else if (content.myapp === false)
            delete source.apps[target.id]
          

          if (source.id === sbot.feed.id)
            updateActionItems(target)
          if (target.id === sbot.feed.id)
            updateActionItems(source)
        }
      })
    },

    advert: function (msg) {
      if (msg.value.content.text)
        sortedInsert(state.adverts, msg.value.timestamp, msg.key)
    }
  }

  function empty (str) {
    return !str || !(''+str).trim()
  }

  function getProfile (pid) {
    var profile = state.profiles[pid]
    if (!profile) {
      state.profiles[pid] = profile = {
        id: pid,
        self: { name: null, profilePic: null },
        assignedBy: {},
        assignedTo: {},
        users: {},
        apps: {},
        trust: 0,
        createdAt: null
      }
    }
    return profile
  }

  function rebuildNamesFor (pid) {
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

  function rebuildNamesBy (pid) {
    var profile = getProfile(pid)
    for (var id in profile.assignedTo)
      rebuildNamesFor(id)
  }

  function updateActionItems (target) {
    var user = getProfile(sbot.feed.id)
    if (target.users[user.id]) {
      // unrequited alias?
      if (target.trust !== -1 && !user.apps[target.id]) {
        state.actionItems[target.id] = { feedid: target.id, action: 'confirm-app' }
        return
      }
    }
    delete state.actionItems[target.id]
  }

  var spacesRgx = /\s/g
  function noSpaces (str) {
    return str.replace(spacesRgx, '_')
  }

  function sortedInsert (index, ts, key) {
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

  function contains (index, key) {
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
          // check if msg should go to the inbox
          var inboxed = false
          mlib.asLinks(c.repliesTo, 'msg').forEach(function (link) {
            if (inboxed) return
            if (state.mymsgs.indexOf(link.msg) >= 0) {
              var row = sortedInsert(state.inbox, msg.value.timestamp, msg.key)
              attachIsRead(row)
              events.emit('notification', msg)
              inboxed = true
            }
          })
          mlib.asLinks(c.mentions, 'feed').forEach(function (link) {
            if (inboxed) return
            if (link.feed === sbot.feed.id) {
              var row = sortedInsert(state.inbox, msg.value.timestamp, msg.key)
              attachIsRead(row)
              events.emit('notification', msg)
              inboxed = true
            }
          })
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