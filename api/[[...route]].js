const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const {
  describeAllowedOrigins,
  isOriginAllowed,
  resolveAllowedOrigins,
} = require('../server/src/lib/origins');

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

const app = express();
const allowedOrigins = resolveAllowedOrigins();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', true);
}

console.log(`Vercel API CORS policy: ${describeAllowedOrigins(allowedOrigins)}`);

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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const userRoutes = require('../server/src/routes/users');
const leaderboardRoutes = require('../server/src/routes/leaderboard');
const audioRoutes = require('../server/src/routes/audio');
const roomRoutes = require('../server/src/routes/rooms');

app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/rooms', roomRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;
