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
      mlib.links(msg.value.content.contact, 'feed').forEach(function (link) {
        if (link.feed === msg.value.author) {
          updateSelfContact(msg.value.author, msg.value.content)
        } else {
          updateOtherContact(msg.value.author, link.feed, msg.value.content)
        }
        updateActionItems(link.feed)
      })
      updateActionItems(msg.value.author)      
    },

    advert: function (msg) {
      if (msg.value.content.text)
        sortedInsert(state.adverts, msg.value.timestamp, msg.key)
    },

    vote: function (msg) {
      // process votes about users
      mlib.links(msg.value.content.voteTopic, 'feed').forEach(function (link) {
        tallyVote(msg.value.author, link.feed, msg.value.content)
      })
    }
  }

  function getProfile (pid) {
    if (pid.id) // already a profile?
      return pid

    var profile = state.profiles[pid]
    if (!profile) {
      state.profiles[pid] = profile = {
        id: pid,
        createdAt: null,

        // current values...
        self: { name: null, profilePic: null }, // ...set by self about self
        assignedBy: {}, // ...set by others about self
        assignedTo: {}, // ...set by self about others

        // aliasing
        primary: null,
        secondaries: {},

        // local user's 
        trust: 0,

        // network vote tallies
        upvotes: 0,
        downvotes: 0
      }
    }
    return profile
  }

  function updateSelfContact (author, c) {
    author = getProfile(author)

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      author.self.name = noSpaces(c.name)
      rebuildNamesFor(author)
    }

    // profilePic: link to image
    if ('profilePic' in c) {
      if (mlib.isLink(c.profilePic, 'ext'))
        author.self.profilePic = c.profilePic
      else if (!c.profilePic)
        delete author.self.profilePic
    }
  }

  function updateOtherContact (source, target, c) {
    source = getProfile(source)
    target = getProfile(target)
    source.assignedTo[target.id] = source.assignedTo[target.id] || {}
    target.assignedBy[source.id] = target.assignedBy[source.id] || {}

    // trust-value: a number in the range -1, 0, 1
    // - only process the trust-edges originating from the local user (for now)
    if ('trust' in c && source.id === sbot.feed.id) {
      target.trust = c.trust || 0
      if (target.trust === 1) state.trustedProfiles[target.id] = target
      else                    delete state.trustedProfiles[target.id]
      rebuildNamesBy(target)
    }

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      source.assignedTo[target.id].name = noSpaces(c.name)
      target.assignedBy[source.id].name = noSpaces(c.name)
      rebuildNamesFor(target)
    }

    // profilePic: link to image
    if ('profilePic' in c) {
      if (mlib.isLink(c.profilePic, 'ext')) {
        source.assignedTo[target.id].profilePic = c.profilePic
        target.assignedBy[source.id].profilePic = c.profilePic
      } else if (!c.profilePic) {
        delete source.assignedTo[target.id].profilePic            
        delete target.assignedBy[source.id].profilePic
      }
    }

    // alias: string or falsey
    if ('alias' in c && (!c.alias || nonEmptyStr(c.alias))) {
      source.assignedTo[target.id].alias = c.alias
      updateAliases(source, target)
      rebuildNamesFor(target)
    }

    // following: bool
    if (typeof c.following === 'boolean') {
      source.assignedTo[target.id].following = c.following
      target.assignedBy[source.id].following = c.following
    }
  }

  function tallyVote (source, target, c) {
    var vote = c.vote
    if (!(vote === 1 || vote === 0 || vote === -1))
      return

    source = getProfile(source)
    target = getProfile(target)

    source.assignedTo[target.id] = source.assignedTo[target.id] || {}
    target.assignedBy[source.id] = target.assignedBy[source.id] || {}

    var oldvote = source.assignedTo[target.id].vote
    source.assignedTo[target.id].vote = vote
    target.assignedBy[source.id].vote = vote

    if (oldvote === 1)
      target.upvotes--
    if (oldvote === -1)
      target.downvotes--
    if (vote === 1)
      target.upvotes++
    if (vote === -1)
      target.downvotes++
  }

  function rebuildNamesFor (profile) {
    profile = getProfile(profile)

    // default to self-assigned name
    var name = (profile.self.name || shortString(profile.id))
    var trust = 0 // no trust
    if (profile.id === sbot.feed.id) {
      // is local user, trust the self-assigned name
      trust = 1 // full trust
    } else if (profile.primary && state.names[profile.primary]) {
      // create a sub-feed name
      name = state.names[profile.primary] + ' (' + name + ')'
      trust = state.nameTrustRanks[profile.primary] // assume same trust in its primary's name
    } else if (profile.assignedBy[sbot.feed.id] && profile.assignedBy[sbot.feed.id].name) {
      // use name assigned by the local user
      name = profile.assignedBy[sbot.feed.id].name
      trust = 1 // full trust
    } else {
      // try to use a name assigned by someone trusted
      for (var id in profile.assignedBy) {
        if (profile.assignedBy[id].name && state.trustedProfiles[id]) {
          name = profile.assignedBy[id].name
          trust = 0.5 // arbitrary value between 0 and 1, as 0=untrusted, 1=trusted, and anything between is semi-trusted
          // :TODO: more specific trust value? if there are discrete values, should it be an enum?
          break
        }
      }
    }

    // store
    state.names[profile.id] = name
    if (!state.ids[name]) // no conflict?
      state.ids[name] = profile.id // take it
    else {
      // conflict, which do we take? most trusted or, if there's a tie, most recent
      // :TODO: may need to allow multiple IDs for a given name...
      if (trust >= state.nameTrustRanks[state.ids[name]])
        state.ids[name] = profile.id
    }

    // store how well trusted this name is, for UI and for resolving conflicts
    state.nameTrustRanks[profile.id] = trust
  }

  function rebuildNamesBy (profile) {
    profile = getProfile(profile)
    for (var id in profile.assignedTo)
      rebuildNamesFor(id)
  }

  function updateAliases (a, b) {
    a = getProfile(a)
    b = getProfile(b)

    if (a.assignedTo[b.id] && a.assignedTo[b.id].alias === 'primary') {
      update(b, a)
    } 
    if (b.assignedTo[a.id] && b.assignedTo[a.id].alias === 'primary') {
      update(a, b)
    }

    function update(primary, secondary) {
      // both feeds have published agreeing aliases
      if (primary.assignedTo[secondary.id] && primary.assignedTo[secondary.id].alias === 'secondary') {
        secondary.primary = primary.id
        primary.secondaries[secondary.id] = true
      } else {
        // invalid alias
        secondary.primary = null
        delete primary.secondaries[secondary.id]
      }
    }
  }

  function updateActionItems (target) {
    var user = getProfile(sbot.feed.id)
    target = getProfile(target)

    // aliases
    if (target.assignedTo[user.id] && target.assignedTo[user.id].alias === 'primary') {
      // not flagged (deny) or added to secondaries (confirm)?
      if (target.trust !== -1 && !user.secondaries[target.id]) {
        state.actionItems[target.id] = { secondaryId: target.id, action: 'confirm-alias' }
        return
      }
    }
    delete state.actionItems[target.id]
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

function nonEmptyStr (str) {
    return (typeof str === 'string' && !!(''+str).trim())
  }

var spacesRgx = /\s/g
function noSpaces (str) {
  return str.replace(spacesRgx, '_')
}

function shortString (str, len) {
  len = len || 6
  if (str.length - 3 > len)
    return str.slice(0, len) + '...'
  return str
}