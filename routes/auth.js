/** @format */

const express = require('express');
const axios = require('axios');
const { buildHeaders } = require('../utils/headers');

const router = express.Router();

// 🔐 Handshake endpoint
router.get('/handshake', async (req, res) => {
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

module.exports = router;
