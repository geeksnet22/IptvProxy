/** @format */

// iptv_proxy_server.js
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3001;

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

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

app.get('/', (req, res) => {
  res.send('✅ IPTV Proxy is running');
});

// 🔐 Handshake endpoint
app.get('/handshake', async (req, res) => {
  const { portal, mac } = req.query;
  if (!portal || !mac)
    return res.status(400).json({ error: 'Missing portal or mac' });

  const baseUrl = `${portal.replace(/\/$/, '')}/portal.php`;
  const headers = buildHeaders(mac, `${portal}/c/`);

  try {
    const response = await axios.get(
      `${baseUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`,
      { headers }
    );
    res.json(response.data);
  } catch (err) {
    console.error('❌ Handshake error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 📺 Get all channels
app.get('/get_all_channels', async (req, res) => {
  const { portal, mac, token, format } = req.query;
  if (!portal || !mac || !token)
    return res.status(400).json({ error: 'Missing portal, mac, or token' });

  const baseUrl = `${portal.replace(/\/$/, '')}/portal.php`;
  const headers = buildHeaders(mac, `${portal}/c/`, token);
  const url = `${baseUrl}?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;

  try {
    const response = await axios.get(url, { headers });
    if (format === 'm3u') {
      const channels = response.data?.js?.data || [];
      const m3u = generateM3UFromStalker(channels);
      res.set('Content-Type', 'application/x-mpegURL');
      res.send(m3u);
    } else {
      res.json(response.data);
    }
  } catch (err) {
    console.error('❌ Channel error:', err.message);
    if (format === 'm3u') {
      res.status(500).send('#EXTM3U\n');
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

function generateM3UFromStalker(stalkerData) {
  if (!stalkerData || !Array.isArray(stalkerData)) return '#EXTM3U\n';

  const lines = ['#EXTM3U'];
  stalkerData.forEach((channel) => {
    const name = channel.name || 'Unknown Channel';
    const logo = channel.logo || '';
    let streamUrl = '';
    if (Array.isArray(channel.cmds) && channel.cmds.length > 0) {
      streamUrl = channel.cmds[0].url.replace(/^auto\s*/, '');
    } else if (channel.cmd) {
      streamUrl = channel.cmd.replace(/^auto\s*/, '');
    }
    lines.push(
      `#EXTINF:-1 tvg-id="" tvg-logo="${logo}" group-title="${
        channel.genre_str || ''
      }",${name}`
    );
    lines.push(streamUrl);
  });
  return lines.join('\n');
}

// ▶️ Create stream link
app.get('/create_link', async (req, res) => {
  const { portal, mac, token, cmd } = req.query;
  if (!portal || !mac || !token || !cmd)
    return res
      .status(400)
      .json({ error: 'Missing portal, mac, token, or cmd' });

  const baseUrl = `${portal.replace(/\/$/, '')}/portal.php`;
  const headers = buildHeaders(mac, `${portal}/c/`, token);
  const url = `${baseUrl}?type=itv&action=create_link&cmd=${encodeURIComponent(
    cmd
  )}&JsHttpRequest=1-xml`;

  try {
    const response = await axios.get(url, { headers });
    res.json(response.data);
  } catch (err) {
    console.error('❌ Stream link error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/stream', (req, res) => {
  const { url, portal, mac, token } = req.query;
  if (!url) return res.status(400).send('Missing url param');

  let streamUrl;
  try {
    streamUrl = new URL(url);
  } catch {
    return res.status(400).send('Invalid url param');
  }

  const client = streamUrl.protocol === 'https:' ? https : http;

  // Build headers for Stalker streams if portal and mac are present
  let headers = {};
  if (portal && mac) {
    headers = buildHeaders(mac, `${portal}/c/`, token);
  } else {
    if (req.headers.range) headers['Range'] = req.headers.range;
    if (req.headers['user-agent'])
      headers['User-Agent'] = req.headers['user-agent'];
  }

  client
    .get(url, { headers }, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';

      // If it's any m3u8 playlist, rewrite ALL non-comment, non-absolute URLs
      if (
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL') ||
        url.endsWith('.m3u8')
      ) {
        let data = '';
        proxyRes.on('data', (chunk) => (data += chunk));
        proxyRes.on('end', () => {
          const rewritten = data.replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
            let refUrl = line.trim();
            if (!refUrl.startsWith('http')) {
              refUrl = new URL(refUrl, url).toString();
            }
            // Pass portal/mac/token for Stalker segments
            let stalkerParams = '';
            if (portal && mac) {
              stalkerParams = `&portal=${encodeURIComponent(
                portal
              )}&mac=${encodeURIComponent(mac)}`;
              if (token) stalkerParams += `&token=${encodeURIComponent(token)}`;
            }
            return `/stream?url=${encodeURIComponent(refUrl)}${stalkerParams}`;
          });
          res.setHeader('Content-Type', contentType);
          res.send(rewritten);
        });
      } else {
        // For all other streams, just pipe
        const filteredHeaders = { ...proxyRes.headers };
        delete filteredHeaders['transfer-encoding'];
        delete filteredHeaders['content-encoding'];
        delete filteredHeaders['connection'];
        res.writeHead(proxyRes.statusCode, filteredHeaders);
        proxyRes.pipe(res);
      }
    })
    .on('error', (err) => {
      console.error('Stream proxy error:', err.message);
      res.status(500).send('Stream proxy error');
    });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔌 IPTV Proxy running at http://0.0.0.0:${PORT}`);
});
