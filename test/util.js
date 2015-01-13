var path = require('path')
var rimraf = require('rimraf')
var osenv = require('osenv')
var phoenixApi = require('../')

phoenixApi.name = 'phoenix'
phoenixApi.version = '0.0.0'

var n = 0
exports.newserver = function () {
  var dir = path.join(osenv.tmpdir(), 'phoenix-api-test'+(++n))
  rimraf.sync(dir)

  return require('scuttlebot')({ path: dir })
    .use(require('scuttlebot/plugins/friends'))
    .use(phoenixApi)
}