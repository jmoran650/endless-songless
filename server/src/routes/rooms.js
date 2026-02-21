const express = require('express');
const { isUniqueViolation, withDbSession } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getRandomPlayableTrack } = require('../services/deezer');
const { evaluateSongGuess, parseGuessPayload } = require('../lib/song-guess');
const { logError, logInfo } = require('../lib/observability');
const { publishRoomChat, publishRoomDeleted, publishRoomState } = require('../socket');

const router = express.Router();
const ROUND_DURATION_MS = 120_000;
const ROUND_MAX_ATTEMPTS = 6;
const CORRECT_GUESS_SCORE = 1;
const MAX_AVATAR_KEY_LENGTH = 32;
const ROOM_CHAT_MESSAGE_MAX_LENGTH = 280;
const ROOM_CHAT_DEFAULT_LIMIT = 50;
const ROOM_CHAT_MAX_LIMIT = 100;
const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const ROUND_RESULT_STATUS = {
  MISS: 'miss',
  ARTIST: 'artist',
  SOLVED: 'solved',
  SKIP: 'skip',
};
const ROUND_RESULT_SET = new Set(Object.values(ROUND_RESULT_STATUS));
const ROOM_BY_CODE_SQL = `
  select
    code,
    host_id as "hostId",
    status,
    round,
    state_version as version,
    hint_index as "hintIndex",
    settings,
    created_at as "createdAt",
    current_song_id as "currentSongId",
    current_song as "currentSong",
    round_started_at_ms as "roundStartedAt"
  from public.game_rooms
  where code = $1
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
const ROOM_PLAYER_SQL = `
  select
    player_id as id,
    name,
    avatar_key as "avatarKey"
  from public.game_room_players
  where room_code = $1
    and player_id = $2
  limit 1
`;
const ROOM_HOST_SQL = `
  select
    code,
    host_id as "hostId",
    status,
    round,
    state_version as version
  from public.game_rooms
  where code = $1
  limit 1
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
const UPDATE_USER_AVATAR_SQL = `
  update public.users
  set
    avatar_key = $2,
    updated_at = timezone('utc', now())
  where id = $1
`;

function normalizeRoomCode(value) {
  return String(value || '').toUpperCase();
}

function generateRoomCode() {
  const source = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += source[Math.floor(Math.random() * source.length)];
  }
  return code;
}

function sanitizeAvatarKey(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_AVATAR_KEY_LENGTH);

  if (!normalized) {
    return null;
  }

  return normalized;
}

function sanitizeChatMessage(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeChatLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ROOM_CHAT_DEFAULT_LIMIT;
  }
  return Math.min(parsed, ROOM_CHAT_MAX_LIMIT);
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

function getAuthenticatedPlayer(req) {
  const providedName = req.body?.player?.name;
  const trimmedName = typeof providedName === 'string' ? providedName.trim() : '';
  const name = trimmedName || req.user.displayName || req.user.username || 'Player';
  const providedAvatarKey = req.body?.player?.avatarKey;
  const hasProvidedAvatarKey = Object.prototype.hasOwnProperty.call(req.body?.player || {}, 'avatarKey');

  let avatarKey = sanitizeAvatarKey(req.user.avatarKey);
  let avatarKeyInvalid = false;

  if (hasProvidedAvatarKey) {
    if (providedAvatarKey === null || providedAvatarKey === '') {
      avatarKey = null;
    } else if (typeof providedAvatarKey === 'string') {
      avatarKey = sanitizeAvatarKey(providedAvatarKey);
      avatarKeyInvalid = !avatarKey;
    } else {
      avatarKeyInvalid = true;
    }
  }

  return {
    id: req.user.id,
    name,
    avatarKey,
    hasProvidedAvatarKey,
    avatarKeyInvalid,
  };
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

function parseExpectedStateGuard(body) {
  const expectedRound = Number.parseInt(String(body?.expectedRound ?? ''), 10);
  const expectedVersion = Number.parseInt(String(body?.expectedVersion ?? ''), 10);
  if (!Number.isFinite(expectedRound) || expectedRound < 0) {
    return null;
  }
  if (!Number.isFinite(expectedVersion) || expectedVersion < 0) {
    return null;
  }
  return {
    expectedRound,
    expectedVersion,
  };
}

function parseClientVersion(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function conflictResponsePayload(message, code, room) {
  return {
    error: message,
    code,
    room: room || null,
  };
}

function isRoundExpired(room, nowMs = Date.now()) {
  if (!room || room.status !== 'active') {
    return false;
  }
  const roundEndsAt = toEpochMs(room.roundEndsAt);
  if (!roundEndsAt) {
    return false;
  }
  return nowMs >= roundEndsAt;
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

function buildRoomPayload(roomRow, playerRows, chatMessages) {
  const players = {};
  const roundStartedAt = toEpochMs(roomRow.roundStartedAt);

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
    version: Number(roomRow.version || 0),
    hintIndex: roomRow.hintIndex,
    settings: roomRow.settings || {},
    createdAt: roomRow.createdAt,
    currentSongId: roomRow.currentSongId,
    currentSong: roomRow.currentSong,
    roundStartedAt,
    roundEndsAt: getRoundEndsAtMs(roundStartedAt),
    roundMaxAttempts: ROUND_MAX_ATTEMPTS,
    chat: chatMessages,
  };
}

async function fetchRoomChat(client, code, limit = ROOM_CHAT_DEFAULT_LIMIT) {
  const chatResult = await client.query(ROOM_CHAT_SQL, [code, normalizeChatLimit(limit)]);
  return mapChatRows(chatResult.rows);
}

async function fetchRoomState(client, code, options = {}) {
  const roomResult = await client.query(ROOM_BY_CODE_SQL, [code]);
  if (roomResult.rowCount === 0) {
    return null;
  }

  const [playersResult, chatMessages] = await Promise.all([
    client.query(ROOM_PLAYERS_SQL, [code]),
    fetchRoomChat(client, code, options.chatLimit),
  ]);

  return buildRoomPayload(roomResult.rows[0], playersResult.rows, chatMessages);
}

async function autoAdvanceRoundIfExpired(client, room, { requestId } = {}) {
  if (!isRoundExpired(room)) {
    return { advanced: false };
  }

  const roundStartedAt = toEpochMs(room.roundStartedAt);
  if (!roundStartedAt) {
    return { advanced: false };
  }

  let track;
  try {
    const result = await getRandomPlayableTrack();
    track = result.track;
  } catch (error) {
    logError('rooms.auto_advance.track_failure', error, {
      requestId,
      roomCode: room.code,
    });
    return { advanced: false };
  }

  const nextRoundStartedAt = Date.now();
  const updateResult = await client.query(
    `
      update public.game_rooms
      set
        round = round + 1,
        state_version = state_version + 1,
        hint_index = 0,
        current_song_id = $2,
        current_song = $3::jsonb,
        round_started_at_ms = $4,
        updated_at = timezone('utc', now())
      where code = $1
        and status = 'active'
        and round_started_at_ms = $5
        and state_version = $6
      returning code
    `,
    [
      room.code,
      String(track.id),
      JSON.stringify(track),
      nextRoundStartedAt,
      roundStartedAt,
      Number(room.version || 0),
    ]
  );

  if (updateResult.rowCount === 0) {
    return { advanced: false };
  }

  await client.query(
    `
      update public.game_room_players
      set
        solved = false,
        round_progress = '[]'::jsonb,
        solved_at_ms = null
      where room_code = $1
    `,
    [room.code]
  );

  logInfo('rooms.auto_advance.success', {
    requestId,
    roomCode: room.code,
    trackId: String(track.id),
  });

  return { advanced: true };
}

router.post('/', requireAuth, (req, res) => {
  const requestId = req.requestId;

  (async () => {
    const { mode, difficulty, genre, decade } = req.body || {};
    const player = getAuthenticatedPlayer(req);
    if (player.avatarKeyInvalid) {
      return res.status(400).json({ error: 'Invalid avatar key' });
    }

    try {
      const room = await withDbSession(
        {
          userId: player.id,
          requestId,
          backend: true,
        },
        async (client) => {
          let attempt = 0;
          while (attempt < 8) {
            attempt += 1;
            const code = generateRoomCode();
            try {
              await client.query(
                `
                  insert into public.game_rooms (
                    code,
                    host_id,
                    settings
                  )
                  values ($1, $2, $3::jsonb)
                `,
                [
                  code,
                  player.id,
                  JSON.stringify({
                    mode,
                    difficulty,
                    genre,
                    decade,
                  }),
                ]
              );

              await client.query(
                `
                  insert into public.game_room_players (
                    room_code,
                    player_id,
                    name,
                    avatar_key,
                    score,
                    solved,
                    round_progress,
                    solved_at_ms
                  )
                  values ($1, $2, $3, $4, 0, false, '[]'::jsonb, null)
                `,
                [code, player.id, player.name, player.avatarKey]
              );

              if (player.hasProvidedAvatarKey) {
                await client.query(UPDATE_USER_AVATAR_SQL, [player.id, player.avatarKey]);
              }

              return fetchRoomState(client, code);
            } catch (error) {
              if (isUniqueViolation(error, 'game_rooms_pkey')) {
                continue;
              }
              throw error;
            }
          }

          throw new Error('Unable to create unique room code.');
        }
      );

      logInfo('rooms.create.success', {
        requestId,
        roomCode: room.code,
        hostId: player.id,
      });
      publishRoomState(room, {
        event: 'room_created',
        actorId: player.id,
      });
      return res.status(201).json({ room });
    } catch (error) {
      logError('rooms.create.failure', error, {
        requestId,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  })();
});

router.post('/:code/join', requireAuth, (req, res) => {
  const requestId = req.requestId;

  (async () => {
    const code = normalizeRoomCode(req.params.code);
    const player = getAuthenticatedPlayer(req);
    if (player.avatarKeyInvalid) {
      return res.status(400).json({ error: 'Invalid avatar key' });
    }

    try {
      const payload = await withDbSession(
        {
          userId: player.id,
          requestId,
          backend: true,
        },
        async (client) => {
          const existing = await client.query(ROOM_HOST_SQL, [code]);
          if (existing.rowCount === 0) {
            return { notFound: true };
          }

          await client.query(
            `
              insert into public.game_room_players (
                room_code,
                player_id,
                name,
                avatar_key,
                score,
                solved,
                round_progress,
                solved_at_ms
              )
              values ($1, $2, $3, $4, 0, false, '[]'::jsonb, null)
              on conflict (room_code, player_id)
              do update
              set
                name = excluded.name,
                avatar_key = excluded.avatar_key
            `,
            [code, player.id, player.name, player.avatarKey]
          );

          if (player.hasProvidedAvatarKey) {
            await client.query(UPDATE_USER_AVATAR_SQL, [player.id, player.avatarKey]);
          }

          await client.query(
            `
              update public.game_rooms
              set
                state_version = state_version + 1,
                updated_at = timezone('utc', now())
              where code = $1
            `,
            [code]
          );

          let room = await fetchRoomState(client, code);
          const autoAdvanceResult = await autoAdvanceRoundIfExpired(client, room, { requestId });
          if (autoAdvanceResult.advanced) {
            room = await fetchRoomState(client, code);
          }
          return { room };
        }
      );

      if (payload.notFound) {
        return res.status(404).json({ error: 'Room not found' });
      }

      logInfo('rooms.join.success', {
        requestId,
        roomCode: code,
        playerId: player.id,
      });
      publishRoomState(payload.room, {
        event: 'player_joined',
        actorId: player.id,
      });
      return res.json({ room: payload.room });
    } catch (error) {
      logError('rooms.join.failure', error, {
        requestId,
        roomCode: code,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  })();
});

router.post('/:code/start', requireAuth, async (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const player = getAuthenticatedPlayer(req);
  const requestId = req.requestId;
  const expectedState = parseExpectedStateGuard(req.body);
  if (!expectedState) {
    return res.status(400).json({
      error: 'expectedRound and expectedVersion are required.',
      code: 'ROOM_EXPECTED_STATE_REQUIRED',
    });
  }

  try {
    const preflight = await withDbSession(
      {
        userId: player.id,
        requestId,
        backend: true,
      },
      async (client) => {
        const roomResult = await client.query(ROOM_HOST_SQL, [code]);
        if (roomResult.rowCount === 0) {
          return { notFound: true };
        }
        if (roomResult.rows[0].hostId !== player.id) {
          return { forbidden: true };
        }

        const room = await fetchRoomState(client, code);
        if (!room) {
          return { notFound: true };
        }
        if (room.status !== 'lobby') {
          return {
            phaseConflict: true,
            room,
          };
        }
        if (
          Number(room.round) !== expectedState.expectedRound ||
          Number(room.version) !== expectedState.expectedVersion
        ) {
          return {
            versionConflict: true,
            room,
          };
        }

        return { ok: true };
      }
    );

    if (preflight.notFound) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (preflight.forbidden) {
      return res.status(403).json({ error: 'Only host can start room' });
    }
    if (preflight.phaseConflict) {
      return res.status(409).json(
        conflictResponsePayload(
          'Room is not in lobby phase.',
          'ROOM_PHASE_CONFLICT',
          preflight.room
        )
      );
    }
    if (preflight.versionConflict) {
      return res.status(409).json(
        conflictResponsePayload(
          'Room state changed. Sync before starting.',
          'ROOM_VERSION_CONFLICT',
          preflight.room
        )
      );
    }
  } catch (error) {
    logError('rooms.start.preflight_failure', error, {
      requestId,
      roomCode: code,
    });
    return res.status(500).json({ error: 'Server error' });
  }

  let track;
  try {
    const result = await getRandomPlayableTrack();
    track = result.track;
  } catch (error) {
    return res.status(error.status || 503).json({
      error: error.message || 'Failed to load Deezer track for room start.',
      code: error.code || 'DEEZER_UNAVAILABLE',
    });
  }

  try {
    const payload = await withDbSession(
      {
        userId: player.id,
        requestId,
        backend: true,
      },
      async (client) => {
        const roomResult = await client.query(ROOM_HOST_SQL, [code]);
        if (roomResult.rowCount === 0) {
          return { notFound: true };
        }
        if (roomResult.rows[0].hostId !== player.id) {
          return { forbidden: true };
        }

        const roomBefore = await fetchRoomState(client, code);
        if (!roomBefore) {
          return { notFound: true };
        }
        if (roomBefore.status !== 'lobby') {
          return {
            phaseConflict: true,
            room: roomBefore,
          };
        }
        if (
          Number(roomBefore.round) !== expectedState.expectedRound ||
          Number(roomBefore.version) !== expectedState.expectedVersion
        ) {
          return {
            versionConflict: true,
            room: roomBefore,
          };
        }

        const roundStartedAt = Date.now();
        const updateResult = await client.query(
          `
            update public.game_rooms
            set
              status = 'active',
              round = round + 1,
              state_version = state_version + 1,
              hint_index = 0,
              current_song_id = $2,
              current_song = $3::jsonb,
              round_started_at_ms = $4,
              updated_at = timezone('utc', now())
            where code = $1
              and host_id = $5
              and status = 'lobby'
              and round = $6
              and state_version = $7
            returning code
          `,
          [
            code,
            String(track.id),
            JSON.stringify(track),
            roundStartedAt,
            player.id,
            expectedState.expectedRound,
            expectedState.expectedVersion,
          ]
        );

        if (updateResult.rowCount === 0) {
          const latestRoom = await fetchRoomState(client, code);
          return {
            conflict: true,
            room: latestRoom,
          };
        }

        await client.query(
          `
            update public.game_room_players
            set
              solved = false,
              round_progress = '[]'::jsonb,
              solved_at_ms = null
            where room_code = $1
          `,
          [code]
        );

        const room = await fetchRoomState(client, code);
        return { room };
      }
    );

    if (payload.notFound) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (payload.forbidden) {
      return res.status(403).json({ error: 'Only host can start room' });
    }
    if (payload.phaseConflict) {
      return res.status(409).json(
        conflictResponsePayload(
          'Room is not in lobby phase.',
          'ROOM_PHASE_CONFLICT',
          payload.room
        )
      );
    }
    if (payload.versionConflict) {
      return res.status(409).json(
        conflictResponsePayload(
          'Room state changed. Sync before starting.',
          'ROOM_VERSION_CONFLICT',
          payload.room
        )
      );
    }
    if (payload.conflict) {
      return res.status(409).json(
        conflictResponsePayload(
          'Room state changed while starting round.',
          'ROOM_CONFLICT',
          payload.room
        )
      );
    }

    logInfo('rooms.start.success', {
      requestId,
      roomCode: code,
      hostId: player.id,
      trackId: String(track.id),
    });
    publishRoomState(payload.room, {
      event: 'round_started',
      actorId: player.id,
      trackId: String(track.id),
    });
    return res.json({ room: payload.room });
  } catch (error) {
    logError('rooms.start.failure', error, {
      requestId,
      roomCode: code,
    });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:code/guess', requireAuth, (req, res) => {
  const requestId = req.requestId;

  (async () => {
    const code = normalizeRoomCode(req.params.code);
    const player = getAuthenticatedPlayer(req);
    const guess = parseGuessPayload(req.body);
    const expectedState = parseExpectedStateGuard(req.body);
    if (!expectedState) {
      return res.status(400).json({
        error: 'expectedRound and expectedVersion are required.',
        code: 'ROOM_EXPECTED_STATE_REQUIRED',
      });
    }

    try {
      const payload = await withDbSession(
        {
          userId: player.id,
          requestId,
          backend: true,
        },
        async (client) => {
          let room = await fetchRoomState(client, code);
          if (!room) {
            return { notFound: true };
          }
          if (!room.players[player.id]) {
            return { forbidden: true };
          }

          const autoAdvanceResult = await autoAdvanceRoundIfExpired(client, room, { requestId });
          if (autoAdvanceResult.advanced) {
            room = await fetchRoomState(client, code);
          }

          if (!room || room.status !== 'active') {
            return {
              phaseConflict: true,
              room,
              autoAdvanced: autoAdvanceResult.advanced,
            };
          }

          if (
            Number(room.round) !== expectedState.expectedRound ||
            Number(room.version) !== expectedState.expectedVersion
          ) {
            return {
              versionConflict: true,
              room,
              autoAdvanced: autoAdvanceResult.advanced,
            };
          }

          const playerState = room.players[player.id];
          const existingResults = Array.isArray(playerState?.guessResults)
            ? playerState.guessResults.slice(0, ROUND_MAX_ATTEMPTS)
            : [];

          if (playerState?.solved) {
            return {
              room,
              solved: true,
              changed: false,
              autoAdvanced: autoAdvanceResult.advanced,
              guessResult: ROUND_RESULT_STATUS.SOLVED,
              guessIndex:
                existingResults.length > 0 ? Math.max(existingResults.length - 1, 0) : null,
            };
          }

          if (existingResults.length >= ROUND_MAX_ATTEMPTS) {
            return {
              attemptsExhausted: true,
              room,
              solved: false,
              changed: false,
              autoAdvanced: autoAdvanceResult.advanced,
            };
          }

          const roundIsOpen = !isRoundExpired(room);
          if (!roundIsOpen) {
            return {
              phaseConflict: true,
              room,
              autoAdvanced: autoAdvanceResult.advanced,
            };
          }

          const evaluatedGuess = evaluateSongGuess(guess, room.currentSong);
          const guessResult = evaluatedGuess.result;
          const guessIndex = existingResults.length;
          const guessRecordedAtMs = Date.now();

          const playerUpdateResult = await client.query(
            `
              update public.game_room_players
              set
                score = score + case when $3 = $7 then $6 else 0 end,
                solved = solved or ($3 = $7),
                round_progress = coalesce(round_progress, '[]'::jsonb) || to_jsonb($3::text),
                solved_at_ms = case
                  when solved = false and $3 = $7 then $4
                  else solved_at_ms
                end
              where room_code = $1
                and player_id = $2
                and solved = false
                and jsonb_array_length(coalesce(round_progress, '[]'::jsonb)) < $5
              returning player_id
            `,
            [
              code,
              player.id,
              guessResult,
              guessRecordedAtMs,
              ROUND_MAX_ATTEMPTS,
              CORRECT_GUESS_SCORE,
              ROUND_RESULT_STATUS.SOLVED,
            ]
          );

          if (playerUpdateResult.rowCount === 0) {
            const latestRoom = await fetchRoomState(client, code);
            return {
              versionConflict: true,
              room: latestRoom,
              autoAdvanced: autoAdvanceResult.advanced,
            };
          }

          await client.query(
            `
              update public.game_rooms
              set
                state_version = state_version + 1,
                updated_at = timezone('utc', now())
              where code = $1
            `,
            [code]
          );

          const updatedRoom = await fetchRoomState(client, code);
          return {
            room: updatedRoom,
            solved: Boolean(updatedRoom.players[player.id]?.solved),
            changed: true,
            autoAdvanced: autoAdvanceResult.advanced,
            guessResult,
            guessIndex,
          };
        }
      );

      if (payload.notFound) {
        return res.status(404).json({ error: 'Room not found' });
      }
      if (payload.forbidden) {
        return res.status(403).json({ error: 'Player not in room' });
      }
      if (payload.phaseConflict) {
        if (payload.autoAdvanced && payload.room) {
          publishRoomState(payload.room, {
            event: 'round_auto_advanced',
            actorId: player.id,
          });
        }
        return res.status(409).json(
          conflictResponsePayload(
            'Round is not active. Sync room state.',
            'ROOM_PHASE_CONFLICT',
            payload.room
          )
        );
      }
      if (payload.versionConflict) {
        if (payload.autoAdvanced && payload.room) {
          publishRoomState(payload.room, {
            event: 'round_auto_advanced',
            actorId: player.id,
          });
        }
        return res.status(409).json(
          conflictResponsePayload(
            'Room state changed. Sync before submitting guess.',
            'ROOM_VERSION_CONFLICT',
            payload.room
          )
        );
      }
      if (payload.attemptsExhausted) {
        return res.status(409).json(
          conflictResponsePayload(
            'No guesses left this round.',
            'ROOM_ATTEMPTS_EXHAUSTED',
            payload.room
          )
        );
      }

      if (payload.changed || payload.autoAdvanced) {
        publishRoomState(payload.room, {
          event: payload.autoAdvanced
            ? 'round_auto_advanced'
            : payload.guessResult === ROUND_RESULT_STATUS.SOLVED
              ? 'player_solved'
              : 'player_guess_result',
          actorId: player.id,
        });
      }

      return res.json({
        solved: payload.solved,
        room: payload.room,
        guessResult: payload.guessResult || null,
        guessIndex: Number.isFinite(payload.guessIndex) ? payload.guessIndex : null,
      });
    } catch (error) {
      logError('rooms.guess.failure', error, {
        requestId,
        roomCode: code,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  })();
});

router.post('/:code/chat', requireAuth, (req, res) => {
  const requestId = req.requestId;

  (async () => {
    const code = normalizeRoomCode(req.params.code);
    const player = getAuthenticatedPlayer(req);
    const message = sanitizeChatMessage(req.body?.message);
    const expectedVersion = parseClientVersion(req.body?.expectedVersion);

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > ROOM_CHAT_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({
        error: `Message must be ${ROOM_CHAT_MESSAGE_MAX_LENGTH} characters or fewer`,
      });
    }

    try {
      const payload = await withDbSession(
        {
          userId: player.id,
          requestId,
          backend: true,
        },
        async (client) => {
          const roomResult = await client.query(ROOM_HOST_SQL, [code]);
          if (roomResult.rowCount === 0) {
            return { notFound: true };
          }

          if (
            expectedVersion !== null &&
            Number(roomResult.rows[0].version) !== expectedVersion
          ) {
            const room = await fetchRoomState(client, code);
            return {
              versionConflict: true,
              room,
            };
          }

          const roomPlayerResult = await client.query(ROOM_PLAYER_SQL, [code, player.id]);
          if (roomPlayerResult.rowCount === 0) {
            return { forbidden: true };
          }

          const roomPlayer = roomPlayerResult.rows[0];
          const insertResult = await client.query(
            `
              insert into public.game_room_chat_messages (
                room_code,
                sender_id,
                sender_name,
                sender_avatar_key,
                message
              )
              values ($1, $2, $3, $4, $5)
              returning
                id,
                sender_id as "senderId",
                sender_name as "senderName",
                sender_avatar_key as "senderAvatarKey",
                message,
                created_at as "createdAt"
            `,
            [code, player.id, roomPlayer.name, roomPlayer.avatarKey, message]
          );

          const versionResult = await client.query(
            `
              update public.game_rooms
              set
                state_version = state_version + 1,
                updated_at = timezone('utc', now())
              where code = $1
              returning state_version as version
            `,
            [code]
          );

          return {
            message: mapChatRows(insertResult.rows)[0],
            version: Number(versionResult.rows[0]?.version || 0),
          };
        }
      );

      if (payload.notFound) {
        return res.status(404).json({ error: 'Room not found' });
      }
      if (payload.forbidden) {
        return res.status(403).json({ error: 'Player not in room' });
      }
      if (payload.versionConflict) {
        return res.status(409).json(
          conflictResponsePayload(
            'Room state changed. Sync before sending chat.',
            'ROOM_VERSION_CONFLICT',
            payload.room
          )
        );
      }

      logInfo('rooms.chat.send.success', {
        requestId,
        roomCode: code,
        playerId: player.id,
      });
      publishRoomChat(code, payload.message, {
        actorId: player.id,
        version: payload.version,
      });
      return res.status(201).json(payload);
    } catch (error) {
      logError('rooms.chat.send.failure', error, {
        requestId,
        roomCode: code,
        playerId: player.id,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  })();
});

router.get('/:code/chat', requireAuth, async (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const player = getAuthenticatedPlayer(req);

  try {
    const payload = await withDbSession(
      {
        userId: player.id,
        requestId: req.requestId,
        backend: true,
      },
      async (client) => {
        const roomResult = await client.query(ROOM_HOST_SQL, [code]);
        if (roomResult.rowCount === 0) {
          return { notFound: true };
        }

        const roomPlayerResult = await client.query(ROOM_PLAYER_SQL, [code, player.id]);
        if (roomPlayerResult.rowCount === 0) {
          return { forbidden: true };
        }

        const chat = await fetchRoomChat(client, code, req.query.limit);
        return { chat };
      }
    );

    if (payload.notFound) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (payload.forbidden) {
      return res.status(403).json({ error: 'Player not in room' });
    }

    return res.json(payload);
  } catch (error) {
    logError('rooms.chat.list.failure', error, {
      requestId: req.requestId,
      roomCode: code,
      playerId: player.id,
    });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:code/skip', requireAuth, (req, res) => {
  const requestId = req.requestId;

  (async () => {
    const code = normalizeRoomCode(req.params.code);
    const player = getAuthenticatedPlayer(req);
    const expectedState = parseExpectedStateGuard(req.body);
    if (!expectedState) {
      return res.status(400).json({
        error: 'expectedRound and expectedVersion are required.',
        code: 'ROOM_EXPECTED_STATE_REQUIRED',
      });
    }

    try {
      const payload = await withDbSession(
        {
          userId: player.id,
          requestId,
          backend: true,
        },
        async (client) => {
          const updateResult = await client.query(
            `
              update public.game_rooms
              set
                hint_index = coalesce(hint_index, 0) + 1,
                state_version = state_version + 1,
                updated_at = timezone('utc', now())
              where code = $1
                and host_id = $2
                and status = 'active'
                and round = $3
                and state_version = $4
              returning code
            `,
            [code, player.id, expectedState.expectedRound, expectedState.expectedVersion]
          );

          if (updateResult.rowCount === 0) {
            const roomResult = await client.query(ROOM_HOST_SQL, [code]);
            if (roomResult.rowCount === 0) {
              return { notFound: true };
            }
            if (roomResult.rows[0].hostId !== player.id) {
              return { forbidden: true };
            }

            const room = await fetchRoomState(client, code);
            if (room && room.status !== 'active') {
              return {
                phaseConflict: true,
                room,
              };
            }
            return {
              versionConflict: true,
              room,
            };
          }

          await client.query(
            `
              update public.game_room_players
              set
                round_progress = coalesce(round_progress, '[]'::jsonb) || to_jsonb($2::text)
              where room_code = $1
                and solved = false
                and jsonb_array_length(coalesce(round_progress, '[]'::jsonb)) < $3
            `,
            [code, ROUND_RESULT_STATUS.SKIP, ROUND_MAX_ATTEMPTS]
          );

          const room = await fetchRoomState(client, code);
          return { room };
        }
      );

      if (payload.notFound) {
        return res.status(404).json({ error: 'Room not found' });
      }
      if (payload.forbidden) {
        return res.status(403).json({ error: 'Only host can skip in room' });
      }
      if (payload.phaseConflict) {
        return res.status(409).json(
          conflictResponsePayload(
            'Round is not active. Sync room state.',
            'ROOM_PHASE_CONFLICT',
            payload.room
          )
        );
      }
      if (payload.versionConflict) {
        return res.status(409).json(
          conflictResponsePayload(
            'Room state changed. Sync before skipping hint.',
            'ROOM_VERSION_CONFLICT',
            payload.room
          )
        );
      }

      publishRoomState(payload.room, {
        event: 'hint_skipped',
        actorId: player.id,
      });
      return res.json({ room: payload.room });
    } catch (error) {
      logError('rooms.skip.failure', error, {
        requestId,
        roomCode: code,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  })();
});

router.post('/:code/leave', requireAuth, (req, res) => {
  const requestId = req.requestId;

  (async () => {
    const code = normalizeRoomCode(req.params.code);
    const player = getAuthenticatedPlayer(req);

    try {
      const payload = await withDbSession(
        {
          userId: player.id,
          requestId,
          backend: true,
        },
        async (client) => {
          const roomResult = await client.query(
            `
              select
                code,
                host_id as "hostId"
              from public.game_rooms
              where code = $1
              for update
            `,
            [code]
          );

          if (roomResult.rowCount === 0) {
            return { notFound: true };
          }

          const deleteResult = await client.query(
            `
              delete from public.game_room_players
              where room_code = $1
                and player_id = $2
            `,
            [code, player.id]
          );

          if (deleteResult.rowCount === 0) {
            return { forbidden: true };
          }

          const remainingResult = await client.query(ROOM_PLAYERS_SQL, [code]);
          if (remainingResult.rowCount === 0) {
            await client.query(
              `
                delete from public.game_rooms
                where code = $1
              `,
              [code]
            );
            return { room: null };
          }

          const currentHostId = roomResult.rows[0].hostId;
          if (currentHostId && currentHostId === player.id) {
            await client.query(
              `
                update public.game_rooms
                set
                  host_id = $2,
                  state_version = state_version + 1,
                  updated_at = timezone('utc', now())
                where code = $1
              `,
              [code, remainingResult.rows[0].id]
            );
          } else {
            await client.query(
              `
                update public.game_rooms
                set
                  state_version = state_version + 1,
                  updated_at = timezone('utc', now())
                where code = $1
              `,
              [code]
            );
          }

          const room = await fetchRoomState(client, code);
          return { room };
        }
      );

      if (payload.notFound) {
        return res.status(404).json({ error: 'Room not found' });
      }
      if (payload.forbidden) {
        return res.status(403).json({ error: 'Player not in room' });
      }

      logInfo('rooms.leave.success', {
        requestId,
        roomCode: code,
        playerId: player.id,
      });
      if (!payload.room) {
        publishRoomDeleted(code);
      } else {
        publishRoomState(payload.room, {
          event: 'player_left',
          actorId: player.id,
        });
      }
      return res.json({ room: payload.room });
    } catch (error) {
      logError('rooms.leave.failure', error, {
        requestId,
        roomCode: code,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  })();
});

router.get('/:code/state', requireAuth, async (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const player = getAuthenticatedPlayer(req);

  try {
    const payload = await withDbSession(
      {
        userId: player.id,
        requestId: req.requestId,
        backend: true,
      },
      async (client) => {
        let room = await fetchRoomState(client, code);
        if (!room) {
          return { notFound: true };
        }
        if (!room.players[player.id]) {
          return { forbidden: true };
        }

        const autoAdvanceResult = await autoAdvanceRoundIfExpired(client, room, {
          requestId: req.requestId,
        });
        if (autoAdvanceResult.advanced) {
          room = await fetchRoomState(client, code);
        }

        return {
          room,
          autoAdvanced: autoAdvanceResult.advanced,
        };
      }
    );

    if (payload.notFound) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (payload.forbidden) {
      return res.status(403).json({ error: 'Player not in room' });
    }

    if (payload.autoAdvanced && payload.room) {
      publishRoomState(payload.room, {
        event: 'round_auto_advanced',
        actorId: player.id,
      });
    }

    return res.json({ room: payload.room });
  } catch (error) {
    logError('rooms.state.failure', error, {
      requestId: req.requestId,
      roomCode: code,
    });
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
