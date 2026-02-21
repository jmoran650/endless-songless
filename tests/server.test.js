const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const PORT_FALLBACK = 0;
const MOCK_AUDIO_BYTES = Buffer.from('FAKE_MP3_BYTES');

let serverProcess;
let baseUrl;
let deezerServer;
let deezerApiBase;
let uniqueCounter = 0;

const mockTrack = {
  id: 111,
  title: 'Mock Track',
  duration: 120,
  link: 'https://deezer.com/track/111',
  preview: '',
  artist: { name: 'Mock Artist' },
  album: { cover_medium: null },
};

function readDatabaseUrlFromEnvFile() {
  try {
    const envFile = fs.readFileSync(path.resolve(__dirname, '..', 'server', '.env'), 'utf8');
    const line = envFile
      .split(/\r?\n/)
      .find((row) => row.trim().startsWith('DATABASE_URL='));

    if (!line) return undefined;
    const [, rawValue = ''] = line.split('=', 2);
    return rawValue.trim().replace(/^"|"$/g, '');
  } catch {
    return undefined;
  }
}

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    readDatabaseUrlFromEnvFile() ||
    'postgresql://localhost:5432/songless?schema=public'
  );
}

async function runDbQuery(text, params = []) {
  const client = new Client({
    connectionString: getDatabaseUrl(),
  });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

function makeUnique(value) {
  uniqueCounter += 1;
  return `${value}_${Date.now()}_${uniqueCounter}`;
}

async function createUser(displayNamePrefix = 'User') {
  const username = makeUnique(displayNamePrefix.toLowerCase());
  const password = `Pass_${makeUnique('pw')}`;
  const displayName = `${displayNamePrefix} ${uniqueCounter}`;

  const register = await request('/api/users/register', {
    method: 'POST',
    body: {
      username,
      password,
      displayName,
    },
  });

  assert.equal(register.status, 201);
  assert.ok(register.payload.token);
  assert.equal(register.payload.user.passwordHash, undefined);

  return {
    username,
    password,
    displayName,
    token: register.payload.token,
    user: register.payload.user,
  };
}

function startMockDeezer() {
  return new Promise((resolve, reject) => {
    deezerServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const trackWithPreview = {
        ...mockTrack,
        preview: `${deezerApiBase}/audio/111.mp3`,
      };

      if (url.pathname === '/playlist/111') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 1,
            title: 'Mock Playlist',
            link: 'https://deezer.com/playlist/test',
            tracks: { data: [trackWithPreview] },
          })
        );
        return;
      }

      if (url.pathname === '/track/111') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(trackWithPreview));
        return;
      }

      if (url.pathname === '/audio/111.mp3') {
        res.statusCode = 200;
        res.setHeader('content-type', 'audio/mpeg');
        res.setHeader('content-length', String(MOCK_AUDIO_BYTES.length));
        res.end(MOCK_AUDIO_BYTES);
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    deezerServer.once('error', reject);
    deezerServer.listen(0, '127.0.0.1', () => {
      const address = deezerServer.address();
      deezerApiBase = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function stopMockDeezer() {
  return new Promise((resolve) => {
    if (!deezerServer) {
      resolve();
      return;
    }

    deezerServer.close(() => {
      deezerServer = undefined;
      resolve();
    });
  });
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT_FALLBACK),
      DATABASE_URL: getDatabaseUrl(),
      DEEZER_PLAYLIST_ID: '111',
      DEEZER_API_BASE_URL: deezerApiBase,
      JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret',
    };

    serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      cwd: path.resolve(__dirname, '..'),
      env,
    });

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        reject(new Error('Server did not start within timeout.'));
        stopBackend();
      }
    }, 4000);

    const onOutput = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/Songless backend running at https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        baseUrl = `http://127.0.0.1:${Number(match[1])}`;
        resolve();
      }
    };

    serverProcess.stdout.on('data', onOutput);
    serverProcess.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    serverProcess.on('exit', (code, signal) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`Backend exited before readiness (code=${code}, signal=${signal}).`));
      }
    });
  });
}

function stopBackend() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
}

async function request(pathname, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  return {
    status: response.status,
    payload,
  };
}

before(async () => {
  await startMockDeezer();
  await startBackend();
});

after(async () => {
  stopBackend();
  await stopMockDeezer();
});

test('health endpoints respond with ok', async () => {
  const rootHealth = await request('/health');
  assert.equal(rootHealth.status, 200);
  assert.equal(rootHealth.payload.ok, true);

  const apiHealth = await request('/api/health');
  assert.equal(apiHealth.status, 200);
  assert.equal(apiHealth.payload.ok, true);
});

test('auth lifecycle keeps passwords private and supports login/session', async () => {
  const user = await createUser('Auth User');

  const login = await request('/api/users/login', {
    method: 'POST',
    body: {
      username: user.username,
      password: user.password,
    },
  });
  assert.equal(login.status, 200);
  assert.ok(login.payload.token);
  assert.equal(login.payload.user.passwordHash, undefined);
  assert.notEqual(login.payload.token, user.token);

  const me = await request('/api/users/me', {
    token: user.token,
  });
  assert.equal(me.status, 200);
  assert.equal(me.payload.username, user.username);
  assert.equal(me.payload.passwordHash, undefined);

  const invalidLogin = await request('/api/users/login', {
    method: 'POST',
    body: {
      username: user.username,
      password: 'wrong-password',
    },
  });
  assert.equal(invalidLogin.status, 401);
});

test('leaderboard read works and write requires auth', async () => {
  const listBefore = await request('/api/leaderboard');
  assert.equal(listBefore.status, 200);
  assert.ok(Array.isArray(listBefore.payload));

  const unauthWrite = await request('/api/leaderboard', {
    method: 'POST',
    body: { mode: 'unlimited', score: 10 },
  });
  assert.equal(unauthWrite.status, 401);

  const user = await createUser('Leaderboard User');
  const write = await request('/api/leaderboard', {
    method: 'POST',
    token: user.token,
    body: { mode: 'unlimited', score: 42 },
  });
  assert.equal(write.status, 201);
  assert.equal(write.payload.score, 42);

  const listAfter = await request('/api/leaderboard');
  assert.equal(listAfter.status, 200);
  assert.ok(listAfter.payload.some((entry) => entry.score === 42));
});

test('rooms endpoints require auth', async () => {
  const createRes = await request('/api/rooms', {
    method: 'POST',
    body: {
      player: { name: 'Anonymous' },
    },
  });
  assert.equal(createRes.status, 401);

  const stateRes = await request('/api/rooms/ABC123/state');
  assert.equal(stateRes.status, 401);
});

test('invalid room codes return 404 for authenticated player', async () => {
  const user = await createUser('Room NotFound User');
  const { status } = await request('/api/rooms/ZZZZZZ/state', {
    token: user.token,
  });
  assert.equal(status, 404);
});

test('audio endpoints proxy Deezer tracks', async () => {
  const next = await request('/api/audio/next?hint=1');
  assert.equal(next.status, 200);
  assert.equal(next.payload.track.id, String(mockTrack.id));
  assert.equal(next.payload.track.title, mockTrack.title);
  assert.equal(typeof next.payload.audioSrc, 'string');

  const streamRes = await fetch(`${baseUrl}${next.payload.audioSrc}`);
  assert.equal(streamRes.status, 200);
  assert.equal(streamRes.headers.get('content-type'), 'audio/mpeg');
  const bytes = Buffer.from(await streamRes.arrayBuffer());
  assert.equal(bytes.toString(), MOCK_AUDIO_BYTES.toString());
});

test('audio search validates query and returns matches', async () => {
  const missingQuery = await request('/api/audio/search');
  assert.equal(missingQuery.status, 400);
  assert.equal(missingQuery.payload.code, 'DEEZER_SEARCH_QUERY_REQUIRED');

  const search = await request('/api/audio/search?q=mock&limit=5');
  assert.equal(search.status, 200);
  assert.equal(search.payload.query, 'mock');
  assert.ok(Array.isArray(search.payload.tracks));
  assert.ok(search.payload.tracks.length >= 1);
  assert.equal(search.payload.tracks[0].id, String(mockTrack.id));
});

test('room lifecycle enforces host auth and blocks spoof attempts', async () => {
  const host = await createUser('Host Player');
  const guest = await createUser('Guest Player');
  const outsider = await createUser('Outsider Player');

  const createRes = await request('/api/rooms', {
    method: 'POST',
    token: host.token,
    body: {
      player: { name: 'Host Alias', avatarKey: 'Host-Avatar_01' },
      mode: 'unlimited',
      difficulty: 'normal',
      genre: 'Any',
      decade: 'Any',
    },
  });
  assert.equal(createRes.status, 201);

  const roomCode = createRes.payload.room.code;
  let roomState = createRes.payload.room;
  assert.equal(roomCode.length, 6);
  assert.equal(createRes.payload.room.hostId, host.user.id);
  assert.equal(createRes.payload.room.players[host.user.id].name, 'Host Alias');
  assert.equal(createRes.payload.room.players[host.user.id].avatarKey, 'host-avatar_01');
  assert.deepEqual(createRes.payload.room.players[host.user.id].guessResults, []);
  assert.equal(createRes.payload.room.players[host.user.id].roundTimeMs, null);
  assert.equal(createRes.payload.room.roundMaxAttempts, 6);
  assert.deepEqual(createRes.payload.room.chat, []);
  assert.equal(typeof createRes.payload.room.version, 'number');

  const joinRes = await request(`/api/rooms/${roomCode}/join`, {
    method: 'POST',
    token: guest.token,
    body: {
      player: { name: 'Guest Alias', avatarKey: 'Guest_Avatar' },
    },
  });
  assert.equal(joinRes.status, 200);
  assert.equal(joinRes.payload.room.players[guest.user.id].name, 'Guest Alias');
  assert.equal(joinRes.payload.room.players[guest.user.id].avatarKey, 'guest_avatar');
  roomState = joinRes.payload.room;

  const sendChat = await request(`/api/rooms/${roomCode}/chat`, {
    method: 'POST',
    token: guest.token,
    body: {
      message: '  Hello\u0000    room   ',
      expectedVersion: roomState.version,
    },
  });
  assert.equal(sendChat.status, 201);
  assert.equal(sendChat.payload.message.message, 'Hello room');
  assert.equal(sendChat.payload.message.playerName, 'Guest Alias');
  assert.equal(sendChat.payload.message.avatarKey, 'guest_avatar');
  roomState = {
    ...roomState,
    version: sendChat.payload.version,
  };

  const listChat = await request(`/api/rooms/${roomCode}/chat?limit=10`, {
    token: host.token,
  });
  assert.equal(listChat.status, 200);
  assert.ok(Array.isArray(listChat.payload.chat));
  assert.equal(listChat.payload.chat.length, 1);
  assert.equal(listChat.payload.chat[0].message, 'Hello room');

  const spoofStart = await request(`/api/rooms/${roomCode}/start`, {
    method: 'POST',
    token: guest.token,
    body: {
      player: {
        id: host.user.id,
        name: 'Forged Host',
      },
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(spoofStart.status, 403);

  const startRes = await request(`/api/rooms/${roomCode}/start`, {
    method: 'POST',
    token: host.token,
    body: {
      player: { name: 'Host Alias' },
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(startRes.status, 200);
  assert.equal(startRes.payload.room.status, 'active');
  assert.equal(typeof startRes.payload.room.roundStartedAt, 'number');
  assert.equal(typeof startRes.payload.room.roundEndsAt, 'number');
  assert.equal(startRes.payload.room.roundEndsAt - startRes.payload.room.roundStartedAt, 120000);
  roomState = startRes.payload.room;
  const initialHint = startRes.payload.room.hintIndex;

  const staleGuess = await request(`/api/rooms/${roomCode}/guess`, {
    method: 'POST',
    token: guest.token,
    body: {
      title: 'wrong-title',
      artist: 'wrong-artist',
      expectedRound: roomState.round,
      expectedVersion: roomState.version - 1,
    },
  });
  assert.equal(staleGuess.status, 409);
  assert.equal(staleGuess.payload.code, 'ROOM_VERSION_CONFLICT');

  const wrongGuess = await request(`/api/rooms/${roomCode}/guess`, {
    method: 'POST',
    token: guest.token,
    body: {
      title: 'wrong-title',
      artist: 'wrong-artist',
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(wrongGuess.status, 200);
  assert.equal(wrongGuess.payload.solved, false);
  assert.equal(wrongGuess.payload.guessResult, 'miss');
  assert.equal(wrongGuess.payload.guessIndex, 0);
  assert.deepEqual(wrongGuess.payload.room.players[guest.user.id].guessResults, ['miss']);
  assert.equal(wrongGuess.payload.room.players[guest.user.id].score, 0);
  roomState = wrongGuess.payload.room;

  const artistOnlyGuess = await request(`/api/rooms/${roomCode}/guess`, {
    method: 'POST',
    token: guest.token,
    body: {
      title: 'wrong-title',
      artist: mockTrack.artist.name,
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(artistOnlyGuess.status, 200);
  assert.equal(artistOnlyGuess.payload.solved, false);
  assert.equal(artistOnlyGuess.payload.guessResult, 'artist');
  assert.equal(artistOnlyGuess.payload.guessIndex, 1);
  assert.deepEqual(artistOnlyGuess.payload.room.players[guest.user.id].guessResults, ['miss', 'artist']);
  roomState = artistOnlyGuess.payload.room;

  const correctGuess = await request(`/api/rooms/${roomCode}/guess`, {
    method: 'POST',
    token: guest.token,
    body: {
      title: mockTrack.title,
      artist: mockTrack.artist.name,
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(correctGuess.status, 200);
  assert.equal(correctGuess.payload.solved, true);
  assert.equal(correctGuess.payload.guessResult, 'solved');
  assert.equal(correctGuess.payload.guessIndex, 2);
  assert.equal(correctGuess.payload.room.players[guest.user.id].solved, true);
  assert.equal(correctGuess.payload.room.players[guest.user.id].score, 1);
  assert.deepEqual(correctGuess.payload.room.players[guest.user.id].guessResults, ['miss', 'artist', 'solved']);
  assert.equal(typeof correctGuess.payload.room.players[guest.user.id].roundTimeMs, 'number');
  roomState = correctGuess.payload.room;

  const repeatedCorrectGuess = await request(`/api/rooms/${roomCode}/guess`, {
    method: 'POST',
    token: guest.token,
    body: {
      title: mockTrack.title,
      artist: mockTrack.artist.name,
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(repeatedCorrectGuess.status, 200);
  assert.equal(repeatedCorrectGuess.payload.solved, true);
  assert.equal(repeatedCorrectGuess.payload.guessResult, 'solved');
  assert.equal(repeatedCorrectGuess.payload.room.players[guest.user.id].score, 1);
  roomState = repeatedCorrectGuess.payload.room;

  const guestSkip = await request(`/api/rooms/${roomCode}/skip`, {
    method: 'POST',
    token: guest.token,
    body: {
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(guestSkip.status, 403);

  const hostSkip = await request(`/api/rooms/${roomCode}/skip`, {
    method: 'POST',
    token: host.token,
    body: {
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(hostSkip.status, 200);
  assert.equal(hostSkip.payload.room.hintIndex, initialHint + 1);
  assert.deepEqual(hostSkip.payload.room.players[host.user.id].guessResults, ['skip']);
  assert.deepEqual(hostSkip.payload.room.players[guest.user.id].guessResults, ['miss', 'artist', 'solved']);
  roomState = hostSkip.payload.room;

  const outsiderState = await request(`/api/rooms/${roomCode}/state`, {
    token: outsider.token,
  });
  assert.equal(outsiderState.status, 403);

  const leaveGuest = await request(`/api/rooms/${roomCode}/leave`, {
    method: 'POST',
    token: guest.token,
  });
  assert.equal(leaveGuest.status, 200);

  const guestState = await request(`/api/rooms/${roomCode}/state`, {
    token: guest.token,
  });
  assert.equal(guestState.status, 403);

  const hostState = await request(`/api/rooms/${roomCode}/state`, {
    token: host.token,
  });
  assert.equal(hostState.status, 200);
  assert.equal(hostState.payload.room.players[guest.user.id], undefined);
  assert.equal(hostState.payload.room.chat.length, 1);
});

test('room state auto-advances when round timer expires', async () => {
  const host = await createUser('Timer Host');
  const guest = await createUser('Timer Guest');

  const createRes = await request('/api/rooms', {
    method: 'POST',
    token: host.token,
    body: {
      player: { name: 'Timer Host' },
    },
  });
  assert.equal(createRes.status, 201);
  const roomCode = createRes.payload.room.code;

  const joinRes = await request(`/api/rooms/${roomCode}/join`, {
    method: 'POST',
    token: guest.token,
    body: {
      player: { name: 'Timer Guest' },
    },
  });
  assert.equal(joinRes.status, 200);

  const startRes = await request(`/api/rooms/${roomCode}/start`, {
    method: 'POST',
    token: host.token,
    body: {
      expectedRound: joinRes.payload.room.round,
      expectedVersion: joinRes.payload.room.version,
    },
  });
  assert.equal(startRes.status, 200);
  const roundBeforeExpiry = startRes.payload.room.round;
  let roomState = startRes.payload.room;

  const solvedRes = await request(`/api/rooms/${roomCode}/guess`, {
    method: 'POST',
    token: guest.token,
    body: {
      title: mockTrack.title,
      artist: mockTrack.artist.name,
      expectedRound: roomState.round,
      expectedVersion: roomState.version,
    },
  });
  assert.equal(solvedRes.status, 200);
  assert.equal(solvedRes.payload.solved, true);
  roomState = solvedRes.payload.room;

  await runDbQuery(
    `
      update public.game_rooms
      set round_started_at_ms = $2
      where code = $1
    `,
    [roomCode, Date.now() - 120_001]
  );

  const stateRes = await request(`/api/rooms/${roomCode}/state`, {
    token: guest.token,
  });
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.payload.room.round, roundBeforeExpiry + 1);
  assert.equal(stateRes.payload.room.players[guest.user.id].solved, false);
  assert.deepEqual(stateRes.payload.room.players[guest.user.id].guessResults, []);
  assert.equal(stateRes.payload.room.players[guest.user.id].roundTimeMs, null);
  assert.equal(stateRes.payload.room.roundEndsAt - stateRes.payload.room.roundStartedAt, 120000);
});

test('room chat and avatar inputs are validated', async () => {
  const user = await createUser('Validation User');

  const invalidCreate = await request('/api/rooms', {
    method: 'POST',
    token: user.token,
    body: {
      player: {
        name: 'Validator',
        avatarKey: { value: 'bad' },
      },
    },
  });
  assert.equal(invalidCreate.status, 400);

  const createRes = await request('/api/rooms', {
    method: 'POST',
    token: user.token,
    body: {
      player: { name: 'Validator', avatarKey: '  Valid_Avatar  ' },
    },
  });
  assert.equal(createRes.status, 201);
  const roomCode = createRes.payload.room.code;

  const blankMessage = await request(`/api/rooms/${roomCode}/chat`, {
    method: 'POST',
    token: user.token,
    body: { message: '     ' },
  });
  assert.equal(blankMessage.status, 400);

  const longMessage = await request(`/api/rooms/${roomCode}/chat`, {
    method: 'POST',
    token: user.token,
    body: { message: 'x'.repeat(281) },
  });
  assert.equal(longMessage.status, 400);
});

test('last player leaves removes room', async () => {
  const host = await createUser('Lone Host');

  const createRes = await request('/api/rooms', {
    method: 'POST',
    token: host.token,
    body: {
      player: { name: 'Solo Host' },
    },
  });
  assert.equal(createRes.status, 201);
  const roomCode = createRes.payload.room.code;

  const leaveRes = await request(`/api/rooms/${roomCode}/leave`, {
    method: 'POST',
    token: host.token,
  });
  assert.equal(leaveRes.status, 200);
  assert.equal(leaveRes.payload.room, null);

  const stateRes = await request(`/api/rooms/${roomCode}/state`, {
    token: host.token,
  });
  assert.equal(stateRes.status, 404);
});
