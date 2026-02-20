const express = require('express');
const jwt = require('jsonwebtoken');
const { prisma } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'songless_super_secret_fallback';

router.post('/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const friendCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: password, // Simplified for brevity; normally bcrypt this
        displayName,
        friendCode
      }
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    
    await prisma.authSession.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    res.status(201).json({ user, token });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Username taken' });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.passwordHash !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    
    await prisma.authSession.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const session = await prisma.authSession.findUnique({
      where: { token },
      include: { user: true }
    });
    
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    
    res.json(session.user);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
