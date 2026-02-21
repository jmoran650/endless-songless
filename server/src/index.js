const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const {
  describeAllowedOrigins,
  isOriginAllowed,
  resolveAllowedOrigins,
} = require('./lib/origins');

const app = express();
const PORT = process.env.PORT || 8080;
const allowedOrigins = resolveAllowedOrigins();
const shouldServeClient = process.env.SERVE_CLIENT !== 'false';

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', true);
}

console.log(`CORS policy: ${describeAllowedOrigins(allowedOrigins)}`);

app.use(
  cors((req, callback) => {
    callback(null, {
      origin(origin, done) {
        done(null, isOriginAllowed(origin, allowedOrigins, req));
      },
      credentials: true,
    });
  })
);
app.use(express.json());
app.use((req, res, next) => {
  const incomingId = req.headers['x-request-id'];
  req.requestId =
    typeof incomingId === 'string' && incomingId.trim() ? incomingId.trim() : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const userRoutes = require('./routes/users');
const leaderboardRoutes = require('./routes/leaderboard');
const audioRoutes = require('./routes/audio');
const roomRoutes = require('./routes/rooms');
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/rooms', roomRoutes);

const clientDistPath = path.resolve(__dirname, '../../client/dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');
const clientBundleExists = fs.existsSync(clientIndexPath);

if (shouldServeClient && clientBundleExists) {
  app.use(express.static(clientDistPath));
  app.get(/^(?!\/api(?:\/|$)|\/socket\.io(?:\/|$)|\/health$).*/, (req, res) => {
    res.sendFile(clientIndexPath);
  });
  console.log(`Serving client bundle from ${clientDistPath}`);
} else if (shouldServeClient) {
  console.warn(`Client bundle missing at ${clientIndexPath}. Run "npm run build" before starting.`);
}

const { initSocket } = require('./socket');
let server;
server = app.listen(PORT, () => {
  const resolvedPort = server.address()?.port || PORT;
  console.log(`Songless backend running at http://localhost:${resolvedPort}`);
});

const socketsEnabled = process.env.ENABLE_SOCKETS !== 'false';
if (socketsEnabled) {
  initSocket(server).catch((error) => {
    console.error('Failed to initialize realtime socket server:', error);
  });
} else {
  console.log('Realtime socket server disabled. Set ENABLE_SOCKETS=false to keep it disabled.');
}

module.exports = { app, server };
