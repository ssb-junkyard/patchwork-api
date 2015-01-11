var path = require('path')
var rimraf = require('rimraf')
var osenv = require('osenv')
var createApi = require('../')

var n = 0
exports.newapi = function (cb) {
  var dir = path.join(osenv.tmpdir(), 'phoenix-api-test'+(++n))
  rimraf.sync(dir)

  var sbot = require('scuttlebot')({ path: dir }).use(require('scuttlebot/plugins/friends'))
  var ssbapi = require('scuttlebot/lib/api')(sbot)
  ssbapi.friends = {
    all: function (type, cb) {
      cb(null, sbot.friends.all(type))
    }
  }
  var api = createApi(ssbapi)
  api.startIndexing(function (err) {
    cb(err, api, sbot.ssb, sbot.feed)
  })
}