/** @format */

// iptv_proxy_server.js
const express = require('express');

// Import route modules
const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const streamingRoutes = require('./routes/streaming');

// Import utilities (this initializes cleanup)
require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('✅ IPTV Proxy is running');
});

// Use route modules
app.use('/', authRoutes);
app.use('/', channelRoutes);
app.use('/', streamingRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔌 IPTV Proxy running at http://0.0.0.0:${PORT}`);
});
