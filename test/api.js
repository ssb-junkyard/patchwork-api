var multicb = require('multicb')
var tape    = require('tape')
var ssbKeys = require('ssb-keys')

tape('feed', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    var done = multicb()
    api.postText('1', done())
    api.postText('2', done())
    api.postText('3', done())
    api.postText('4', done())
    api.postText('5', done())
    api.postText('6', done())
    done(function (err) {
      if (err) throw err

      api.getFeed({ limit: 2, reverse: true }, function (err, msgs) {
        if (err) throw err
        t.equal(msgs[0].value.content.text, '6')
        t.equal(msgs[1].value.content.text, '5')

        api.getFeed({ limit: 2, reverse: true, lt: msgs[1] }, function (err, msgs) {
          if (err) throw err
          t.equal(msgs[0].value.content.text, '4')
          t.equal(msgs[1].value.content.text, '3')

          t.end()
        })
      })
    })
  })
})

tape('posts, replies, and inbox', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    api.postText('first', function (err, msg1) {
      if (err) throw err
      t.equal(msg1.value.content.text, 'first')

      api.postReply('second', msg1.key, function (err, msg2) {
        if (err) throw err
        t.equal(msg2.value.content.text, 'second')
        t.equal(msg2.value.content.repliesTo.msg, msg1.key)
        t.equal(api.getReplyCount(msg1.key), 1)

        api.getPosts(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 1)
          t.equal(msgs[0].value.content.text, 'first')

          api.getMsg(msg1.key, function (err, msg1b) {
            if (err) throw err
            t.equal(msg1b.value.content.text, 'first')

            api.getReplies(msg1.key, function (err, replies) {
              if (err) throw err
              t.equal(replies.length, 1)
              t.equal(replies[0].value.content.text, 'second')

              api.getPostParent(replies[0].key, function (err, parent) {
                if (err) throw err
                t.equal(parent.key, msg1.key)

                api.getPostParent(msg1.key, function (err, parent2) {
                  if (err) throw err
                  t.assert(!parent2)

                  api.postText('hello @'+feed.id, function (err, msg3) {
                    if (err) throw err

                    api.getInbox(function (err, msgs) {
                      if (err) throw err
                      t.equal(msgs.length, 2)
                      t.equal(msgs[0].value.content.text, 'hello @'+feed.id)
                      t.equal(msgs[1].value.content.text, 'second')
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
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    api.postText('top', function (err, msg1) {
      if (err) throw err
      t.equal(msg1.value.content.text, 'top')

      var done = multicb({ pluck: 1 })
      api.postReply('reply 1', msg1.key, done())
      api.postReply('reply 2', msg1.key, done())
      done(function (err, replies) {
        if (err) throw err
        t.equal(replies.length, 2)

        var done = multicb({ pluck: 1 })
        api.postReply('reply 1 reply 1', replies[0].key, done())
        api.postReply('reply 1 reply 2', replies[0].key, done())
        api.postReply('reply 2 reply 1', replies[1].key, done())
        done(function (err, replies2) {
          if (err) throw err
          t.equal(replies2.length, 3)

          api.getThread(msg1.key, function (err, thread) {
            if (err) throw err
            t.equal(thread.value.content.text, 'top')
            t.equal(thread.replies.length, 2)
            t.equal(thread.replies[0].value.content.text, 'reply 2')
            t.equal(thread.replies[1].value.content.text, 'reply 1')
            t.equal(thread.replies[0].replies.length, 1)
            t.equal(thread.replies[0].replies[0].value.content.text, 'reply 2 reply 1')
            t.equal(thread.replies[1].replies.length, 2)
            t.equal(thread.replies[1].replies[0].value.content.text, 'reply 1 reply 2')
            t.equal(thread.replies[1].replies[1].value.content.text, 'reply 1 reply 1')
            t.equal(api.getThreadReplyCount(msg1.key), 5)

            t.end()
          })
        })
      })
    })
  })
})

tape('posts by author', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    var alice = ssb.createFeed(ssbKeys.generate())
    var bob   = ssb.createFeed(ssbKeys.generate())

    var done = multicb()
    api.postText('post by me 1', done())
    api.postText('post by me 2', done())
    alice.add({ type: 'post', text: 'post by alice' }, done())
    bob  .add({ type: 'post', text: 'post by bob' }, done())
    done(function (err) {
      if (err) throw err
      // kludge: wait for the alice.add and bob.add to be indexed
      setTimeout(function () {
        var done = multicb({ pluck: 1 })
        api.getPostsBy(feed.id, done())
        api.getPostsBy(alice.id, done())
        api.getPostsBy(bob.id, done())

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
})

tape('adverts', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    var done = multicb()
    api.postAdvert('1', done())
    api.postAdvert('2', done())
    api.postAdvert('3', done())
    api.postAdvert('4', done())
    api.postAdvert('5', done())
    api.postAdvert('6', done())
    done(function (err) {
      if (err) throw err

      api.getAdverts(function (err, ads) {
        if (err) throw err
        t.equal(ads.length, 6)
        t.equal(ads[0].value.content.text, '6')
        t.equal(ads[1].value.content.text, '5')
        t.equal(ads[2].value.content.text, '4')
        t.equal(ads[3].value.content.text, '3')
        t.equal(ads[4].value.content.text, '2')
        t.equal(ads[5].value.content.text, '1')

        api.getRandomAdverts(2, 5, function (err, ads) {
          if (err) throw err
          t.equal(ads.length, 2)
          t.ok(ads[0].value.content.text != '1') // there's only a statistical chance this can fail
          t.ok(ads[1].value.content.text != '1') // if it fails, the use of the random function is wrong
          t.end()
        })
      })
    })
  })
})

tape('names', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    var alice = ssb.createFeed(ssbKeys.generate())
    var bob   = ssb.createFeed(ssbKeys.generate())

    var done = multicb()
    api.nameSelf('zed', done())
    api.nameOther(bob.id, 'robert', done())
    alice.add({ type: 'name', name: 'alice' }, done())
    bob  .add({ type: 'name', name: 'bob' }, done())
    done(function (err) {
      if (err) throw err
      // kludge: wait for the alice.add and bob.add to be indexed
      setTimeout(function () {
        t.equal(api.getNameById(feed.id),   'zed')
        t.equal(api.getNameById(alice.id),  '"alice"')
        t.equal(api.getNameById(bob.id),    'robert')
        t.equal(api.getIdByName('zed'),     feed.id)
        t.equal(api.getIdByName('"alice"'), alice.id)
        t.equal(api.getIdByName('robert'),  bob.id)
        t.end()
      }, 100)
    })
  })
})

tape('graph', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    var alice = ssb.createFeed(ssbKeys.generate())
    var bob   = ssb.createFeed(ssbKeys.generate())

    var done = multicb()
    api.addEdge('follow', alice.id, done())
    api.addEdge('follow', bob.id, done())
    api.delEdge('follow', bob.id, done())
    api.addEdge('trust', alice.id, done())
    api.addEdge('flag', bob.id, done())
    done(function (err) {
      if (err) throw err
      
      // kludge: we have no way of knowing when the friends plugin has done its indexing, so we have to wait 100ms
      setTimeout(function() {
        var done = multicb({ pluck: 1 })
        api.getGraph('follow', done())
        api.getGraph('trust', done())
        api.getGraph('flag', done())
        done(function (err, graphs) {
          if (err) throw err
          var followGraph = graphs[0]
          var trustGraph = graphs[1]
          var flagGraph = graphs[2]

          t.equal(followGraph[feed.id][alice.id], true)
          t.equal(followGraph[feed.id][bob.id],   undefined)
          t.equal(trustGraph [feed.id][alice.id], true)
          t.equal(trustGraph [feed.id][bob.id],   undefined)
          t.equal(flagGraph  [feed.id][alice.id], undefined)
          t.equal(flagGraph  [feed.id][bob.id],   true)

          t.end()
        })
      }, 100)
    })
  })
})