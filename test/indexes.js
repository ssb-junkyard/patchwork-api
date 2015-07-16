var multicb = require('multicb')
var tape    = require('tape')
var ssbkeys = require('ssb-keys')
var pull    = require('pull-stream')
var u       = require('./util')

tape('inbox index includes encrypted messages from followeds', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    var done = multicb()
    users.bob.add(ssbkeys.box({ type: 'post', text: 'hello from bob' }, [users.alice.keys, users.bob.keys]), done())
    users.charlie.add(ssbkeys.box({ type: 'post', text: 'hello from charlie' }, [users.alice.keys, users.charlie.keys]), done())
    done(function (err) {
      if (err) throw err

      pull(sbot.phoenix.createInboxStream(), pull.collect(function (err, msgs) {
        if (err) throw err
        t.equal(msgs.length, 1)
        t.equal(msgs[0].value.author, users.bob.id)
        t.end()
      }))
    })
  })
})

tape('inbox index includes replies to the users posts from followeds', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    users.alice.add({ type: 'post', text: 'hello from alice' }, function (err, msg) {
      if (err) throw err

      var done = multicb()
      users.bob.add({ type: 'post', text: 'hello from bob', repliesTo: { msg: msg.key } }, done())
      users.charlie.add({ type: 'post', text: 'hello from charlie', repliesTo: { msg: msg.key } }, done())
      done(function (err) {
        if (err) throw err

        pull(sbot.phoenix.createInboxStream(), pull.collect(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 1)
          t.equal(msgs[0].value.author, users.bob.id)
          t.end()
        }))
      })
    })
  })
})

tape('inbox index includes mentions of the user from followeds', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    var done = multicb()
    users.bob.add({ type: 'post', text: 'hello from bob', mentions: [{ feed: users.alice.id }] }, done())
    users.charlie.add({ type: 'post', text: 'hello from charlie', mentions: [{ feed: users.alice.id }] }, done())
    done(function (err) {
      if (err) throw err

      pull(sbot.phoenix.createInboxStream(), pull.collect(function (err, msgs) {
        if (err) throw err
        t.equal(msgs.length, 1)
        t.equal(msgs[0].value.author, users.bob.id)
        t.end()
      }))
    })
  })
})

tape('inbox index counts correctly track read/unread', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    var done = multicb()
    users.bob.add({ type: 'post', text: 'hello from bob', mentions: [{ feed: users.alice.id }] }, done())
    users.charlie.add({ type: 'post', text: 'hello from charlie', mentions: [{ feed: users.alice.id }] }, done())
    done(function (err, msgs) {
      if (err) throw err
      var inboxedMsg = msgs[0][1]

      sbot.phoenix.getIndexCounts(function (err, counts) {
        if (err) throw err
        t.equal(counts.inbox, 1)
        t.equal(counts.inboxUnread, 1)

        sbot.phoenix.markRead(inboxedMsg.key, function (err) {
          if (err) throw err

          sbot.phoenix.getIndexCounts(function (err, counts) {
            if (err) throw err
            t.equal(counts.inbox, 1)
            t.equal(counts.inboxUnread, 0)

            sbot.phoenix.markUnread(inboxedMsg.key, function (err) {
              if (err) throw err

              sbot.phoenix.getIndexCounts(function (err, counts) {
                if (err) throw err
                t.equal(counts.inbox, 1)
                t.equal(counts.inboxUnread, 1)

                t.end()
              })
            })
          })
        })
      })
    })
  })
})

tape('vote index includes upvotes on the users posts', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    users.alice.add({ type: 'post', text: 'hello from alice' }, function (err, msg) {
      if (err) throw err

      var done = multicb()
      users.bob.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: 1 }, done())
      users.charlie.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: 1 }, done())
      done(function (err) {
        if (err) throw err

        pull(sbot.phoenix.createVoteStream(), pull.collect(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 2)
          t.end()
        }))
      })
    })
  })
})

tape('vote index does not include downvotes, and removes unvotes', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    users.alice.add({ type: 'post', text: 'hello from alice' }, function (err, msg) {
      if (err) throw err

      var done = multicb()
      users.bob.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: -1 }, done())
      users.charlie.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: 1 }, done())
      users.charlie.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: 0 }, done())
      done(function (err) {
        if (err) throw err

        pull(sbot.phoenix.createVoteStream(), pull.collect(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 0)
          t.end()
        }))
      })
    })
  })
})

tape('vote index counts correctly track read/unread', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    users.alice.add({ type: 'post', text: 'hello from alice' }, function (err, msg) {
      if (err) throw err

      var done = multicb()
      users.bob.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: 1 }, done())
      users.charlie.add({ type: 'vote', voteTopic: { msg: msg.key }, vote: 1 }, done())
      done(function (err, msgs) {
        if (err) throw err
        var voteMsg = msgs[0][1]

        sbot.phoenix.getIndexCounts(function (err, counts) {
          if (err) throw err
          t.equal(counts.votes, 2)
          t.equal(counts.votesUnread, 2)

          sbot.phoenix.markRead(voteMsg.key, function (err) {
            if (err) throw err

            sbot.phoenix.getIndexCounts(function (err, counts) {
              if (err) throw err
              t.equal(counts.votes, 2)
              t.equal(counts.votesUnread, 1)

              sbot.phoenix.markUnread(voteMsg.key, function (err) {
                if (err) throw err

                sbot.phoenix.getIndexCounts(function (err, counts) {
                  if (err) throw err
                  t.equal(counts.votes, 2)
                  t.equal(counts.votesUnread, 2)
                  t.end()
                })
              })
            })
          })
        })
      })
    })
  })
})

tape('follow index includes all new followers', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: {},
    bob: { follows: ['alice'] },
    charlie: { follows: ['alice'] }
  }, function (err, users) {
    if (err) throw err

    pull(sbot.phoenix.createFollowStream(), pull.collect(function (err, msgs) {
      if (err) throw err
      t.equal(msgs.length, 2)
      t.end()
    }))
  })
})

tape('follow index includes unfollows', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: {},
    bob: { follows: ['alice'] },
    charlie: { follows: ['alice'] }
  }, function (err, users) {
    if (err) throw err

    users.charlie.add({ type: 'contact', contact: { feed: users.alice.id }, following: false }, function (err) {
      if (err) throw err
      pull(sbot.phoenix.createFollowStream(), pull.collect(function (err, msgs) {
        if (err) throw err
        t.equal(msgs.length, 3)
        t.end()
      }))
    })
  })
})

tape('follow index counts correctly track read/unread', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: {},
    bob: { follows: ['alice'] },
    charlie: { follows: ['alice'] }
  }, function (err, users, msgs) {
    if (err) throw err
    var followMsg = msgs[1][1]

    sbot.phoenix.getIndexCounts(function (err, counts) {
      if (err) throw err
      t.equal(counts.follows, 2)
      t.equal(counts.followsUnread, 2)

      sbot.phoenix.markRead(followMsg.key, function (err) {
        if (err) throw err

        sbot.phoenix.getIndexCounts(function (err, counts) {
          if (err) throw err
          t.equal(counts.follows, 2)
          t.equal(counts.followsUnread, 1)

          sbot.phoenix.markUnread(followMsg.key, function (err) {
            if (err) throw err

            sbot.phoenix.getIndexCounts(function (err, counts) {
              if (err) throw err
              t.equal(counts.follows, 2)
              t.equal(counts.followsUnread, 2)

              t.end()
            })
          })
        })
      })
    })
  })
})

tape('home index includes all non-reply posts', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    users.alice.add({ type: 'post', text: 'hello from alice' }, function (err, msg) {
      if (err) throw err

      var done = multicb()
      users.bob.add({ type: 'post', text: 'hello from bob' }, done())
      users.charlie.add({ type: 'post', text: 'hello from charlie', repliesTo: { msg: msg.key } }, done())
      done(function (err) {
        if (err) throw err

        pull(sbot.phoenix.createHomeStream(), pull.collect(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 2)
          t.notEqual(msgs[0].value.author, users.charlie.id)
          t.notEqual(msgs[1].value.author, users.charlie.id)
          t.end()
        }))
      })
    })
  })
})

tape('home index includes non-posts with post replies on them', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob'] }, // Note, does not follow charlie
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    users.alice.add({ type: 'nonpost', text: 'hello from alice' }, function (err, msg) {
      if (err) throw err

      var done = multicb()
      users.bob.add({ type: 'nonpost', text: 'hello from bob' }, done())
      users.charlie.add({ type: 'post', text: 'hello from charlie', repliesTo: { msg: msg.key } }, done())
      done(function (err) {
        if (err) throw err

        pull(sbot.phoenix.createHomeStream(), pull.collect(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 1)
          t.equal(msgs[0].value.author, users.alice.id)
          t.end()
        }))
      })
    })
  })
})

