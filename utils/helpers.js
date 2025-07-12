/** @format */

const crypto = require('crypto');

// --- ffmpeg process tracking ---
let activeStreams = 0;

// Generate unique stream ID
function getStreamId(url, token) {
  return crypto
    .createHash('md5')
    .update(url + (token || ''))
    .digest('hex');
}

// Increment active streams counter
function incrementActiveStreams() {
  activeStreams++;
  return activeStreams;
}

// Decrement active streams counter
function decrementActiveStreams() {
  activeStreams--;
  return activeStreams;
}

// Get current active streams count
function getActiveStreamsCount() {
  return activeStreams;
}

// Generate M3U playlist from Stalker data
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

module.exports = {
  getStreamId,
  generateM3UFromStalker,
  incrementActiveStreams,
  decrementActiveStreams,
  getActiveStreamsCount,
};
