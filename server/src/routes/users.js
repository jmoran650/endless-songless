const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { isUniqueViolation, withDbSession } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError, logInfo } = require('../lib/observability');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'songless_super_secret_fallback';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
const INSERT_USER_SQL = `
  insert into public.users (
    username,
    password_hash,
    display_name,
    friend_code
  )
  values ($1, $2, $3, $4)
  returning
    id,
    username,
    display_name as "displayName",
    friend_code as "friendCode",
    created_at as "createdAt",
    updated_at as "updatedAt"
`;
const INSERT_SESSION_SQL = `
  insert into public.auth_sessions (
    user_id,
    token,
    expires_at
  )
  values ($1, $2, $3)
`;
const USER_BY_USERNAME_SQL = `
  select
    id,
    username,
    password_hash as "passwordHash",
    display_name as "displayName",
    to_jsonb(u)->>'avatar_key' as "avatarKey",
    friend_code as "friendCode",
    created_at as "createdAt",
    updated_at as "updatedAt"
  from public.users u
  where username = $1
  limit 1
`;
const DELETE_EXPIRED_SESSIONS_SQL = `
  delete from public.auth_sessions
  where user_id = $1
    and expires_at < timezone('utc', now())
`;

async function getUserByUsername(client, username) {
  const userResult = await client.query(USER_BY_USERNAME_SQL, [username]);
  if (userResult.rowCount === 0) {
    return null;
  }
  return userResult.rows[0];
}

function toPublicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarKey: user.avatarKey || null,
    friendCode: user.friendCode,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

router.post('/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const response = await withDbSession(
      {
        requestId: req.requestId,
        backend: true,
      },
      async (client) => {
        let user = null;
        let attempt = 0;

        while (attempt < 8) {
          attempt += 1;
          const friendCode = crypto.randomBytes(4).toString('hex').toUpperCase();
          const salt = crypto.randomBytes(16).toString('hex');
          const hashedPassword = hashPassword(password, salt);
          const passwordHash = `${salt}:${hashedPassword}`;

          try {
            const insertResult = await client.query(INSERT_USER_SQL, [
              username,
              passwordHash,
              displayName,
              friendCode,
            ]);
            user = insertResult.rows[0];
            break;
          } catch (error) {
            if (isUniqueViolation(error, 'users_friend_code_key')) {
              continue;
            }
            throw error;
          }
        }

        if (!user) {
          throw new Error('Unable to allocate a unique friend code.');
        }

        const token = jwt.sign(
          { userId: user.id },
          JWT_SECRET,
          { expiresIn: '7d', jwtid: crypto.randomUUID() }
        );
        await client.query(INSERT_SESSION_SQL, [
          user.id,
          token,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ]);
        await client.query(DELETE_EXPIRED_SESSIONS_SQL, [user.id]);

        return { user: toPublicUser(user), token };
      }
    );

    logInfo('auth.register.success', {
      requestId: req.requestId,
      userId: response.user.id,
    });
    res.status(201).json(response);
  } catch (error) {
    if (isUniqueViolation(error, 'users_username_key')) {
      logInfo('auth.register.username_taken', {
        requestId: req.requestId,
        username,
      });
      return res.status(400).json({ error: 'Username taken' });
    }
    logError('auth.register.failure', error, {
      requestId: req.requestId,
      username,
    });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const response = await withDbSession(
      {
        requestId: req.requestId,
        backend: true,
      },
      async (client) => {
        const user = await getUserByUsername(client, username);
        if (!user) {
          return null;
        }

        const [salt, storedHash] = String(user.passwordHash || '').split(':');
        if (!salt || !storedHash) {
          return null;
        }

        const loginHash = hashPassword(password, salt);
        if (loginHash !== storedHash) {
          return null;
        }

        const token = jwt.sign(
          { userId: user.id },
          JWT_SECRET,
          { expiresIn: '7d', jwtid: crypto.randomUUID() }
        );
        await client.query(INSERT_SESSION_SQL, [
          user.id,
          token,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ]);
        await client.query(DELETE_EXPIRED_SESSIONS_SQL, [user.id]);

        return { user: toPublicUser(user), token };
      }
    );

    if (!response) {
      logInfo('auth.login.invalid_credentials', {
        requestId: req.requestId,
        username,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    logInfo('auth.login.success', {
      requestId: req.requestId,
      userId: response.user.id,
    });
    res.json(response);
  } catch (err) {
    logError('auth.login.failure', err, {
      requestId: req.requestId,
      username,
    });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(toPublicUser(req.user));
});

module.exports = router;
