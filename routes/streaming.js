/** @format */

const express = require('express');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { buildHeaders } = require('../utils/headers');
const {
  getStreamId,
  incrementActiveStreams,
  decrementActiveStreams,
  getActiveStreamsCount,
} = require('../utils/helpers');
const { TMP_ROOT, MAX_CONCURRENT_STREAMS } = require('../utils/cleanup');

const router = express.Router();

// --- Main endpoint: Kitchen Sink Stream ---
router.get('/kitchen_sink_stream', async (req, res) => {
  const { url, portal, mac, token } = req.query;
  if (!url) return res.status(400).send('Missing url param');

  // Limit concurrent ffmpeg processes
  if (getActiveStreamsCount() >= MAX_CONCURRENT_STREAMS) {
    return res
      .status(429)
      .send('Too many concurrent streams, try again later.');
  }

  const streamId = getStreamId(url, token);
  const tmpDir = path.join(TMP_ROOT, `hls_${streamId}`);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  // If it's an HLS playlist, just proxy and rewrite segment URLs
  if (url.endsWith('.m3u8')) {
    try {
      const headers =
        portal && mac ? buildHeaders(mac, `${portal}/c/`, token) : {};
      const response = await axios.get(url, { headers });
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
  const playlistPath = path.join(tmpDir, 'index.m3u8');
  const segmentPattern = path.join(tmpDir, 'segment_%03d.ts');

  // If playlist already exists and is fresh, serve it
  if (
    fs.existsSync(playlistPath) &&
    Date.now() - fs.statSync(playlistPath).mtimeMs < 15000
  ) {
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
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-f',
    'hls',
    '-hls_time',
    '4', // 4s segments: quick start, not too many files
    '-hls_list_size',
    '14', // 14 segments: plenty of buffer for smoothness
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
  incrementActiveStreams();
  const ffmpeg = spawn('ffmpeg', args);

  ffmpeg.stderr.on('data', (data) => {
    console.error(`ffmpeg: ${data}`);
  });

  ffmpeg.on('close', (code) => {
    decrementActiveStreams();
    if (code !== 0) {
      console.error(`ffmpeg exited with code ${code}`);
    }
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
router.get('/kitchen_sink_segment/:streamId', (req, res) => {
  const { streamId } = req.params;
  const { segmentFile, segmentUrl, portal, mac, token } = req.query;
  const tmpDir = path.join(TMP_ROOT, `hls_${streamId}`);

  if (segmentFile) {
    const filePath = path.join(tmpDir, segmentFile);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'video/mp2t');
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.status(404).send('Segment not found');
    }
  } else if (segmentUrl) {
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

module.exports = router;
