/** @format */

// Utility function to build headers dynamically
function buildHeaders(mac, referer, token = null) {
  let cookie = `mac=${mac}; stb_lang=en; timezone=Europe%2FLondon`;
  if (token) cookie += `; token=${token}`;

  return {
    'User-Agent':
      'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 6 rev: 1a90f4f Mobile Safari/533.3',
    'X-User-Agent': 'Model: MAG250; Link: Ethernet',
    Referer: referer,
    Accept: 'application/json',
    Cookie: cookie,
  };
}

module.exports = { buildHeaders };
