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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

app.get('/kitchen_sink_stream', async (req, res) => {
  const { url, portal, mac, token } = req.query;
  if (!url) return res.status(400).send('Missing url param');

  // Unique ID for this stream (based on URL+token)
  const streamId = crypto
    .createHash('md5')
    .update(url + (token || ''))
    .digest('hex');
  const tmpDir = path.join('/tmp', `hls_${streamId}`);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  // If it's an HLS playlist, just proxy and rewrite segment URLs
  if (url.endsWith('.m3u8')) {
    const axios = require('axios');
    try {
      const headers =
        portal && mac ? buildHeaders(mac, `${portal}/c/`, token) : {};
      const response = await axios.get(url, { headers });
      // Rewrite segment URLs to go through our /kitchen_sink_segment endpoint
      const rewritten = response.data.replace(
        /^(?!#)([^\r\n]+\.ts(\?.*)?)$/gm,
        (line) => {
          let absUrl = line.trim();
          if (!absUrl.startsWith('http')) {
            absUrl = new URL(absUrl, url).toString();
          }
          return `/kitchen_sink_segment/${streamId}?segmentUrl=${encodeURIComponent(
            absUrl
          )}&portal=${encodeURIComponent(
            portal || ''
          )}&mac=${encodeURIComponent(mac || '')}&token=${encodeURIComponent(
            token || ''
          )}`;
        }
      );
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
    } catch (err) {
      res.status(500).send('#EXTM3U\n');
    }
    return;
  }

  // If it's a .ts or direct stream, transmux to HLS
  // Write HLS segments to disk
  const playlistPath = path.join(tmpDir, 'index.m3u8');
  const segmentPattern = path.join(tmpDir, 'segment_%03d.ts');

  // If playlist already exists and is fresh, serve it
  if (
    fs.existsSync(playlistPath) &&
    Date.now() - fs.statSync(playlistPath).mtimeMs < 10000
  ) {
    // Rewrite segment URLs in the playlist
    let playlist = fs.readFileSync(playlistPath, 'utf8');
    playlist = playlist.replace(
      /(segment_\d+\.ts)/g,
      (seg) => `/kitchen_sink_segment/${streamId}?segmentFile=${seg}`
    );
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
    return;
  }

  // Clean up old segments
  if (fs.existsSync(tmpDir)) {
    fs.readdirSync(tmpDir).forEach((file) => {
      if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    });
  }

  // Build ffmpeg args
  const args = [
    '-y',
    '-i',
    url,
    '-c',
    'copy',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_list_size',
    '3',
    '-hls_flags',
    'delete_segments',
    '-hls_segment_filename',
    segmentPattern,
    playlistPath,
  ];

  // Add headers if Stalker
  if (portal && mac) {
    const headers = buildHeaders(mac, `${portal}/c/`, token);
    const headerString = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    args.unshift('-headers', headerString);
  }

  // Start ffmpeg
  const ffmpeg = spawn('ffmpeg', args);

  ffmpeg.stderr.on('data', (data) => {
    // Uncomment for debugging: console.error(`ffmpeg: ${data}`);
  });

  ffmpeg.on('close', (code) => {
    // Uncomment for debugging: console.log(`ffmpeg exited with code ${code}`);
  });

  // Wait for playlist to be generated, then serve it
  let waited = 0;
  const waitForPlaylist = setInterval(() => {
    if (fs.existsSync(playlistPath)) {
      clearInterval(waitForPlaylist);
      let playlist = fs.readFileSync(playlistPath, 'utf8');
      playlist = playlist.replace(
        /(segment_\d+\.ts)/g,
        (seg) => `/kitchen_sink_segment/${streamId}?segmentFile=${seg}`
      );
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(playlist);
    } else if (waited > 5000) {
      clearInterval(waitForPlaylist);
      res.status(500).send('#EXTM3U\n');
    }
    waited += 100;
  }, 100);
});

// Serve HLS segments
app.get('/kitchen_sink_segment/:streamId', (req, res) => {
  const { streamId } = req.params;
  const { segmentFile, segmentUrl, portal, mac, token } = req.query;
  const tmpDir = path.join('/tmp', `hls_${streamId}`);

  if (segmentFile) {
    const filePath = path.join(tmpDir, segmentFile);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'video/mp2t');
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.status(404).send('Segment not found');
    }
  } else if (segmentUrl) {
    // For HLS sources, proxy the segment with headers if needed
    const axios = require('axios');
    const headers =
      portal && mac ? buildHeaders(mac, `${portal}/c/`, token) : {};
    axios
      .get(segmentUrl, { headers, responseType: 'stream' })
      .then((response) => {
        res.setHeader('Content-Type', 'video/mp2t');
        response.data.pipe(res);
      })
      .catch(() => res.status(404).send('Segment not found'));
  } else {
    res.status(400).send('Missing segment');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔌 IPTV Proxy running at http://0.0.0.0:${PORT}`);
});
