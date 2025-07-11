/** @format */

// iptv_proxy_server.js
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3001;

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
  const { portal, mac, token } = req.query;
  if (!portal || !mac || !token)
    return res.status(400).json({ error: 'Missing portal, mac, or token' });

  const baseUrl = `${portal.replace(/\/$/, '')}/portal.php`;
  const headers = buildHeaders(mac, `${portal}/c/`, token);
  const url = `${baseUrl}?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;

  try {
    const response = await axios.get(url, { headers });
    res.json(response.data);
  } catch (err) {
    console.error('❌ Channel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

app.listen(PORT, () =>
  console.log(`🔌 IPTV Proxy running at http://localhost:${PORT}`)
);
