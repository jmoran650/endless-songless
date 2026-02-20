const ROOM_RENDER_TICK_MS = 1000;
const DEFAULT_ITERATIONS = 20000;
const DEFAULT_PLAYER_COUNT = 64;
const HOST_ID = "p-host";

const iterations = Number(process.env.BENCH_ITERATIONS || DEFAULT_ITERATIONS);
const playerCount = Number(process.env.BENCH_PLAYERS || DEFAULT_PLAYER_COUNT);

const counters = {
  textWrites: 0,
  disabledWrites: 0,
  appendWrites: 0,
  replaceWrites: 0,
  innerHTMLWrites: 0,
};

function createElement(name) {
  return {
    name,
    _textContent: "",
    _disabled: false,
    _innerHTML: "",
    _children: [],
    set textContent(value) {
      counters.textWrites += 1;
      this._textContent = String(value);
    },
    get textContent() {
      return this._textContent;
    },
    set disabled(value) {
      counters.disabledWrites += 1;
      this._disabled = Boolean(value);
    },
    get disabled() {
      return this._disabled;
    },
    set innerHTML(value) {
      counters.innerHTMLWrites += 1;
      this._innerHTML = String(value);
      this._children = [];
    },
    get innerHTML() {
      return this._innerHTML;
    },
    append(node) {
      counters.appendWrites += 1;
      this._children.push(node);
    },
    replaceChildren(...nodes) {
      counters.replaceWrites += 1;
      this._children = nodes.slice();
    },
  };
}

function createElements() {
  return {
    roomCodeView: createElement("roomCodeView"),
    roomModeView: createElement("roomModeView"),
    roomHintView: createElement("roomHintView"),
    roomSongView: createElement("roomSongView"),
    roomStatus: createElement("roomStatus"),
    roomPlayers: createElement("roomPlayers"),
    startRoomBtn: createElement("startRoomBtn"),
    nextRoundBtn: createElement("nextRoundBtn"),
    mpFeedback: createElement("mpFeedback"),
    mpTimer: createElement("mpTimer"),
    mpSkipBtn: createElement("mpSkipBtn"),
    mpGuessBtn: createElement("mpGuessBtn"),
    mpTitleGuess: createElement("mpTitleGuess"),
    mpArtistGuess: createElement("mpArtistGuess"),
  };
}

function resetCounters() {
  counters.textWrites = 0;
  counters.disabledWrites = 0;
  counters.appendWrites = 0;
  counters.replaceWrites = 0;
  counters.innerHTMLWrites = 0;
}

function snapshotCounters() {
  return { ...counters };
}

function setTextIfChanged(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setDisabledIfChanged(element, disabled) {
  if (element && element.disabled !== disabled) element.disabled = disabled;
}

function createRoomRenderState() {
  return {
    metaFingerprint: "",
    playersFingerprint: "",
    lastMetaRenderAt: 0,
  };
}

function roomPlayersFingerprint(players) {
  const entries = Object.entries(players || {});
  return entries.map(([id, profile]) => `${id}:${profile.name}:${profile.score}:${profile.solved ? 1 : 0}`).join("|");
}

function setRoomPlayers(elements, players, roomRenderState) {
  const nextFingerprint = roomPlayersFingerprint(players);
  if (nextFingerprint === roomRenderState.playersFingerprint) return;
  roomRenderState.playersFingerprint = nextFingerprint;
  const rows = [];
  Object.values(players || {}).forEach((profile) => {
    const row = {
      innerHTML: `<td>${profile.name}</td><td>${profile.score}</td><td>${profile.solved ? "solved" : "trying"}</td>`,
    };
    rows.push(row);
  });
  elements.roomPlayers.replaceChildren(...rows);
}

function setRoomMetaFromRoom(elements, room, isHost, isActive, roomRenderState, nowRef) {
  const now = nowRef();
  const players = room.players || {};
  const nextFingerprint = [
    room.code,
    room.status,
    room.mode,
    room.difficulty,
    room.hintIndex || 0,
    room.currentSongId || "",
    isActive ? "active" : "inactive",
    isHost ? "host" : "guest",
    room.hostId,
    room.hostName || "",
    Object.keys(players).length,
  ].join("|");

  if (nextFingerprint !== roomRenderState.metaFingerprint) {
    roomRenderState.metaFingerprint = nextFingerprint;
    roomRenderState.lastMetaRenderAt = now;
    setTextIfChanged(elements.roomCodeView, `Code: ${room.code}`);
    setTextIfChanged(elements.roomModeView, `Mode: ${room.mode}`);
    setTextIfChanged(elements.roomHintView, `Hint index: ${room.hintIndex || 0}`);
    setTextIfChanged(elements.roomSongView, room.currentSongId ? `Song: ${room.currentSongId}` : "Song: --");
    setTextIfChanged(elements.roomStatus, `Players: ${Object.keys(players).length} | Host: ${isHost ? "you" : room.hostName}`);
    setDisabledIfChanged(elements.startRoomBtn, !isHost || room.status !== "lobby");
    setDisabledIfChanged(elements.nextRoundBtn, !isHost || room.status !== "active");
  } else if (now - roomRenderState.lastMetaRenderAt >= ROOM_RENDER_TICK_MS) {
    roomRenderState.lastMetaRenderAt = now;
    setTextIfChanged(elements.roomStatus, `Players: ${Object.keys(players).length} | Host: ${isHost ? "you" : room.hostName}`);
    setTextIfChanged(elements.roomSongView, room.currentSongId ? `Song: ${room.currentSongId}` : "Song: --");
  }

  setRoomPlayers(elements, players, roomRenderState);
}

function renderOptimized(elements, room, roomRenderState) {
  const isHost = room.hostId === HOST_ID;
  const isActive = room.status === "active" && room.currentSongId;
  setRoomMetaFromRoom(elements, room, isHost, isActive, roomRenderState, () => Date.now());
  if (room.status === "active" && room.currentSongId) {
    // timer/audio behavior intentionally omitted in this benchmark.
    setTextIfChanged(elements.mpFeedback, `Hint: ${room.hintText || "--"}`);
    setDisabledIfChanged(elements.mpGuessBtn, false);
    setDisabledIfChanged(elements.mpTitleGuess, false);
    setDisabledIfChanged(elements.mpArtistGuess, false);
    setDisabledIfChanged(elements.mpSkipBtn, !isHost);
  } else {
    setTextIfChanged(elements.mpFeedback, `Room ${room.status === "lobby" ? "waiting" : "done"}`);
    setTextIfChanged(elements.mpTimer, "Timer: --");
    setDisabledIfChanged(elements.mpSkipBtn, true);
    setDisabledIfChanged(elements.mpGuessBtn, true);
    setDisabledIfChanged(elements.mpTitleGuess, true);
    setDisabledIfChanged(elements.mpArtistGuess, true);
  }
}

function renderNaive(elements, room) {
  const isHost = room.hostId === HOST_ID;
  const isActive = room.status === "active" && room.currentSongId;
  elements.roomCodeView.textContent = `Code: ${room.code}`;
  elements.roomModeView.textContent = `Mode: ${room.mode}`;
  elements.roomHintView.textContent = `Hint index: ${room.hintIndex || 0}`;
  elements.roomSongView.textContent = room.currentSongId ? `Song: ${room.currentSongId}` : "Song: --";
  elements.roomStatus.textContent = `Players: ${Object.keys(room.players || {}).length} | Host: ${isHost ? "you" : room.hostName}`;
  elements.startRoomBtn.disabled = !isHost || room.status !== "lobby";
  elements.nextRoundBtn.disabled = !isHost || room.status !== "active";

  elements.roomPlayers.innerHTML = "";
  const players = room.players || {};
  Object.values(players).forEach((profile) => {
    const row = { innerHTML: `<td>${profile.name}</td><td>${profile.score}</td><td>${profile.solved ? "solved" : "trying"}</td>` };
    elements.roomPlayers.append(row);
  });

  if (isActive) {
    elements.mpGuessBtn.disabled = false;
    elements.mpTitleGuess.disabled = false;
    elements.mpArtistGuess.disabled = false;
    elements.mpSkipBtn.disabled = !isHost;
    elements.mpFeedback.textContent = `Hint: ${room.hintText || "--"}`;
  } else {
    elements.mpFeedback.textContent = `Room ${room.status === "lobby" ? "waiting" : "done"}`;
    elements.mpTimer.textContent = "Timer: --";
    elements.mpSkipBtn.disabled = true;
    elements.mpGuessBtn.disabled = true;
    elements.mpTitleGuess.disabled = true;
    elements.mpArtistGuess.disabled = true;
  }
}

function makeBaseRoom() {
  const players = {};
  for (let i = 0; i < playerCount; i += 1) {
    players[`p-${i}`] = {
      name: `Player ${i}`,
      score: 100 + i,
      solved: i % 3 === 0,
    };
  }
  return {
    code: "R-PLAY",
    hostId: HOST_ID,
    hostName: "Host",
    mode: "unlimited",
    difficulty: "normal",
    hintIndex: 0,
    status: "active",
    currentSongId: "s2",
    hintText: "hint",
    players,
  };
}

function mutateRoom(room, iteration, mode) {
  if (mode === "timerOnly") {
    return;
  }
  room.hintIndex = iteration % 6;
  room.status = iteration % 10 === 0 ? "lobby" : "active";
  if (mode === "occasionalPlayerUpdates") {
    if (iteration % 12 === 0) {
      const playerId = `p-${iteration % playerCount}`;
      const player = room.players[playerId];
      player.score += iteration % 7;
      player.solved = !player.solved;
    }
  }
  if (mode === "continuousChanges") {
    const playerId = `p-${iteration % playerCount}`;
    const player = room.players[playerId];
    player.score += 1;
    player.solved = iteration % 2 === 0;
    room.currentSongId = `s${((iteration + 1) % 7) + 1}`;
    room.hostName = iteration % 2 === 0 ? "Host" : "Host";
  }
}

function runScenario(name, renderer, roomMutator) {
  const elements = createElements();
  const roomRenderState = createRoomRenderState();
  const room = makeBaseRoom();
  const start = process.hrtime.bigint();

  resetCounters();
  for (let i = 0; i < iterations; i += 1) {
    mutateRoom(room, i, roomMutator);
    if (renderer === "optimized") {
      renderOptimized(elements, room, roomRenderState);
    } else {
      renderNaive(elements, room);
    }
  }
  const elapsedNs = process.hrtime.bigint() - start;
  const elapsedMs = Number(elapsedNs) / 1_000_000;

  const writes = snapshotCounters();
  const opsPerSecond = Math.round((iterations / elapsedMs) * 1000);
  console.log(`${name}`);
  console.log(`  mode: ${roomMutator}`);
  console.log(`  iterations: ${iterations}`);
  console.log(`  elapsedMs: ${elapsedMs.toFixed(2)}`);
  console.log(`  iterationsPerSecond: ${opsPerSecond}`);
  console.log(`  writes: ${JSON.stringify(writes)}`);
  return { elapsedMs, writes };
}

console.log("Multiplayer room-render benchmark");
console.log(`iterations=${iterations} players=${playerCount}`);
console.log("");

const baselineA = runScenario("naive - stable room (timer-only refresh)", "naive", "timerOnly");
const optimizedA = runScenario("optimized - stable room (timer-only refresh)", "optimized", "timerOnly");

const baselineB = runScenario("naive - occasional player updates", "naive", "occasionalPlayerUpdates");
const optimizedB = runScenario("optimized - occasional player updates", "optimized", "occasionalPlayerUpdates");

const baselineC = runScenario("naive - continuous changes", "naive", "continuousChanges");
const optimizedC = runScenario("optimized - continuous changes", "optimized", "continuousChanges");

function pctDiff(base, improved) {
  const msChange = ((base - improved) / base) * 100;
  return msChange.toFixed(1);
}

console.log("");
console.log("Summary");
console.log(`timerOnly runtime improvement: ${pctDiff(baselineA.elapsedMs, optimizedA.elapsedMs)}%`);
console.log(`occasional updates runtime improvement: ${pctDiff(baselineB.elapsedMs, optimizedB.elapsedMs)}%`);
console.log(`continuous updates runtime improvement: ${pctDiff(baselineC.elapsedMs, optimizedC.elapsedMs)}%`);
