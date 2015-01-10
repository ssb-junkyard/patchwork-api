var multicb = require('multicb')
var tape    = require('tape')
var ssbKeys = require('ssb-keys')

tape('posts, replies, and inbox', function (t) {
  require('./util').newapi(function (err, api, ssb, feed) {
    if (err) throw err

    api.postText('first', function (err, msg1, key1) {
      if (err) throw err
      t.equal(msg1.content.text, 'first')

      api.postReply('second', key1, function (err, msg2, key2) {
        if (err) throw err
        t.equal(msg2.content.text, 'second')
        t.equal(msg2.content.repliesTo.msg, key1)
        t.equal(api.getNumReplies(key1), 1)

        api.getPosts(function (err, msgs) {
          if (err) throw err
          t.equal(msgs.length, 1)
          t.equal(msgs[0].content.text, 'first')

          api.getMsg(key1, function (err, msg1b) {
            if (err) throw err
            t.equal(msg1b.content.text, 'first')

            api.getReplies(key1, function (err, replies) {
              if (err) throw err
              t.equal(replies.length, 1)
              t.equal(replies[0].content.text, 'second')

              api.postText('hello @'+feed.id, function (err, msg3, key3) {
                if (err) throw err

                api.getInbox(function (err, msgs) {
                  if (err) throw err
                  t.equal(msgs.length, 2)
                  t.equal(msgs[0].content.text, 'hello @'+feed.id)
                  t.equal(msgs[1].content.text, 'second')
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
        t.equal(ads[0].content.text, '6')
        t.equal(ads[1].content.text, '5')
        t.equal(ads[2].content.text, '4')
        t.equal(ads[3].content.text, '3')
        t.equal(ads[4].content.text, '2')
        t.equal(ads[5].content.text, '1')

        api.getRandomAdverts(2, 5, function (err, ads) {
          if (err) throw err
          t.equal(ads.length, 2)
          t.ok(ads[0].content.text != '1') // there's only a statistical chance this can fail
          t.ok(ads[1].content.text != '1') // if it fails, the use of the random function is wrong
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