var multicb = require('multicb')
var tape    = require('tape')
var ssbKeys = require('ssb-keys')
var pull    = require('pull-stream')

tape('feed', function (t) {
  var sbot = require('./util').newserver()

  var done = multicb()
  sbot.phoenix.postText('1', done())
  sbot.phoenix.postText('2', done())
  sbot.phoenix.postText('3', done())
  sbot.phoenix.postText('4', done())
  sbot.phoenix.postText('5', done())
  sbot.phoenix.postText('6', done())
  done(function (err) {
    if (err) throw err

    sbot.phoenix.getFeed({ limit: 2, reverse: true }, function (err, msgs) {
      if (err) throw err
      t.equal(msgs[0].value.content.text, '6')
      t.equal(msgs[1].value.content.text, '5')

      sbot.phoenix.getFeed({ limit: 2, reverse: true, lt: msgs[1] }, function (err, msgs) {
        if (err) throw err
        t.equal(msgs[0].value.content.text, '4')
        t.equal(msgs[1].value.content.text, '3')

        t.end()
      })
    })
  })
})

tape('posts, replies, and inbox', function (t) {
  var sbot = require('./util').newserver()

  var numNewPosts = 0
  pull(sbot.phoenix.events(), pull.drain(function (e) {
    if (e.type == 'post')
      numNewPosts++
  }))

  sbot.phoenix.postText('first', function (err, msg1) {
    if (err) throw err
    t.equal(msg1.value.content.text, 'first')

    sbot.phoenix.postReply('second', msg1.key, function (err, msg2) {
      if (err) throw err
      t.equal(msg2.value.content.text, 'second')
      t.equal(msg2.value.content.repliesTo.msg, msg1.key)

      sbot.phoenix.getMsg(msg1.key, function (err, msg1full) {
        if (err) throw err
        t.equal(msg1full.replies.length, 1)

        sbot.phoenix.getPosts(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 1)
          t.equal(msgs[0].value.content.text, 'first')

          sbot.phoenix.getMsg(msg1.key, function (err, msg1b) {
            if (err) throw err
            t.equal(msg1b.value.content.text, 'first')

            sbot.phoenix.getReplies(msg1.key, function (err, replies) {
              if (err) throw err
              t.equal(replies.length, 1)
              t.equal(replies[0].value.content.text, 'second')

              sbot.phoenix.getPostParent(replies[0].key, function (err, parent) {
                if (err) throw err
                t.equal(parent.key, msg1.key)

                sbot.phoenix.getPostParent(msg1.key, function (err, parent2) {
                  if (err) throw err
                  t.assert(!parent2)

                  sbot.phoenix.postText('hello @'+sbot.feed.id, function (err, msg3) {
                    if (err) throw err

                    sbot.phoenix.getInbox(function (err, msgs) {
                      if (err) throw err
                      t.equal(msgs.length, 2)
                      t.equal(msgs[0].value.content.text, 'hello @'+sbot.feed.id)
                      t.equal(msgs[1].value.content.text, 'second')
                      t.equal(numNewPosts, 2)
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
  })
})

tape('threads', function (t) {
  var sbot = require('./util').newserver()

  sbot.phoenix.postText('top', function (err, msg1) {
    if (err) throw err
    t.equal(msg1.value.content.text, 'top')

    var done = multicb({ pluck: 1 })
    sbot.phoenix.postReply('reply 1', msg1.key, done())
    sbot.phoenix.postReply('reply 2', msg1.key, done())
    done(function (err, replies) {
      if (err) throw err
      t.equal(replies.length, 2)

      var done = multicb({ pluck: 1 })
      sbot.phoenix.postReply('reply 1 reply 1', replies[0].key, done())
      sbot.phoenix.postReply('reply 1 reply 2', replies[0].key, done())
      sbot.phoenix.postReply('reply 2 reply 1', replies[1].key, done())
      done(function (err, replies2) {
        if (err) throw err
        t.equal(replies2.length, 3)

        sbot.phoenix.getThread(msg1.key, function (err, thread) {
          if (err) throw err
          t.equal(thread.value.content.text, 'top')
          t.equal(thread.replies.length, 2)
          t.equal(thread.numThreadReplies, 5)
          t.equal(thread.replies[0].value.content.text, 'reply 2')
          t.equal(thread.replies[1].value.content.text, 'reply 1')
          t.equal(thread.replies[0].replies.length, 1)
          t.equal(thread.replies[0].replies[0].value.content.text, 'reply 2 reply 1')
          t.equal(thread.replies[1].replies.length, 2)
          t.equal(thread.replies[1].replies[0].value.content.text, 'reply 1 reply 2')
          t.equal(thread.replies[1].replies[1].value.content.text, 'reply 1 reply 1')

          t.end()
        })
      })
    })
  })
})

tape('posts by author', function (t) {
  var sbot = require('./util').newserver()

  var alice = sbot.ssb.createFeed(ssbKeys.generate())
  var bob   = sbot.ssb.createFeed(ssbKeys.generate())

  var done = multicb()
  sbot.phoenix.postText('post by me 1', done())
  sbot.phoenix.postText('post by me 2', done())
  alice.add({ type: 'post', text: 'post by alice' }, done())
  bob  .add({ type: 'post', text: 'post by bob' }, done())
  done(function (err) {
    if (err) throw err
    // kludge: wait for the alice.add and bob.add to be indexed
    setTimeout(function () {
      var done = multicb({ pluck: 1 })
      sbot.phoenix.getPostsBy(sbot.feed.id, done())
      sbot.phoenix.getPostsBy(alice.id, done())
      sbot.phoenix.getPostsBy(bob.id, done())

      done(function (err, posts) {
        if (err) throw err
        t.equal(posts[0].length, 2)
        t.equal(posts[0][0].value.content.text, 'post by me 2')
        t.equal(posts[0][1].value.content.text, 'post by me 1')
        t.equal(posts[1][0].value.content.text, 'post by alice')
        t.equal(posts[2][0].value.content.text, 'post by bob')

        t.end()
      })
    }, 100)
  })
})

tape('adverts', function (t) {
  var sbot = require('./util').newserver()

  var done = multicb()
  sbot.phoenix.postAdvert('1', done())
  sbot.phoenix.postAdvert('2', done())
  sbot.phoenix.postAdvert('3', done())
  sbot.phoenix.postAdvert('4', done())
  sbot.phoenix.postAdvert('5', done())
  sbot.phoenix.postAdvert('6', done())
  done(function (err) {
    if (err) throw err

    sbot.phoenix.getAdverts(function (err, ads) {
      if (err) throw err
      t.equal(ads.length, 6)
      t.equal(ads[0].value.content.text, '6')
      t.equal(ads[1].value.content.text, '5')
      t.equal(ads[2].value.content.text, '4')
      t.equal(ads[3].value.content.text, '3')
      t.equal(ads[4].value.content.text, '2')
      t.equal(ads[5].value.content.text, '1')

      sbot.phoenix.getRandomAdverts(2, 5, function (err, ads) {
        if (err) throw err
        t.equal(ads.length, 2)
        t.ok(ads[0].value.content.text != '1') // there's only a statistical chance this can fail
        t.ok(ads[1].value.content.text != '1') // if it fails, the use of the random function is wrong
        t.end()
      })
    })
  })
})

tape('names', function (t) {
  var sbot = require('./util').newserver()

  var alice = sbot.ssb.createFeed(ssbKeys.generate())
  var bob   = sbot.ssb.createFeed(ssbKeys.generate())

  var done = multicb()
  sbot.phoenix.nameSelf('zed', done())
  sbot.phoenix.nameOther(bob.id, 'robert', done())
  alice.add({ type: 'name', name: 'alice' }, done())
  bob  .add({ type: 'name', name: 'bob' }, done())
  done(function (err) {
    if (err) throw err
    // kludge: wait for the alice.add and bob.add to be indexed
    setTimeout(function () {
      sbot.phoenix.getNamesById(function (err, names) {
        if (err) throw err
        t.equal(names[sbot.feed.id], 'zed')
        t.equal(names[alice.id],     '"alice"')
        t.equal(names[bob.id],       'robert')

        sbot.phoenix.getIdsByName(function (err, ids) {
          if (err) throw err
          t.equal(ids['zed'],     sbot.feed.id)
          t.equal(ids['"alice"'], alice.id)
          t.equal(ids['robert'],  bob.id)
          t.end()
        })
      })
    }, 100)
  })
})