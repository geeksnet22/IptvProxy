/** @format */

const express = require('express');
const axios = require('axios');
const { buildHeaders } = require('../utils/headers');
const { generateM3UFromStalker } = require('../utils/helpers');

const router = express.Router();

// 📺 Get all channels
router.get('/get_all_channels', async (req, res) => {
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

module.exports = router;
