var mlib = require('ssb-msgs')
var u = require('./util')

module.exports = function (sbot, db, state, emit) {

  var processors = {
    post: function (msg) {
      var me = getProfile(sbot.id)
      var author = msg.value.author
      var by_me = (author === sbot.id)
      var c = msg.value.content
      
      // home index
      if (!c.repliesTo) {
        // not a reply, put in home index
        state.home.sortedUpsert(msg.value.timestamp, msg.key)
      } else if (mlib.link(c.repliesTo, 'msg')) {
        // a reply, put its *parent* in the home index
        state.pinc()
        u.getRootMsg(sbot, msg, function (err, rootmsg) {
          if (rootmsg && typeof rootmsg.value.content != 'string') // dont put encrypted msgs in homestream
            state.home.sortedUpsert(rootmsg.value.timestamp, rootmsg.key)
          state.pdec()            
        })
      }

      if (!by_me) {
        // emit home-add if by a followed user and in the last hour
        if (follows(sbot.id, author) && ((Date.now() - msg.value.timestamp) < 1000*60*60))
          emit('home-add')
      }

      // inbox index
      if (!by_me) {
        var inboxed = false
        mlib.links(c.repliesTo, 'msg').forEach(function (link) {
          if (inboxed) return
          // a reply to my messages?
          if (state.mymsgs.indexOf(link.link) >= 0) {
            var row = state.inbox.sortedInsert(msg.value.timestamp, msg.key)
            attachIsRead(row)
            row.author = msg.value.author // inbox index is filtered on read by the friends graph
            if (follows(sbot.id, row.author))
              emit('index-change', { index: 'inbox' })
            inboxed = true
          }
        })
        mlib.links(c.mentions, 'feed').forEach(function (link) {
          if (inboxed) return
          // mentions me?
          if (link.link == sbot.id) {
            var row = state.inbox.sortedInsert(msg.value.timestamp, msg.key)
            attachIsRead(row)
            row.author = msg.value.author // inbox index is filtered on read by the friends graph
            if (follows(sbot.id, row.author))
              emit('index-change', { index: 'inbox' })
            inboxed = true
          }
        })
      }
    },

    contact: function (msg) {
      // update profiles
      mlib.links(msg.value.content.contact, 'feed').forEach(function (link) {
        var toself = link.link === msg.value.author
        if (toself) updateSelfContact(msg.value.author, msg)
        else        updateOtherContact(msg.value.author, link.link, msg)
      })
    },

    vote: function (msg) {
      // update tallies
      var link = mlib.link(msg.value.content.voteTopic, 'msg')
      if (link && state.mymsgs.indexOf(link.link) >= 0 && msg.value.author != sbot.id) // vote on my msg?
        updateVoteOnMymsg(msg, link.link)
    },

    flag: function (msg) {
      // inbox index
      var link = mlib.link(msg.value.content.flagTopic, 'msg')
      if (sbot.id != msg.value.author && link && state.mymsgs.indexOf(link.link) >= 0) {
        var row = state.inbox.sortedInsert(msg.value.timestamp, msg.key)
        attachIsRead(row)
        row.author = msg.value.author // inbox index is filtered on read by the friends graph
        if (follows(sbot.id, msg.value.author))
          emit('index-change', { index: 'inbox' })
      }
    }
  }

  function getProfile (pid) {
    if (pid.id) // already a profile?
      return pid

    var profile = state.profiles[pid]
    if (!profile) {
      state.profiles[pid] = profile = {
        id: pid,

        // current values...
        self: { name: null, profilePic: null }, // ...set by self about self
        assignedBy: {}, // ...set by others about self
        assignedTo: {}, // ...set by self about others

        // has local user flagged?
        flagged: false
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
      if (mlib.link(c.profilePic, 'blob'))
        author.self.profilePic = mlib.link(c.profilePic)
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
    var userProf = getProfile(sbot.id)

    // flagged: false, true, or an object with {reason: string}
    if ('flagged' in c) { 
      source.assignedTo[target.id].flagged = c.flagged
      target.assignedBy[source.id].flagged = c.flagged

      // track if by local user
      if (source.id === sbot.id)
        target.flagged = c.flagged
    }

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      source.assignedTo[target.id].name = makeNameSafe(c.name)
      target.assignedBy[source.id].name = makeNameSafe(c.name)
      rebuildNamesFor(target)
    }

    // following: bool
    if (typeof c.following === 'boolean') {
      source.assignedTo[target.id].following = c.following
      target.assignedBy[source.id].following = c.following

      // if from the user, update names (in case un/following changes conflict status)
      if (source.id == sbot.id)
        rebuildNamesFor(target)

      // follows index
      if (target.id == sbot.id) {
        // use the follower's id as the key to this index, so we only have 1 entry per other user max
        var row = state.follows.sortedUpsert(msg.value.timestamp, msg.key)
        row.following = c.following
        attachIsRead(row, msg.key)
      }
    }
  }

  function rebuildNamesFor (profile) {
    profile = getProfile(profile)

    // remove oldname from id->name map
    var oldname = state.names[profile.id]
    if (oldname) {
      if (state.ids[oldname] == profile.id) {
        // remove
        delete state.ids[oldname]
      } else if (Array.isArray(state.ids[oldname])) {
        // is in a conflict, remove from conflict array
        var i = state.ids[oldname].indexOf(profile.id)
        if (i !== -1) {
          state.ids[oldname].splice(i, 1)
          if (state.ids[oldname].length === 1) {
            // conflict resolved
            delete state.actionItems[oldname]
            state.ids[oldname] = state.ids[oldname][0]
          }
        }
      }
    }

    // default to self-assigned name
    var name = profile.self.name
    if (profile.id !== sbot.id && profile.assignedBy[sbot.id] && profile.assignedBy[sbot.id].name) {
      // use name assigned by the local user, if one is given
      name = profile.assignedBy[sbot.id].name
    }
    if (!name)
      return

    // store
    state.names[profile.id] = name

    // if following, update id->name map
    if (profile.id === sbot.id || profile.assignedBy[sbot.id] && profile.assignedBy[sbot.id].following) {
      if (!state.ids[name]) { // no conflict?
        // take it
        state.ids[name] = profile.id
      } else {
        // keep track of all assigned ids
        if (Array.isArray(state.ids[name]))
          state.ids[name].push(profile.id)
        else
          state.ids[name] = [state.ids[name], profile.id]
        // conflict, this needs to be handled by the user
        state.actionItems[name] = {
          type: 'name-conflict',
          name: name,
          ids: state.ids[name]
        }
      }
    }
  }

  function updateVoteOnMymsg (msg, targetkey) {
    // votes index
    // construct a composite key which will be the same for all votes by this user on the given target
    var votekey = targetkey + '::' + msg.value.author // lonnng fucking key
    var row = state.votes.sortedUpsert(msg.value.timestamp, votekey)
    row.vote = msg.value.content.vote
    row.votemsg = msg.key
    if (row.vote > 0) attachIsRead(row, msg.key)
    else              row.isread = true // we dont care about non-upvotes
  }

  function attachIsRead (indexRow, key) {
    key = key || indexRow.key
    state.pinc()
    db.isread.get(key, function (err, v) {
      state.pdec()
      indexRow.isread = !!v
    })
  }

  function follows (a, b) {
    var aT = getProfile(a).assignedTo[b]
    return (a != b && aT && aT.following)
  }

  // exported api

  function fn (logkey) {
    state.pinc()
    var key = logkey.value
    sbot.get(logkey.value, function (err, value) {
      var msg = { key: key, value: value }
      try {
        // encrypted? try to decrypt
        if (typeof value.content == 'string' && value.content.slice(-4) == '.box') {
          value.content = sbot.crypto.unbox(value.content)
          if (!value.content)
            return state.pdec()

          // put all decrypted messages in the inbox index
          var row = state.inbox.sortedInsert(msg.value.timestamp, msg.key)
          attachIsRead(row)
          row.author = msg.value.author // inbox index is filtered on read by the friends graph
          if (follows(sbot.id, msg.value.author))
            emit('index-change', { index: 'inbox' })
        }

        // collect keys of user's messages
        if (msg.value.author === sbot.id)
          state.mymsgs.push(msg.key)

        // type processing
        var process = processors[msg.value.content.type]
        if (process)
          process(msg)
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

// allow A-z0-9._-, dont allow a trailing .
var badNameCharsRegex = /[^A-z0-9\._-]/g
function makeNameSafe (str) {
  str = str.replace(badNameCharsRegex, '_')
  if (str.charAt(str.length - 1) == '.')
    str = str.slice(0, -1) + '_'
  return str
}