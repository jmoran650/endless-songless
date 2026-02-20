const express = require('express');
const { prisma } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const scores = await prisma.scoreEntry.findMany({
      orderBy: { score: 'desc' },
      take: 50,
      include: {
        user: { select: { displayName: true } }
      }
    });
    res.json(scores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  const { userId, mode, score } = req.body;
  if (!userId || score === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const entry = await prisma.scoreEntry.create({
      data: {
        userId,
        mode: mode || 'unlimited',
        score: parseInt(score, 10)
      }
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
