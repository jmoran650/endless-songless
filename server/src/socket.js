const crypto = require('crypto');
const { Server } = require('socket.io');
const { withDbSession } = require('./db');
const { authenticateToken, extractBearerToken } = require('./middleware/auth');
const { logError, logInfo } = require('./lib/observability');
const {
  describeAllowedOrigins,
  isOriginAllowed,
  resolveAllowedOrigins,
} = require('./lib/origins');

const ROUND_DURATION_MS = 120_000;
const ROUND_MAX_ATTEMPTS = 6;
const SOCKET_CHAT_LIMIT = 50;
const ROUND_RESULT_SET = new Set(['miss', 'artist', 'solved', 'skip']);

const ROOM_BY_CODE_SQL = `
  select
    code,
    host_id as "hostId",
    status,
    round,
    hint_index as "hintIndex",
    settings,
    created_at as "createdAt",
    current_song_id as "currentSongId",
    current_song as "currentSong",
    round_started_at_ms as "roundStartedAt",
    state_version as "version"
  from public.game_rooms
  where code = $1
  limit 1
`;

const ROOM_MEMBERSHIP_SQL = `
  select 1
  from public.game_room_players
  where room_code = $1
    and player_id = $2
  limit 1
`;

const ROOM_PLAYERS_SQL = `
  select
    player_id as id,
    name,
    avatar_key as "avatarKey",
    score,
    solved,
    round_progress as "roundProgress",
    solved_at_ms as "solvedAtMs"
  from public.game_room_players
  where room_code = $1
  order by joined_at asc, player_id asc
`;

const ROOM_CHAT_SQL = `
  select
    id,
    sender_id as "senderId",
    sender_name as "senderName",
    sender_avatar_key as "senderAvatarKey",
    message,
    created_at as "createdAt"
  from public.game_room_chat_messages
  where room_code = $1
  order by created_at desc, id desc
  limit $2
`;

let ioInstance = null;

const roomPresence = new Map();

function normalizeRoomCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function roomChannel(code) {
  return `room:${code}`;
}

function toEpochMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function getRoundEndsAtMs(roundStartedAt) {
  if (!Number.isFinite(roundStartedAt)) {
    return null;
  }
  return roundStartedAt + ROUND_DURATION_MS;
}

function mapChatRows(chatRows) {
  return [...chatRows].reverse().map((chatRow) => ({
    id: String(chatRow.id),
    playerId: chatRow.senderId,
    playerName: chatRow.senderName,
    avatarKey: chatRow.senderAvatarKey || null,
    message: chatRow.message,
    createdAt: chatRow.createdAt,
  }));
}

function parseRoundProgress(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || '').toLowerCase())
    .filter((entry) => ROUND_RESULT_SET.has(entry))
    .slice(0, ROUND_MAX_ATTEMPTS);
}

function buildRoomPayload(roomRow, playerRows, chatRows) {
  const roundStartedAt = toEpochMs(roomRow.roundStartedAt);
  const players = {};
  for (const playerRow of playerRows) {
    const guessResults = parseRoundProgress(playerRow.roundProgress);
    const solvedAtMs = toEpochMs(playerRow.solvedAtMs);
    const roundTimeMs =
      Number.isFinite(roundStartedAt) && Number.isFinite(solvedAtMs)
        ? Math.max(solvedAtMs - roundStartedAt, 0)
        : null;

    players[playerRow.id] = {
      id: playerRow.id,
      name: playerRow.name,
      avatarKey: playerRow.avatarKey || null,
      score: playerRow.score,
      solved: playerRow.solved,
      guessResults,
      roundTimeMs,
    };
  }

  return {
    code: roomRow.code,
    hostId: roomRow.hostId,
    players,
    status: roomRow.status,
    round: roomRow.round,
    hintIndex: roomRow.hintIndex,
    settings: roomRow.settings || {},
    createdAt: roomRow.createdAt,
    currentSongId: roomRow.currentSongId,
    currentSong: roomRow.currentSong,
    roundStartedAt,
    roundEndsAt: getRoundEndsAtMs(roundStartedAt),
    roundMaxAttempts: ROUND_MAX_ATTEMPTS,
    version: Number(roomRow.version || 0),
    chat: mapChatRows(chatRows),
  };
}

function addPresence(code, playerId) {
  if (!roomPresence.has(code)) {
    roomPresence.set(code, new Map());
  }
  const roomMap = roomPresence.get(code);
  roomMap.set(playerId, (roomMap.get(playerId) || 0) + 1);

  return [...roomMap.entries()]
    .filter(([, count]) => count > 0)
    .map(([id]) => id)
    .sort();
}

function removePresence(code, playerId) {
  if (!roomPresence.has(code)) {
    return [];
  }

  const roomMap = roomPresence.get(code);
  const current = roomMap.get(playerId) || 0;
  if (current <= 1) {
    roomMap.delete(playerId);
  } else {
    roomMap.set(playerId, current - 1);
  }

  if (roomMap.size === 0) {
    roomPresence.delete(code);
    return [];
  }

  return [...roomMap.entries()]
    .filter(([, count]) => count > 0)
    .map(([id]) => id)
    .sort();
}

function emitPresence(code, payload) {
  if (!ioInstance) {
    return;
  }
  ioInstance.to(roomChannel(code)).emit('room:presence', {
    code,
    ...payload,
    ts: Date.now(),
  });
}

function emitToRoom(code, event, payload) {
  if (!ioInstance) {
    return;
  }
  ioInstance.to(roomChannel(code)).emit(event, payload);
}

async function fetchRoomStateForPlayer({ code, userId, requestId }) {
  return withDbSession(
    {
      userId,
      requestId,
      backend: true,
    },
    async (client) => {
      const roomResult = await client.query(ROOM_BY_CODE_SQL, [code]);
      if (roomResult.rowCount === 0) {
        return { notFound: true };
      }

      const membershipResult = await client.query(ROOM_MEMBERSHIP_SQL, [code, userId]);
      if (membershipResult.rowCount === 0) {
        return { forbidden: true };
      }

      const [playersResult, chatResult] = await Promise.all([
        client.query(ROOM_PLAYERS_SQL, [code]),
        client.query(ROOM_CHAT_SQL, [code, SOCKET_CHAT_LIMIT]),
      ]);

      return {
        room: buildRoomPayload(roomResult.rows[0], playersResult.rows, chatResult.rows),
      };
    }
  );
}

function publishRoomState(room, meta = {}) {
  if (!room || !room.code) {
    return;
  }
  emitToRoom(room.code, 'room:update', {
    room,
    version: Number(room.version || 0),
    meta,
    ts: Date.now(),
  });
}

function publishRoomDeleted(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) {
    return;
  }

  roomPresence.delete(normalizedCode);
  emitToRoom(normalizedCode, 'room:closed', {
    code: normalizedCode,
    ts: Date.now(),
  });
}

function publishRoomChat(code, message, meta = {}) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode || !message) {
    return;
  }

  emitToRoom(normalizedCode, 'room:chat', {
    code: normalizedCode,
    message,
    meta,
    ts: Date.now(),
  });
}

async function initSocket(server) {
  if (ioInstance) {
    return ioInstance;
  }

  const allowedOrigins = resolveAllowedOrigins();

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    },
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      callback(null, isOriginAllowed(origin, allowedOrigins, req));
    },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  io.use(async (socket, next) => {
    const authToken =
      (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token.trim()) ||
      extractBearerToken(socket.handshake.headers?.authorization);

    const requestId = crypto.randomUUID();
    const context = await authenticateToken(authToken, { requestId });
    if (!context) {
      return next(new Error('Unauthorized'));
    }

    socket.data.requestId = requestId;
    socket.data.user = context.user;
    socket.data.session = context.session;
    return next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    logInfo('realtime.socket.connected', {
      requestId: socket.data.requestId,
      userId: user.id,
      socketId: socket.id,
    });

    socket.on('room:join', async (payload = {}) => {
      const input = payload && typeof payload === 'object' ? payload : {};
      const requestId = crypto.randomUUID();
      const code = normalizeRoomCode(input.code);
      if (!code) {
        socket.emit('room:error', {
          code: 'ROOM_CODE_REQUIRED',
          error: 'Room code is required.',
        });
        return;
      }

      try {
        const previousCode = normalizeRoomCode(socket.data.roomCode);
        if (previousCode && previousCode !== code) {
          socket.leave(roomChannel(previousCode));
          const onlinePlayerIds = removePresence(previousCode, user.id);
          emitPresence(previousCode, {
            playerId: user.id,
            isOnline: false,
            onlinePlayerIds,
          });
        }

        const stateResult = await fetchRoomStateForPlayer({
          code,
          userId: user.id,
          requestId,
        });

        if (stateResult.notFound) {
          socket.emit('room:error', {
            code: 'ROOM_NOT_FOUND',
            error: 'Room not found.',
          });
          return;
        }

        if (stateResult.forbidden) {
          socket.emit('room:error', {
            code: 'ROOM_FORBIDDEN',
            error: 'Player is not in room.',
          });
          return;
        }

        socket.join(roomChannel(code));
        socket.data.roomCode = code;

        const onlinePlayerIds = addPresence(code, user.id);
        emitPresence(code, {
          playerId: user.id,
          isOnline: true,
          onlinePlayerIds,
        });

        const room = stateResult.room;
        const clientVersion = Number(input.lastVersion);
        const serverVersion = Number(room.version || 0);

        if (!Number.isFinite(clientVersion) || clientVersion !== serverVersion) {
          socket.emit('room:sync', {
            room,
            version: serverVersion,
            reason: 'join',
            ts: Date.now(),
          });
          return;
        }

        socket.emit('room:joined', {
          code,
          version: serverVersion,
          ts: Date.now(),
        });
      } catch (error) {
        logError('realtime.room_join.failure', error, {
          requestId,
          roomCode: code,
          userId: user.id,
        });
        socket.emit('room:error', {
          code: 'ROOM_JOIN_FAILED',
          error: 'Failed to join room channel.',
        });
      }
    });

    socket.on('room:request-sync', async (payload = {}) => {
      const input = payload && typeof payload === 'object' ? payload : {};
      const requestId = crypto.randomUUID();
      const code = normalizeRoomCode(input.code || socket.data.roomCode);
      if (!code) {
        return;
      }

      try {
        const stateResult = await fetchRoomStateForPlayer({
          code,
          userId: user.id,
          requestId,
        });

        if (stateResult.notFound || stateResult.forbidden) {
          socket.emit('room:error', {
            code: 'ROOM_SYNC_FORBIDDEN',
            error: 'Unable to sync this room.',
          });
          return;
        }

        const room = stateResult.room;
        const clientVersion = Number(input.lastVersion);
        const serverVersion = Number(room.version || 0);

        if (input.force === true || !Number.isFinite(clientVersion) || clientVersion !== serverVersion) {
          socket.emit('room:sync', {
            room,
            version: serverVersion,
            reason: input.force ? 'forced' : 'version_mismatch',
            ts: Date.now(),
          });
          return;
        }

        socket.emit('room:sync-ok', {
          code,
          version: serverVersion,
          ts: Date.now(),
        });
      } catch (error) {
        logError('realtime.room_sync.failure', error, {
          requestId,
          roomCode: code,
          userId: user.id,
        });
        socket.emit('room:error', {
          code: 'ROOM_SYNC_FAILED',
          error: 'Failed to sync room.',
        });
      }
    });

    socket.on('room:leave', () => {
      const code = normalizeRoomCode(socket.data.roomCode);
      if (!code) {
        return;
      }

      socket.leave(roomChannel(code));
      socket.data.roomCode = '';

      const onlinePlayerIds = removePresence(code, user.id);
      emitPresence(code, {
        playerId: user.id,
        isOnline: false,
        onlinePlayerIds,
      });
    });

    socket.on('disconnect', () => {
      const code = normalizeRoomCode(socket.data.roomCode);
      if (code) {
        const onlinePlayerIds = removePresence(code, user.id);
        emitPresence(code, {
          playerId: user.id,
          isOnline: false,
          onlinePlayerIds,
        });
      }

      logInfo('realtime.socket.disconnected', {
        requestId: socket.data.requestId,
        userId: user.id,
        socketId: socket.id,
      });
    });
  });

  ioInstance = io;
  logInfo('realtime.socket.initialized', {
    mode: 'db_backed',
    allowedOrigins: describeAllowedOrigins(allowedOrigins),
  });

  return ioInstance;
}

module.exports = {
  initSocket,
  publishRoomState,
  publishRoomDeleted,
  publishRoomChat,
};
