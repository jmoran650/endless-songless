const express = require('express');
const { withDbSession } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError, logInfo } = require('../lib/observability');

const router = express.Router();
const LIST_LEADERBOARD_SQL = `
  select
    s.id,
    s.user_id as "userId",
    s.mode,
    s.score,
    s.date,
    json_build_object('displayName', u.display_name) as user
  from public.score_entries s
  join public.users u on u.id = s.user_id
  order by s.score desc
  limit 50
`;
const INSERT_LEADERBOARD_SQL = `
  insert into public.score_entries (
    user_id,
    mode,
    score
  )
  values ($1, $2, $3)
  returning
    id,
    user_id as "userId",
    mode,
    score,
    date
`;

router.get('/', async (req, res) => {
  try {
    const scoresResult = await withDbSession(
      {
        requestId: req.requestId,
        backend: true,
      },
      (client) => client.query(LIST_LEADERBOARD_SQL)
    );

    logInfo('leaderboard.list.success', {
      requestId: req.requestId,
      count: scoresResult.rowCount,
    });
    res.json(scoresResult.rows);
  } catch (err) {
    logError('leaderboard.list.failure', err, {
      requestId: req.requestId,
    });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { mode, score } = req.body;
  const userId = req.user.id;

  if (score === undefined) {
    return res.status(400).json({ error: 'Missing logic fields' });
  }

  try {
    const parsedScore = parseInt(score, 10);
    if (!Number.isFinite(parsedScore)) {
      return res.status(400).json({ error: 'Missing logic fields' });
    }

    const entryResult = await withDbSession(
      {
        userId,
        requestId: req.requestId,
      },
      (client) => client.query(INSERT_LEADERBOARD_SQL, [userId, mode || 'unlimited', parsedScore])
    );

    logInfo('leaderboard.write.success', {
      requestId: req.requestId,
      userId,
      score: parsedScore,
    });
    res.status(201).json(entryResult.rows[0]);
  } catch (err) {
    logError('leaderboard.write.failure', err, {
      requestId: req.requestId,
      userId,
    });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
