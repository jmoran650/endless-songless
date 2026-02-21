const jwt = require('jsonwebtoken');
const { withDbSession } = require('../db');
const { logError } = require('../lib/observability');

const JWT_SECRET = process.env.JWT_SECRET || 'songless_super_secret_fallback';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
const SESSION_BY_TOKEN_SQL = `
  select
    s.id as "sessionId",
    s.user_id as "sessionUserId",
    s.expires_at as "expiresAt",
    u.id,
    u.username,
    u.display_name as "displayName",
    to_jsonb(u)->>'avatar_key' as "avatarKey",
    u.friend_code as "friendCode",
    u.created_at as "createdAt",
    u.updated_at as "updatedAt"
  from public.auth_sessions s
  join public.users u on u.id = s.user_id
  where s.token = $1
    and s.revoked_at is null
  limit 1
`;

function toSessionContext(payload) {
  return {
    user: {
      id: payload.id,
      username: payload.username,
      displayName: payload.displayName,
      avatarKey: payload.avatarKey || null,
      friendCode: payload.friendCode,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    },
    session: {
      id: payload.sessionId,
      userId: payload.sessionUserId,
      expiresAt: payload.expiresAt,
    },
  };
}

function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return '';
  }
  if (!headerValue.startsWith('Bearer ')) {
    return '';
  }
  return headerValue.split(' ')[1] || '';
}

async function authenticateToken(token, options = {}) {
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (!normalizedToken) {
    return null;
  }

  try {
    const decoded = jwt.verify(normalizedToken, JWT_SECRET);

    const payload = await withDbSession(
      {
        userId: decoded.userId,
        requestId: options.requestId,
      },
      async (client) => {
        const sessionResult = await client.query(SESSION_BY_TOKEN_SQL, [normalizedToken]);
        if (sessionResult.rowCount === 0) {
          return null;
        }

        const session = sessionResult.rows[0];
        if (session.expiresAt < new Date()) {
          await client.query(
            `
              update public.auth_sessions
              set revoked_at = timezone('utc', now())
              where id = $1
                and revoked_at is null
            `,
            [session.sessionId]
          );
          return { expired: true };
        }

        return session;
      }
    );

    if (!payload || payload.expired) {
      return null;
    }

    if (payload.sessionUserId !== decoded.userId) {
      return null;
    }

    return toSessionContext(payload);
  } catch (err) {
    if (err?.name !== 'JsonWebTokenError' && err?.name !== 'TokenExpiredError') {
      logError('auth.require_auth.failure', err, {
        requestId: options.requestId,
      });
    }
    return null;
  }
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const context = await authenticateToken(token, {
    requestId: req.requestId,
  });
  if (!context) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = context.user;
  req.session = context.session;
  return next();
}

module.exports = {
  requireAuth,
  authenticateToken,
  extractBearerToken,
};
