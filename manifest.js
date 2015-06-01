module.exports = {
  createEventStream: 'source',

  getIndexCounts: 'async',
  createInboxStream: 'source',
  createHomeStream: 'source',

  markRead: 'async',
  markUnread: 'async',
  toggleRead: 'async',
  isRead: 'async',

  subscribe: 'async',
  unsubscribe: 'async',
  toggleSubscribed: 'async',
  isSubscribed: 'async',

  getMyProfile: 'async',
  getProfile: 'async',
  getAllProfiles: 'async',

  getNamesById: 'async',
  getNameTrustRanks: 'async',
  getName: 'async',
  getIdsByName: 'async',
  getActionItems: 'async'
}