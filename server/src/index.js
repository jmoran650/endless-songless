require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const userRoutes = require('./routes/users');
const leaderboardRoutes = require('./routes/leaderboard');
const audioRoutes = require('./routes/audio');
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/audio', audioRoutes);

const { initSocket } = require('./socket');
const server = app.listen(PORT, () => {
  console.log(`Endless Songless API running at http://localhost:${PORT}`);
});

initSocket(server);

module.exports = { app, server };
