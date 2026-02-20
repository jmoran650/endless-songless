const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 8080;
const MP_POLL_MS = 12000;

const DIFFICULTY = {
  easy: {
    label: "Easy",
    timeLimit: 120,
    scoreBase: 420,
    scoreScale: 1,
    hints: [5, 9, 14, 19, 24, 30],
  },
  normal: {
    label: "Normal",
    timeLimit: 95,
    scoreBase: 500,
    scoreScale: 1.15,
    hints: [4, 7, 11, 15, 20, 26],
  },
  hard: {
    label: "Hard",
    timeLimit: 70,
    scoreBase: 520,
    scoreScale: 1.4,
    hints: [2, 4, 6, 9, 12, 16],
  },
};

const SONG_LIBRARY = [
  {
    id: "s1",
    title: "Endless Orbit",
    artist: "Nova Drive",
    genre: "Electronic",
    decade: "2010s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  },
  {
    id: "s2",
    title: "Midnight Circuit",
    artist: "Circuit Saints",
    genre: "Electronic",
    decade: "2000s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  },
  {
    id: "s3",
    title: "Rusted Highway",
    artist: "Grinder Road",
    genre: "Rock",
    decade: "1990s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
  },
  {
    id: "s4",
    title: "Coffee and Vinyl",
    artist: "Blue Lantern",
    genre: "Indie",
    decade: "2010s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
  },
  {
    id: "s5",
    title: "City at Noon",
    artist: "Luminous",
    genre: "Pop",
    decade: "2020s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
  },
  {
    id: "s6",
    title: "Paper Wings",
    artist: "Morning Vale",
    genre: "Pop",
    decade: "2000s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
  },
  {
    id: "s7",
    title: "Solar Arcade",
    artist: "Twin Frequency",
    genre: "Rock",
    decade: "1980s",
    audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
  },
];

const rooms = new Map();
const roomClients = new Map();

function id(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function cors(res, req) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function sendJson(res, code, payload) {
  cors(res, res.__req || {});
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function parseJson(req) {
  const chunks = [];
  return new Promise((resolve) => {
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
  });
}

function sanitizeRoom(room) {
  if (!room) return null;
  const copy = JSON.parse(JSON.stringify(room));
  delete copy._internal;
  return copy;
}

function roomPoolByFilters(room) {
  return SONG_LIBRARY.filter((song) => {
    const byGenre = room.genre === "Any" || song.genre === room.genre;
    const byDecade = room.decade === "Any" || song.decade === room.decade;
    return byGenre && byDecade;
  });
}

function pickSong(room) {
  const pool = roomPoolByFilters(room);
  if (pool.length === 0) return SONG_LIBRARY[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

function nowMs() {
  return Date.now();
}

function hintText(room, difficulty, hintIndex = room.hintIndex || 0) {
  const song = SONG_LIBRARY.find((item) => item.id === room.currentSongId) || SONG_LIBRARY[0];
  const levels = difficulty.hints;
  const ratio = (Math.min(hintIndex, levels.length - 1) + 1) / levels.length;
  const masked = [song.title, song.artist].map((value) => {
    const chars = value.split("");
    const revealMax = Math.max(1, Math.floor(chars.filter((c) => /[A-Za-z0-9]/.test(c)).length * ratio));
    let seen = 0;
    return chars
      .map((ch) => {
        if (!/[A-Za-z0-9]/.test(ch)) return ch;
        if (seen < revealMax) {
          seen += 1;
          return ch;
        }
        return "_";
      })
      .join("");
  });
  return `${masked[0]} — ${masked[1]}`;
}

function emitRoom(code) {
  const room = rooms.get(code);
  const payload = `data: ${JSON.stringify({ type: "room-state", room: sanitizeRoom(room) })}\n\n`;
  for (const client of roomClients.get(code) || []) {
    if (client.writable && !client.writableEnded) {
      client.write(payload);
    } else {
      roomClients.get(code)?.delete(client);
    }
  }
}

function createRoom(state, options = {}) {
  const code = id(6);
  const room = {
    code,
    hostId: state.player.id,
    hostName: state.player.name,
    mode: state.mode || "unlimited",
    difficulty: state.difficulty || "normal",
    genre: state.genre || "Any",
    decade: state.decade || "Any",
    status: "lobby",
    currentSongId: null,
    hintIndex: 0,
    round: 0,
    roundStartsAt: 0,
    roundEndsAt: 0,
    currentSongDuration: 0,
    players: {},
    createdAt: nowMs(),
  };

  room.players[state.player.id] = {
    id: state.player.id,
    name: state.player.name,
    score: 0,
    solved: false,
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, state) {
  const room = rooms.get(code);
  if (!room) return null;
  room.players[state.player.id] = room.players[state.player.id] || {
    id: state.player.id,
    name: state.player.name,
    score: 0,
    solved: false,
  };
  emitRoom(code);
  return room;
}

function startRound(code) {
  const room = rooms.get(code);
  if (!room || room.status !== "lobby") return room;
  room.status = "active";
  room.round = 1;
  room.hintIndex = 0;
  room.currentSongId = pickSong(room).id;
  room.roundStartsAt = nowMs();
  room.roundEndsAt = room.roundStartsAt + DIFFICULTY[room.difficulty].timeLimit * 1000;
  room.currentSongDuration = DIFFICULTY[room.difficulty].hints[room.hintIndex] * 1000;
  Object.values(room.players).forEach((entry) => {
    entry.solved = false;
  });
  Object.keys(room.players).forEach((playerId) => {
    room.players[playerId].solved = false;
  });
  return room;
}

function nextRound(code) {
  const room = rooms.get(code);
  if (!room || room.status !== "active") return room;
  room.hintIndex = 0;
  room.round += 1;
  room.currentSongId = pickSong(room).id;
  room.roundStartsAt = nowMs();
  room.roundEndsAt = room.roundStartsAt + DIFFICULTY[room.difficulty].timeLimit * 1000;
  room.currentSongDuration = DIFFICULTY[room.difficulty].hints[room.hintIndex] * 1000;
  Object.keys(room.players).forEach((playerId) => {
    room.players[playerId].solved = false;
  });
  return room;
}

function skipInRoom(code) {
  const room = rooms.get(code);
  if (!room || room.status !== "active") return room;
  room.hintIndex = Math.min(room.hintIndex + 1, DIFFICULTY[room.difficulty].hints.length - 1);
  room.currentSongDuration = DIFFICULTY[room.difficulty].hints[room.hintIndex] * 1000;
  return room;
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeMpScore(room, hintIndex, remainingSec) {
  const diff = DIFFICULTY[room.difficulty];
  const ratio = 1 - hintIndex * 0.08;
  const hintBonus = 12 * (3 - hintIndex);
  const timeBonus = Math.max(0, remainingSec) * 8;
  return Math.max(20, Math.round((diff.scoreBase * 0.8 + hintBonus + timeBonus) * ratio));
}

function clearSolved(room) {
  return Object.values(room.players).every((entry) => entry.solved);
}

function enforceRoundTimeout(room) {
  if (!room || room.status !== "active") return;
  if (room.roundEndsAt <= nowMs()) {
    room.status = "lobby";
  }
}

function guessInRoom(code, playerId, titleInput, artistInput) {
  const room = rooms.get(code);
  if (!room || room.status !== "active" || !room.currentSongId) return null;
  const player = room.players[playerId];
  if (!player || player.solved) return room;
  const song = SONG_LIBRARY.find((item) => item.id === room.currentSongId);
  if (
    normalize(song.title) === normalize(titleInput) &&
    normalize(song.artist) === normalize(artistInput)
  ) {
    const remainingMs = Math.max(0, room.roundEndsAt - nowMs());
    const score = computeMpScore(room, room.hintIndex, remainingMs / 1000);
    player.solved = true;
    player.score = Number(player.score || 0) + score;
    return { room, score, solved: true, song };
  }
  return { room, solved: false };
}

function buildRoomView(room) {
  if (!room) return null;
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.normal;
  const now = nowMs();
  const payload = sanitizeRoom(room);
  payload.hintText = room.currentSongId ? hintText(room, diff, room.hintIndex) : "--";
  if (room.status === "active") {
    payload.timeLeft = Math.max(0, Math.ceil((room.roundEndsAt - now) / 1000));
  } else {
    payload.timeLeft = 0;
  }
  payload.currentSongId = room.currentSongId;
  payload.serverTime = now;
  return payload;
}

async function route(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  cors(res, req);
  res.__req = req;

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if ((parsedUrl.pathname === "/health" || parsedUrl.pathname === "/api/health") && req.method === "GET") {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }

  if (parsedUrl.pathname === "/api/rooms" && req.method === "GET") {
    const payload = Array.from(rooms.keys());
    sendJson(res, 200, payload);
    return;
  }

  if (parsedUrl.pathname === "/api/rooms" && req.method === "POST") {
    const body = await parseJson(req);
    const player = body?.player || {};
    if (!player.id || !player.name) {
      sendJson(res, 400, { error: "player required" });
      return;
    }
    const room = createRoom({
      player,
      mode: body.mode || body?.settings?.mode,
      difficulty: body.difficulty || body?.settings?.difficulty || "normal",
      genre: body.genre || body?.settings?.genre || "Any",
      decade: body.decade || body?.settings?.decade || "Any",
    });
    rooms.set(room.code, room);
    emitRoom(room.code);
    sendJson(res, 201, { room: buildRoomView(room) });
    return;
  }

  const roomMatch = parsedUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|leave|start|next|skip|guess|state|events)?)?$/);
  const code = roomMatch?.[1];
  const action = roomMatch?.[2] || "state";
  if (!code || !rooms.has(code)) {
    if (parsedUrl.pathname.startsWith("/api/rooms/") && req.method !== "OPTIONS") {
      sendJson(res, 404, { error: "room not found" });
      return;
    }
  }

  if (action === "events" && req.method === "GET") {
    const room = rooms.get(code);
    if (!room) {
      sendJson(res, 404, { error: "room not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ type: "connected", room: buildRoomView(room) })}\n\n`);
    const list = roomClients.get(code) || new Set();
    list.add(res);
    roomClients.set(code, list);
    req.on("close", () => {
      const current = roomClients.get(code);
      if (!current) return;
      current.delete(res);
      if (current.size === 0) roomClients.delete(code);
    });
    const keepAlive = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAlive);
        return;
      }
      res.write(`:keep-alive\n\n`);
    }, MP_POLL_MS);
    req.on("close", () => clearInterval(keepAlive));
    emitRoom(code);
    return;
  }

  const room = rooms.get(code);
  if (!room) {
    sendJson(res, 404, { error: "room not found" });
    return;
  }

  if (action === "state" && req.method === "GET") {
    enforceRoundTimeout(room);
    sendJson(res, 200, { room: buildRoomView(room) });
    return;
  }

  const body = req.method === "POST" ? await parseJson(req) : {};
  const player = body?.player || {};
  if (!player.id || !player.name) {
    sendJson(res, 401, { error: "player required" });
    return;
  }

  if (action === "join" && req.method === "POST") {
    const updated = joinRoom(code, body);
    sendJson(res, 200, { room: buildRoomView(updated) });
    emitRoom(code);
    return;
  }

  if (action === "leave" && req.method === "POST") {
    if (!room.players[player.id]) {
      sendJson(res, 400, { error: "not in room" });
      return;
    }
    delete room.players[player.id];
    if (Object.keys(room.players).length === 0) {
      rooms.delete(code);
      emitRoom(code);
      sendJson(res, 200, { room: null });
      return;
    }
    emitRoom(code);
    sendJson(res, 200, { room: buildRoomView(room) });
    return;
  }

  if (action === "start" && req.method === "POST") {
    if (room.hostId !== player.id) {
      sendJson(res, 403, { error: "only host can start" });
      return;
    }
    startRound(code);
    emitRoom(code);
    sendJson(res, 200, { room: buildRoomView(room) });
    return;
  }

  if (action === "next" && req.method === "POST") {
    if (room.hostId !== player.id) {
      sendJson(res, 403, { error: "only host can continue" });
      return;
    }
    nextRound(code);
    emitRoom(code);
    sendJson(res, 200, { room: buildRoomView(room) });
    return;
  }

  if (action === "skip" && req.method === "POST") {
    if (room.hostId !== player.id) {
      sendJson(res, 403, { error: "only host can skip" });
      return;
    }
    skipInRoom(code);
    emitRoom(code);
    sendJson(res, 200, { room: buildRoomView(room) });
    return;
  }

  if (action === "guess" && req.method === "POST") {
    const result = guessInRoom(code, player.id, body?.title, body?.artist);
    if (!result) {
      sendJson(res, 404, { error: "invalid room state" });
      return;
    }
    emitRoom(code);
    sendJson(res, 200, {
      room: buildRoomView(result.room),
      solved: result.solved,
      score: result.score,
      title: result.song?.title,
      artist: result.song?.artist,
    });
    return;
  }

  sendJson(res, 404, { error: "invalid endpoint" });
}

setInterval(() => {
  for (const room of rooms.values()) {
    const old = room.status;
    enforceRoundTimeout(room);
    if (old !== room.status) {
      emitRoom(room.code);
    }
  }
}, 500);

const server = http.createServer((req, res) => route(req, res));
server.listen(PORT, () => {
  console.log(`Songless backend running at http://localhost:${PORT}`);
});
