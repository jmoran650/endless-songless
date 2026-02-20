const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT_FALLBACK = 0;

let serverProcess;
let baseUrl;

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT_FALLBACK) };
    serverProcess = spawn(process.execPath, [path.resolve(__dirname, "..", "server.js")], {
      cwd: path.resolve(__dirname, ".."),
      env,
    });

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        reject(new Error("Server did not start within timeout."));
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

    serverProcess.stdout.on("data", onOutput);
    serverProcess.on("error", (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    serverProcess.on("exit", (code, signal) => {
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

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  return {
    status: response.status,
    payload,
  };
}

before(async () => {
  await startBackend();
});

after(() => {
  stopBackend();
});

test("health endpoint responds with ok", async () => {
  const { status, payload } = await request("/api/health");
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
});

test("invalid room codes return 404", async () => {
  const { status } = await request("/api/rooms/ZZZZZZ/state");
  assert.equal(status, 404);
});

test("room lifecycle with create, join, start, guess, skip, and leave", async () => {
  const host = { id: "p-host", name: "Host Player" };
  const guest = { id: "p-guest", name: "Guest Player" };

  const createRes = await request("/api/rooms", {
    method: "POST",
    body: {
      player: host,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(createRes.status, 201);
  const roomCode = createRes.payload.room.code;
  assert.equal(roomCode.length, 6);

  const joinRes = await request(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: {
      player: guest,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(joinRes.status, 200);
  assert.equal(joinRes.payload.room.players[guest.id].name, guest.name);

  const forbiddenStart = await request(`/api/rooms/${roomCode}/start`, {
    method: "POST",
    body: {
      player: guest,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(forbiddenStart.status, 403);

  const startRes = await request(`/api/rooms/${roomCode}/start`, {
    method: "POST",
    body: {
      player: host,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(startRes.status, 200);
  assert.equal(startRes.payload.room.status, "active");
  const initialHint = startRes.payload.room.hintIndex;

  const wrongGuess = await request(`/api/rooms/${roomCode}/guess`, {
    method: "POST",
    body: {
      player: guest,
      title: "wrong-title",
      artist: "wrong-artist",
    },
  });
  assert.equal(wrongGuess.status, 200);
  assert.equal(wrongGuess.payload.solved, false);

  const skipRes = await request(`/api/rooms/${roomCode}/skip`, {
    method: "POST",
    body: {
      player: host,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(skipRes.status, 200);
  assert.equal(skipRes.payload.room.hintIndex, initialHint + 1);

  const leaveRes = await request(`/api/rooms/${roomCode}/leave`, {
    method: "POST",
    body: {
      player: guest,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(leaveRes.status, 200);

  const stateRes = await request(`/api/rooms/${roomCode}/state`);
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.payload.room.players[guest.id], undefined);
});

test("last player leaves -> room removed", async () => {
  const host = { id: "p-alone", name: "Lone Host" };

  const createRes = await request("/api/rooms", {
    method: "POST",
    body: {
      player: host,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(createRes.status, 201);
  const roomCode = createRes.payload.room.code;

  const leaveRes = await request(`/api/rooms/${roomCode}/leave`, {
    method: "POST",
    body: {
      player: host,
      mode: "unlimited",
      difficulty: "normal",
      genre: "Any",
      decade: "Any",
    },
  });
  assert.equal(leaveRes.status, 200);
  assert.equal(leaveRes.payload.room, null);

  const stateRes = await request(`/api/rooms/${roomCode}/state`);
  assert.equal(stateRes.status, 404);
});
