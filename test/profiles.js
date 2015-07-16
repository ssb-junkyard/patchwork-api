var multicb = require('multicb')
var tape    = require('tape')
var u       = require('./util')

var exthash = 'RYnp9p24dlAPYGhrsFYdGGHIAYM2uM5pr1//RocCF/U=.sha256'

tape('profiles track self-assigned name and profile pic', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob', 'charlie'] },
    bob: {},
    charlie: {}
  }, function (err, users) {
    if (err) throw err

    var done = multicb()
    users.alice.add({ type: 'contact', contact: { feed: users.alice.id }, profilePic: { ext: exthash } }, done())
    users.bob.add({ type: 'contact', contact: { feed: users.bob.id }, profilePic: { ext: exthash } }, done())
    users.charlie.add({ type: 'contact', contact: { feed: users.charlie.id }, profilePic: { ext: exthash } }, done())
    done(function (err) {
      if (err) throw err

      sbot.phoenix.getAllProfiles(function (err, profiles) {
        if (err) throw err
        t.equal(profiles[users.alice.id].self.name, 'alice')
        t.equal(profiles[users.bob.id].self.name, 'bob')
        t.equal(profiles[users.charlie.id].self.name, 'charlie')
        t.equal(profiles[users.alice.id].self.profilePic.ext, exthash)
        t.equal(profiles[users.bob.id].self.profilePic.ext, exthash)
        t.equal(profiles[users.charlie.id].self.profilePic.ext, exthash)
        t.end()
      })
    })
  })
})

tape('profiles track follows, names, and flags between users', function (t) {
  var sbot = u.newserver()
  u.makeusers(sbot, {
    alice: { follows: ['bob', 'charlie'] },
    bob: { follows: ['alice', 'charlie'] },
    charlie: { follows: ['bob', 'alice'] }
  }, function (err, users) {
    if (err) throw err

    var done = multicb()
    users.alice.add({ type: 'contact', contact: { feed: users.bob.id }, name: 'robert' }, done())
    users.alice.add({ type: 'contact', contact: { feed: users.charlie.id }, flagged: { reason: 'such a jerk!' } }, done())
    users.bob.add({ type: 'contact', contact: { feed: users.charlie.id }, flagged: { reason: 'dont like him' } }, done())
    done(function (err) {
      if (err) throw err

      sbot.phoenix.getAllProfiles(function (err, profiles) {
        if (err) throw err
        function by(a, b) {
          return profiles[users[a].id].assignedBy[users[b].id]
        }
        function to(a, b) {
          return profiles[users[a].id].assignedTo[users[b].id]
        }

        t.equal(to('alice', 'bob').following, true)
        t.equal(to('alice', 'charlie').following, true)
        t.equal(by('bob', 'alice').following, true)
        t.equal(by('charlie', 'alice').following, true)

        t.equal(to('bob', 'alice').following, true)
        t.equal(to('bob', 'charlie').following, true)
        t.equal(by('alice', 'bob').following, true)
        t.equal(by('charlie', 'bob').following, true)

        t.equal(to('charlie', 'bob').following, true)
        t.equal(to('charlie', 'alice').following, true)
        t.equal(by('bob', 'charlie').following, true)
        t.equal(by('alice', 'charlie').following, true)

        t.equal(to('alice', 'charlie').flagged.reason, 'such a jerk!')
        t.equal(by('charlie', 'alice').flagged.reason, 'such a jerk!')
        t.equal(to('bob', 'charlie').flagged.reason, 'dont like him')
        t.equal(by('charlie', 'bob').flagged.reason, 'dont like him')

        t.equal(to('alice', 'bob').name, 'robert')
        t.equal(by('bob', 'alice').name, 'robert')

        t.end()
      })
    })
  })
})