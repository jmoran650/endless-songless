function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return '';
  }
}

function parseOriginList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function resolveAllowedOrigins(env = process.env) {
  const configuredOrigins = unique([
    ...parseOriginList(env.CORS_ORIGIN),
    ...parseOriginList(env.CLIENT_URL),
  ]);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  return [];
}

function resolveRequestOrigin(req) {
  if (!req || !req.headers) {
    return '';
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const host = forwardedHost || String(req.headers.host || '').trim();

  if (!host) {
    return '';
  }

  const protocol = forwardedProto || 'http';
  return normalizeOrigin(`${protocol}://${host}`);
}

function isOriginAllowed(origin, allowedOrigins = [], req = null) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  const requestOrigin = resolveRequestOrigin(req);
  if (requestOrigin && requestOrigin === normalizedOrigin) {
    return true;
  }

  return false;
}

function describeAllowedOrigins(allowedOrigins = []) {
  if (allowedOrigins.length === 0) {
    return 'same-origin only';
  }
  return allowedOrigins.join(', ');
}

module.exports = {
  describeAllowedOrigins,
  isOriginAllowed,
  resolveAllowedOrigins,
};
