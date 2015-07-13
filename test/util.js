var path = require('path')
var rimraf = require('rimraf')
var osenv = require('osenv')
var multicb = require('multicb')
var ssbkeys = require('ssb-keys')
var phoenixApi = require('../')

phoenixApi.name = 'phoenix'
phoenixApi.version = '0.0.0'

var n = 0
exports.newserver = function () {
  var dir = path.join(osenv.tmpdir(), 'phoenix-api-test'+(++n))
  rimraf.sync(dir)

  return require('scuttlebot')({ path: dir }).use(phoenixApi)
}

exports.makeusers = function (sbot, desc, cb) {
  var users = { alice: sbot.feed }
  var done = multicb()

  // generate feeds
  for (var name in desc) {
    if (!users[name])
      users[name] = sbot.ssb.createFeed(ssbkeys.generate())
    console.log(name+':', users[name].id)
  }

  // generate follows
  for (var name in desc) {  
    ;(desc[name].follows||[]).forEach(function (name2) {
      users[name].add({ type: 'contact', contact: { feed: users[name2].id }, following: true }, done())
    })
  }

  done(function (err, msgs) {
    if (err) cb(err)
    else cb(null, users, msgs)
  })
}