/** @format */

const fs = require('fs');
const path = require('path');

// --- CONFIGURABLE ---
const TMP_ROOT = '/tmp';
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 min
const STREAM_TTL = 10 * 60 * 1000; // 10 min
const MAX_CONCURRENT_STREAMS = 10;

// --- Ensure temp root exists ---
if (!fs.existsSync(TMP_ROOT)) fs.mkdirSync(TMP_ROOT, { recursive: true });

// Clean up old streams
function cleanupOldStreams() {
  fs.readdirSync(TMP_ROOT)
    .filter((d) => d.startsWith('hls_'))
    .forEach((dir) => {
      const dirPath = path.join(TMP_ROOT, dir);
      try {
        const stat = fs.statSync(dirPath);
        if (Date.now() - stat.mtimeMs > STREAM_TTL) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      } catch {}
    });
}

// Start cleanup interval
setInterval(cleanupOldStreams, CLEANUP_INTERVAL);

module.exports = {
  TMP_ROOT,
  CLEANUP_INTERVAL,
  STREAM_TTL,
  MAX_CONCURRENT_STREAMS,
  cleanupOldStreams,
};
