module.exports = {
  createEventStream: 'source',

  getIndexCounts: 'async',
  createInboxStream: 'source',
  createAdvertStream: 'source',
  getRandomAdverts: 'async',

  markRead: 'async',
  markUnread: 'async',
  isRead: 'async',

  subscribe: 'async',
  unsubscribe: 'async',
  isSubscribed: 'async',

  getMyProfile: 'async',
  getProfile: 'async',
  getAllProfiles: 'async',

  getNamesById: 'async',
  getNameTrustRanks: 'async',
  getName: 'async',
  getIdsByName: 'async'
}