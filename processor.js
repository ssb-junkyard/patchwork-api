var mlib = require('ssb-msgs')
var u = require('./util')

module.exports = function (sbot, db, state, emit) {

  var processors = {
    init: function (msg) {
      var profile = getProfile(msg.value.author)
      profile.createdAt = msg.value.timestamp      
    },

    post: function (msg) {
      // emit event if by a followed user and in the last hour
      var me = getProfile(sbot.feed.id)
      var author = msg.value.author
      if (author != sbot.feed.id && me.assignedTo[author] && me.assignedTo[author].following && ((Date.now() - msg.value.timestamp) < 1000*60*60))
        emit('home-add')
    },

    contact: function (msg) {
      mlib.links(msg.value.content.contact, 'feed').forEach(function (link) {
        if (link.feed === msg.value.author) {
          updateSelfContact(msg.value.author, msg)
        } else {
          updateOtherContact(msg.value.author, link.feed, msg)
        }
        updateActionItems(link.feed)
      })
      updateActionItems(msg.value.author)      
    },

    vote: function (msg) {
      var link = mlib.link(msg.value.content.voteTopic, 'msg')
      if (link && state.mymsgs.indexOf(link.msg) >= 0 && msg.value.author != sbot.feed.id) // vote on a msg by me?
        updateVoteOnMymsg(msg, link.msg)
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
        trust: 0
      }
    }
    return profile
  }

  function updateSelfContact (author, msg) {
    var c = msg.value.content
    author = getProfile(author)

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      author.self.name = makeNameSafe(c.name)
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

  function updateOtherContact (source, target, msg) {
    var c = msg.value.content
    source = getProfile(source)
    target = getProfile(target)
    source.assignedTo[target.id] = source.assignedTo[target.id] || {}
    target.assignedBy[source.id] = target.assignedBy[source.id] || {}
    var userProf = getProfile(sbot.feed.id)

    // trust-value: a number in the range -1, 0, 1
    // - only process the trust-edges originating from the local user (for now)
    if ('trust' in c && source.id === sbot.feed.id) {
      target.trust = c.trust || 0
      if (target.trust == 1) state.trustedProfiles[target.id] = target
      else                   delete state.trustedProfiles[target.id]

      if (target.trust == -1 && userProf.assignedTo[source.id] && userProf.assignedTo[source.id].following) {
        // new flag by a friend
        u.sortedUpsert(state.home, msg.value.timestamp, msg.key)
        emit('home-add')
      }

      rebuildNamesBy(target)
    }

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      source.assignedTo[target.id].name = makeNameSafe(c.name)
      target.assignedBy[source.id].name = makeNameSafe(c.name)
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

      if (target.id == sbot.feed.id) {
        // use the follower's id as the key to this index, so we only have 1 entry per other user max
        var row = u.sortedUpsert(state.follows, msg.value.timestamp, source.id)
        row.following = c.following
        row.followmsg = msg.key
        attachIsRead(row, msg.key)
      }
    }
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

  function updateVoteOnMymsg (msg, targetkey) {
    // construct a composite key which will be the same for all votes by this user on the given target
    var votekey = targetkey + '::' + msg.value.author // lonnng fucking key
    var row = u.sortedUpsert(state.votes, msg.value.timestamp, votekey)
    row.vote = msg.value.content.vote
    row.votemsg = msg.key
    if (row.vote > 0) attachIsRead(row, msg.key)
    else              row.isread = true // we dont care about non-upvotes
  }

  function attachIsRead (indexRow, key) {
    key = key || indexRow.key
    db.isread.get(key, function (err, v) {
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
        var me = getProfile(sbot.feed.id)
        var by_me = (msg.value.author === sbot.feed.id)
        if (by_me)
          state.mymsgs.push(msg.key)

        // type processing
        var process = processors[msg.value.content.type]
        if (process)
          process(msg)

        // common processing
        var c = msg.value.content
        if (!by_me && c.type == 'post') {
          // check if msg should go to the inbox
          var inboxed = false
          mlib.links(c.repliesTo, 'msg').forEach(function (link) {
            if (inboxed) return
            if (state.mymsgs.indexOf(link.msg) >= 0) {
              var row = u.sortedInsert(state.inbox, msg.value.timestamp, msg.key)
              attachIsRead(row)
              emit('inbox-add')
              inboxed = true
            }
          })
          mlib.links(c.mentions, 'feed').forEach(function (link) {
            if (inboxed) return
            if (link.feed == sbot.feed.id) {
              var row = u.sortedInsert(state.inbox, msg.value.timestamp, msg.key)
              attachIsRead(row)
              emit('inbox-add')
              inboxed = true
            }
          })
        }

        // check if it should go in the home view
        if ((c.type == 'post' || c.type == 'fact') && !c.repliesTo) {
          u.sortedUpsert(state.home, msg.value.timestamp, msg.key)
          emit('home-add')
        } else if (c.type == 'post' && mlib.link(c.repliesTo, 'msg')) {
          state.pinc() // doing some async work
          u.getRootMsg(sbot, msg, function (err, rootmsg) {
            state.pdec()
            if (!rootmsg)
              return
            u.sortedUpsert(state.home, msg.value.timestamp, rootmsg.key)
            emit('home-add')
          })
        }
      }
      catch (e) {
        // :TODO: use sbot logging plugin
        console.error('Failed to process message', e, e.stack, key, value)
      }
      state.pdec()
    })
  }

  return fn
}

function nonEmptyStr (str) {
    return (typeof str === 'string' && !!(''+str).trim())
  }

var badNameCharsRegex = /[^A-z0-9\._-]/g
function makeNameSafe (str) {
  return str.replace(badNameCharsRegex, '_')
}

function shortString (str, len) {
  len = len || 6
  if (str.length - 3 > len)
    return str.slice(0, len) + '...'
  return str
}