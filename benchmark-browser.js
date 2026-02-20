const path = require("node:path");

const { chromium } = require("playwright");

const APP_URL = `file://${path.join(__dirname, "index.html")}`;
const ROOM_RENDER_TICK_MS = Number(process.env.BENCH_ROOM_RENDER_TICK_MS || 1000);
const MULTIPLAYER_POLL_MS = Number(process.env.BENCH_POLL_MS || 1100);
const MULTIPLAYER_TIMER_TICK_MS = Number(process.env.BENCH_TIMER_TICK_MS || 500);
const PLAYER_COUNT = Number(process.env.BENCH_PLAYERS || 64);
const BENCH_DURATION_MS = Number(process.env.BENCH_DURATION_MS || 9000);
const BENCH_WARMUP_MS = Number(process.env.BENCH_WARMUP_MS || 1500);
const BENCH_SAMPLES = Number(process.env.BENCH_SAMPLES || 3);
const BENCH_ROOM_CODE = process.env.BENCH_ROOM_CODE || "R-PLAY";
const BENCH_NET_BASE_LATENCY_MS = Number(process.env.BENCH_NET_LATENCY_MS || 45);
const BENCH_NET_JITTER_MS = Number(process.env.BENCH_NET_JITTER_MS || 15);

const HOST_ID = "p-host";
const HOST_NAME = "Host";

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[idx];
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctDiff(base, improved) {
  if (!base || base <= 0) return 0;
  return ((base - improved) / base) * 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneRoom(room) {
  return JSON.parse(JSON.stringify(room));
}

function createRoom(playerCount) {
  const players = {};
  for (let i = 0; i < playerCount; i += 1) {
    players[`p-${i}`] = {
      name: `Player ${i}`,
      score: 100 + i,
      solved: i % 3 === 0,
    };
  }
  return {
    code: BENCH_ROOM_CODE,
    hostId: HOST_ID,
    hostName: HOST_NAME,
    mode: "unlimited",
    difficulty: "normal",
    hintIndex: 0,
    hintText: "hint-0",
    status: "active",
    currentSongId: "s2",
    currentSongStart: Date.now(),
    roundEndsAt: Date.now() + 60_000,
    round: 1,
    players,
  };
}

function roomPlayersFingerprint(players) {
  return Object.entries(players || {})
    .map(([id, profile]) => `${id}:${profile.name}:${profile.score}:${profile.solved ? 1 : 0}`)
    .join("|");
}

function applyContinuousMutations(room, playerCount, iteration) {
  const playerId = `p-${iteration % playerCount}`;
  const player = room.players[playerId];
  player.score += 1 + (iteration % 5);
  player.solved = iteration % 2 === 0;
  room.hintIndex = iteration % 6;
  room.currentSongId = `s${((iteration + 1) % 7) + 1}`;
  room.hintText = `hint-${iteration % 9}`;
  room.roundEndsAt = Date.now() + 60_000;
  room.currentSongStart = Date.now();
}

function applyOccasionalMutations(room, playerCount, iteration) {
  if (iteration % 12 !== 0) return;
  const playerId = `p-${iteration % playerCount}`;
  const player = room.players[playerId];
  player.score += 1 + (iteration % 7);
  player.solved = !player.solved;
  room.hintIndex = (iteration % 6) + 1;
  room.hintText = `hint-${iteration % 9}`;
  room.roundEndsAt = Date.now() + 60_000;
}

function mutateRoomState(room, iteration, playerCount, scenario) {
  if (scenario === "timerOnly") {
    if (room.roundEndsAt <= Date.now() + 1000) {
      room.roundEndsAt = Date.now() + 60_000;
    }
    return;
  }
  if (scenario === "occasionalPlayerUpdates") {
    applyOccasionalMutations(room, playerCount, iteration);
  } else if (scenario === "continuousChanges") {
    applyContinuousMutations(room, playerCount, iteration);
  }
}

function createRouteState(scenario, playerCount) {
  return {
    scenario,
    startedAt: Date.now(),
    playerCount,
    pollIndex: 0,
    room: createRoom(playerCount),
    requestCount: 0,
  };
}

function maybeMutateRouteState(state, now, requestPath) {
  const { room } = state;
  if (requestPath !== `rooms/${room.code}/state`) {
    return;
  }
  const elapsedMs = Math.max(0, now - state.startedAt);
  const currentPoll = Math.floor(elapsedMs / MULTIPLAYER_POLL_MS);
  while (state.pollIndex < currentPoll) {
    state.pollIndex += 1;
    mutateRoomState(room, state.pollIndex, state.playerCount, state.scenario);
  }
}

function routeDelay() {
  const jitter = (Math.random() * 2 - 1) * BENCH_NET_JITTER_MS;
  return Math.max(0, BENCH_NET_BASE_LATENCY_MS + jitter);
}

function buildMockApiResponder() {
  return async function apiResponder(route, state) {
    const latency = routeDelay();
    const request = route.request();
    const parsed = new URL(request.url());
    const pathname = parsed.pathname;

    await sleep(latency);

    const json = (status, body) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (!state) {
      return json(503, {
        ok: false,
        error: "no active benchmark scenario",
      });
    }

    state.requestCount += 1;
    if (pathname === "/api/health") {
      return json(200, {
        ok: true,
        service: "songless-benchmark",
      });
    }

    const stateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/state$/);
    if (stateMatch) {
      const requestedCode = stateMatch[1];
      if (requestedCode !== BENCH_ROOM_CODE) {
        return json(404, { ok: false, error: "room not found" });
      }
      maybeMutateRouteState(state, Date.now(), `rooms/${requestedCode}/state`);
      return json(200, {
        ok: true,
        room: cloneRoom(state.room),
      });
    }

    return json(404, {
      ok: false,
      error: "unsupported benchmark endpoint",
    });
  };
}

async function runScenarioInBrowser(page, scenario, mode, sampleIndex) {
  return page.evaluate(
    async (config) => {
      const {
        mode,
        scenario,
        durationMs,
        warmupMs,
        roomCode,
        roomRenderTickMs,
        timerTickMs,
        hostId,
        hostName,
        sampleIndex: sample,
      } = config;

      const el = {
        roomCodeView: document.getElementById("roomCodeView"),
        roomModeView: document.getElementById("roomModeView"),
        roomHintView: document.getElementById("roomHintView"),
        roomSongView: document.getElementById("roomSongView"),
        roomStatus: document.getElementById("roomStatus"),
        roomPlayers: document.getElementById("roomPlayers"),
        startRoomBtn: document.getElementById("startRoomBtn"),
        nextRoundBtn: document.getElementById("nextRoundBtn"),
        mpFeedback: document.getElementById("mpFeedback"),
        mpTimer: document.getElementById("mpTimer"),
        mpSkipBtn: document.getElementById("mpSkipBtn"),
        mpGuessBtn: document.getElementById("mpGuessBtn"),
        mpTitleGuess: document.getElementById("mpTitleGuess"),
        mpArtistGuess: document.getElementById("mpArtistGuess"),
      };

      function mean(values) {
        if (!values.length) return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      }

      function percentile(values, p) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
        return sorted[idx];
      }

      function safeTextValue(value) {
        return value == null ? "" : String(value);
      }

      function setTextRaw(element, value) {
        if (element) element.textContent = safeTextValue(value);
      }

      function setDisabledRaw(element, disabled) {
        if (element) element.disabled = disabled;
      }

      function setTextIfChanged(element, value) {
        if (element && element.textContent !== value) {
          element.textContent = value;
        }
      }

      function setDisabledIfChanged(element, disabled) {
        if (element && element.disabled !== disabled) {
          element.disabled = disabled;
        }
      }

      function roomPlayersFingerprint(players) {
        return Object.entries(players || {})
          .map(([id, profile]) => `${id}:${profile.name}:${profile.score}:${profile.solved ? 1 : 0}`)
          .join("|");
      }

      function setRoomPlayersNaive(players, roomRenderState) {
        const nextFingerprint = roomPlayersFingerprint(players);
        if (nextFingerprint === roomRenderState.playersFingerprint) return;
        roomRenderState.playersFingerprint = nextFingerprint;

        if (!el.roomPlayers) return;
        el.roomPlayers.innerHTML = "";
        const frag = document.createDocumentFragment();
        Object.values(players || {}).forEach((profile) => {
          const row = document.createElement("tr");
          row.innerHTML = `<td>${profile.name}</td><td>${profile.score}</td><td>${profile.solved ? "solved" : "trying"}</td>`;
          frag.append(row);
        });
        el.roomPlayers.append(frag);
      }

      function setRoomMetaNaive(room, isHost, isActive, roomRenderState) {
        const now = Date.now();
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
          setTextRaw(el.roomCodeView, `Code: ${room.code}`);
          setTextRaw(el.roomModeView, `Mode: ${room.mode}`);
          setTextRaw(el.roomHintView, `Hint index: ${room.hintIndex || 0}`);
          setTextRaw(el.roomSongView, room.currentSongId ? `Song: ${room.currentSongId}` : "Song: --");
          setTextRaw(
            el.roomStatus,
            `Players: ${Object.keys(players).length} | Host: ${isHost ? "you" : room.hostName}`,
          );
          setDisabledRaw(el.startRoomBtn, !isHost || room.status !== "lobby");
          setDisabledRaw(el.nextRoundBtn, !isHost || room.status !== "active");

          if (isActive) {
            setTextRaw(el.mpFeedback, `Hint: ${room.hintText || "--"}`);
            setDisabledRaw(el.mpSkipBtn, !isHost);
            setDisabledRaw(el.mpGuessBtn, false);
            setDisabledRaw(el.mpTitleGuess, false);
            setDisabledRaw(el.mpArtistGuess, false);
            if (!window.mpState) {
              window.mpState = window.mpStateFromDefaults ? window.mpStateFromDefaults() : {};
            }
            if (window.mpState.roundEndsAt !== (room.roundEndsAt || 0)) {
              window.mpState.timerSecond = -1;
            }
            window.mpState.roundEndsAt = room.roundEndsAt || 0;
            window.mpState.running = true;
            if (!window.mpTick) {
              window.mpTick = setInterval(() => window.syncMpTimer(), timerTickMs);
            }
          } else {
            setTextRaw(el.mpFeedback, `Room ${room.status === "lobby" ? "waiting" : "done"}`);
            setTextRaw(el.mpTimer, "Timer: --");
            setDisabledRaw(el.mpSkipBtn, true);
            setDisabledRaw(el.mpGuessBtn, true);
            setDisabledRaw(el.mpTitleGuess, true);
            setDisabledRaw(el.mpArtistGuess, true);
            if (window.mpState) {
              window.mpState.running = false;
              window.mpState.timerSecond = -1;
            }
            if (window.mpTick) {
              clearInterval(window.mpTick);
              window.mpTick = null;
            }
          }
          setRoomPlayersNaive(players, roomRenderState);
        } else if (now - roomRenderState.lastMetaRenderAt >= roomRenderTickMs) {
          roomRenderState.lastMetaRenderAt = now;
          setTextIfChanged(el.roomStatus, `Players: ${Object.keys(players).length} | Host: ${isHost ? "you" : room.hostName}`);
          setTextIfChanged(el.roomSongView, room.currentSongId ? `Song: ${room.currentSongId}` : "Song: --");
        }
      }

      function applyRoomStateNaive(room, roomRenderState) {
        const isHost = room.hostId === hostId;
        const isActive = room.status === "active" && room.currentSongId;
        setRoomMetaNaive(room, isHost, isActive, roomRenderState);
        setRoomPlayersNaive(room.players || {}, roomRenderState);
      }

      function nowInSample(start, end, now) {
        return now >= start && now <= end;
      }

      if (
        !el.roomCodeView ||
        !el.roomModeView ||
        !el.roomHintView ||
        !el.roomSongView ||
        !el.roomStatus ||
        !el.roomPlayers ||
        !window.applyRoomState ||
        !window.syncMpTimer ||
        !window.requestMp ||
        !window.setupRoomPolling
      ) {
        return {
          sample,
          mode,
          scenario,
          error: "multiplayer runtime not initialized",
          durationMs: 0,
          roomUpdateCount: 0,
          timerTickCount: 0,
          roomRenderMeanMs: 0,
          roomRenderP95Ms: 0,
          roomRenderP99Ms: 0,
          roomRenderMaxMs: 0,
          timerMeanMs: 0,
          timerP95Ms: 0,
          timerP99Ms: 0,
          timerMaxMs: 0,
          frameP95Ms: 0,
          frameP99Ms: 0,
          frameCount: 0,
          droppedFrames: 0,
          layoutReads: 0,
          mutationCounts: { childList: 0, attributes: 0, characterData: 0, added: 0, removed: 0 },
          longTaskCount: 0,
          longTaskP95Ms: 0,
          longTaskMaxMs: 0,
        };
      }

      if (typeof window.stopRoomStreaming === "function") {
        window.stopRoomStreaming();
      }
      if (typeof window.mpTick !== "undefined" && window.mpTick) {
        clearInterval(window.mpTick);
        window.mpTick = null;
      }

      console.log(`[bench] start sample=${sample} scenario=${scenario} mode=${mode}`);

      if (!window.mpStateFromDefaults) {
        return {
          sample,
          mode,
          scenario,
          error: "runtime helper mpStateFromDefaults unavailable",
          durationMs: 0,
          roomUpdateCount: 0,
          timerTickCount: 0,
          roomRenderMeanMs: 0,
          roomRenderP95Ms: 0,
          roomRenderP99Ms: 0,
          roomRenderMaxMs: 0,
          timerMeanMs: 0,
          timerP95Ms: 0,
          timerP99Ms: 0,
          timerMaxMs: 0,
          frameP95Ms: 0,
          frameP99Ms: 0,
          frameCount: 0,
          droppedFrames: 0,
          layoutReads: 0,
          mutationCounts,
          longTaskCount: longTaskDurations.length,
          longTaskP95Ms: percentile(longTaskDurations, 95),
          longTaskMaxMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
        };
      }

      window.mpState = window.mpStateFromDefaults();
      window.mpState.roomCode = roomCode;
      window.mpState.roundEndsAt = Date.now() + 60_000;
      window.mpState.timerSecond = -1;
      window.mpState.running = false;
      if (typeof window.resetRoomRenderState === "function") {
        window.resetRoomRenderState();
      }

      const roomRenderState = {
        metaFingerprint: "",
        playersFingerprint: "",
        lastMetaRenderAt: 0,
      };

      const mutationCounts = {
        childList: 0,
        attributes: 0,
        characterData: 0,
        added: 0,
        removed: 0,
      };
      const frameTimes = [];
      const roomRenderDurations = [];
      const timerDurations = [];
      let roomUpdateCount = 0;
      let timerTickCount = 0;
      let layoutReads = 0;
      let scenarioError = null;

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "childList") {
            mutationCounts.childList += 1;
            mutationCounts.added += record.addedNodes.length;
            mutationCounts.removed += record.removedNodes.length;
          } else if (record.type === "characterData") {
            mutationCounts.characterData += 1;
          } else if (record.type === "attributes") {
            mutationCounts.attributes += 1;
          }
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      let longTaskDurations = [];
      let longTaskObserver = null;
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskDurations.push(entry.duration);
          }
        });
        longTaskObserver.observe({ type: "longtask", buffered: true });
      } catch {
        longTaskObserver = null;
      }

      const originalApplyRoomState = window.applyRoomState;
      const originalSyncMpTimer = window.syncMpTimer;
      const start = performance.now();
      const runStart = start + warmupMs;
      const runEnd = runStart + durationMs;
      const stopAt = runEnd + 250;
      let lastFrame = start;

      function applyRoomStateBench(room) {
        const inSample = nowInSample(runStart, runEnd, performance.now());
        const before = performance.now();
        if (mode === "naive") {
          applyRoomStateNaive(room, roomRenderState);
        } else {
          originalApplyRoomState(room);
        }
        const after = performance.now();
        if (inSample && !scenarioError) {
          roomUpdateCount += 1;
          roomRenderDurations.push(after - before);
          if ((roomUpdateCount & 3) === 0) {
            layoutReads += (el.roomStatus?.offsetHeight || 0) + (el.roomPlayers?.offsetHeight || 0);
          }
        }
      }

      function syncMpTimerBench() {
        const inSample = nowInSample(runStart, runEnd, performance.now());
        const before = performance.now();
        originalSyncMpTimer();
        const after = performance.now();
        if (inSample && !scenarioError) {
          timerTickCount += 1;
          timerDurations.push(after - before);
        }
      }

      function onFrame(now) {
        if (now >= runStart && now <= runEnd) {
          frameTimes.push(now - lastFrame);
        }
        lastFrame = now;
        if (now < runEnd + 125) {
          requestAnimationFrame(onFrame);
        }
      }

      requestAnimationFrame(onFrame);
      window.applyRoomState = (room) => {
        try {
          applyRoomStateBench(room);
        } catch (error) {
          scenarioError = error ? String(error.message || error) : "unknown error";
        }
      };
      window.syncMpTimer = () => {
        if (scenarioError) return;
        try {
          syncMpTimerBench();
        } catch (error) {
          scenarioError = error ? String(error.message || error) : "unknown error";
        }
      };

      try {
        const initial = await window.requestMp(`/rooms/${roomCode}/state`);
        if (!initial?.room) {
          throw new Error("initial room state missing");
        }
        window.applyRoomState(initial.room);
        window.setupRoomPolling(roomCode);
        console.log(`[bench] baseline captured sample=${sample} scenario=${scenario} mode=${mode}`);
      } catch (error) {
        console.log(`[bench] init-failed sample=${sample} scenario=${scenario} mode=${mode}: ${error?.message || error}`);
        window.applyRoomState = originalApplyRoomState;
        window.syncMpTimer = originalSyncMpTimer;
        observer.disconnect();
        if (longTaskObserver) longTaskObserver.disconnect();
        if (typeof window.stopRoomStreaming === "function") {
          window.stopRoomStreaming();
        }
        return {
          sample,
          mode,
          scenario,
          durationMs: 0,
          roomUpdateCount: 0,
          timerTickCount: 0,
          roomRenderMeanMs: 0,
          roomRenderP95Ms: 0,
          roomRenderP99Ms: 0,
          roomRenderMaxMs: 0,
          timerMeanMs: 0,
          timerP95Ms: 0,
          timerP99Ms: 0,
          timerMaxMs: 0,
          frameP95Ms: 0,
          frameP99Ms: 0,
          frameCount: 0,
          droppedFrames: 0,
          layoutReads: 0,
          mutationCounts,
          longTaskCount: longTaskDurations.length,
          longTaskP95Ms: percentile(longTaskDurations, 95),
          longTaskMaxMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
          error: error ? String(error.message || error) : "initial room request failed",
        };
      }

      return await new Promise((resolve) => {
        setTimeout(() => {
          console.log(`[bench] complete sample=${sample} scenario=${scenario} mode=${mode}`);
          if (window.stopRoomStreaming) {
            window.stopRoomStreaming();
          }
          if (window.mpTick) {
            clearInterval(window.mpTick);
            window.mpTick = null;
          }
          window.applyRoomState = originalApplyRoomState;
          window.syncMpTimer = originalSyncMpTimer;
          observer.disconnect();
          if (longTaskObserver) longTaskObserver.disconnect();

          if (scenarioError) {
            resolve({
              sample,
              mode,
              scenario,
              durationMs: 0,
              roomUpdateCount: 0,
              timerTickCount: 0,
              roomRenderMeanMs: 0,
              roomRenderP95Ms: 0,
              roomRenderP99Ms: 0,
              roomRenderMaxMs: 0,
              timerMeanMs: 0,
              timerP95Ms: 0,
              timerP99Ms: 0,
              timerMaxMs: 0,
              frameP95Ms: 0,
              frameP99Ms: 0,
              frameCount: 0,
              droppedFrames: 0,
              layoutReads: 0,
              mutationCounts,
              longTaskCount: longTaskDurations.length,
              longTaskP95Ms: percentile(longTaskDurations, 95),
              longTaskMaxMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
              error: scenarioError,
            });
            return;
          }

          const sampleDurationMs = Math.max(runEnd - runStart, 1);
          const frames = frameTimes.filter((value) => Number.isFinite(value) && value >= 0);
          const droppedFrames = frames.filter((value) => value > 16.6667).length;

          resolve({
            sample,
            mode,
            scenario,
            durationMs: sampleDurationMs,
            roomUpdateCount,
            timerTickCount,
            roomRenderMeanMs: mean(roomRenderDurations),
            roomRenderP95Ms: percentile(roomRenderDurations, 95),
            roomRenderP99Ms: percentile(roomRenderDurations, 99),
            roomRenderMaxMs: roomRenderDurations.length ? Math.max(...roomRenderDurations) : 0,
            timerMeanMs: mean(timerDurations),
            timerP95Ms: percentile(timerDurations, 95),
            timerP99Ms: percentile(timerDurations, 99),
            timerMaxMs: timerDurations.length ? Math.max(...timerDurations) : 0,
            frameP95Ms: percentile(frames, 95),
            frameP99Ms: percentile(frames, 99),
            frameCount: frames.length,
            droppedFrames,
            layoutReads,
            mutationCounts,
            longTaskCount: longTaskDurations.length,
            longTaskP95Ms: percentile(longTaskDurations, 95),
            longTaskMaxMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
          });
        }, stopAt);
      });
    },
    {
      scenario,
      mode,
      durationMs: BENCH_DURATION_MS,
      warmupMs: BENCH_WARMUP_MS,
      roomCode: BENCH_ROOM_CODE,
      timerTickMs: MULTIPLAYER_TIMER_TICK_MS,
      hostId: HOST_ID,
      hostName: HOST_NAME,
      roomRenderTickMs: ROOM_RENDER_TICK_MS,
      sampleIndex,
    },
  );
}

function summarizeScenario(samples, scenario, mode) {
  const filtered = samples.filter((entry) => entry.scenario === scenario && entry.mode === mode);
  const updatesPerSecond = filtered.map((s) => s.roomUpdateCount / (s.durationMs / 1000));
  return {
    count: filtered.length,
    updatesPerSecond,
    roomRenderAvgMs: mean(filtered.map((s) => s.roomRenderMeanMs)),
    roomRenderP95: mean(filtered.map((s) => s.roomRenderP95Ms)),
    roomRenderP99: mean(filtered.map((s) => s.roomRenderP99Ms)),
    frameP95: mean(filtered.map((s) => s.frameP95Ms)),
    frameP99: mean(filtered.map((s) => s.frameP99Ms)),
    droppedFrames: mean(filtered.map((s) => s.droppedFrames)),
    layoutReads: mean(filtered.map((s) => s.layoutReads)),
    childMutations: mean(filtered.map((s) => s.mutationCounts.childList)),
    longTasks: mean(filtered.map((s) => s.longTaskCount)),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[page] ${message.text()}`);
      return;
    }
    const text = message.text();
    if (text.startsWith("[bench]")) {
      console.log(`[page] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${error.message}`);
  });

  const apiResponder = buildMockApiResponder();
  let activeRouteState = null;

  await page.route("**/api/**", async (route) => {
    const state = activeRouteState;
    return apiResponder(route, state);
  });

  await page.addInitScript(() => {
    localStorage.setItem("songless_clone_mp_api_v1", "http://127.0.0.1:1/api");
    localStorage.setItem(
      "songless_clone_state_v1",
      JSON.stringify({
        profile: {
          id: "p-host",
          name: "Host",
          friendCode: "HOST01",
          bestScore: 0,
          totalScore: 0,
          streak: 0,
          totalCorrect: 0,
          totalPlayed: 0,
          achievements: [],
        },
      }),
    );
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  await page.click('button[data-tab="multiplayer"]');

  const scenarios = process.env.BENCH_SCENARIOS
    ? process.env.BENCH_SCENARIOS.split(",").map((value) => value.trim()).filter(Boolean)
    : ["timerOnly", "occasionalPlayerUpdates", "continuousChanges"];
  const modes = process.env.BENCH_MODES
    ? process.env.BENCH_MODES.split(",").map((value) => value.trim()).filter(Boolean)
    : ["naive", "optimized"];
  const results = [];

  for (const scenario of scenarios) {
    for (const mode of modes) {
      for (let sample = 1; sample <= BENCH_SAMPLES; sample += 1) {
        console.log(`Starting ${scenario}/${mode}/sample-${sample}`);
        activeRouteState = createRouteState(scenario, PLAYER_COUNT);
        let result;
        try {
          result = await runScenarioInBrowser(page, scenario, mode, sample);
        } catch (error) {
          console.error(`Failed to execute scenario: ${scenario}/${mode}/sample-${sample}: ${error.message}`);
          await browser.close();
          process.exit(1);
        } finally {
          activeRouteState = null;
          await page.evaluate(() => {
            if (typeof window.stopRoomStreaming === "function") window.stopRoomStreaming();
            if (window.mpTick) {
              clearInterval(window.mpTick);
              window.mpTick = null;
            }
          });
        }

        if (!result) {
          console.error(`Empty benchmark result: ${scenario}/${mode}/sample-${sample}`);
          await browser.close();
          process.exit(1);
        }
        results.push(result);
        if (result.error) {
          console.error(`Benchmark scenario failed: ${scenario}/${mode}/sample-${sample}: ${result.error}`);
          await browser.close();
          process.exit(1);
        }
      }
    }
  }

  await browser.close();

  console.log("Multiplayer room-render benchmark (realistic API)");
  console.log(
    `durationMs=${BENCH_DURATION_MS} warmupMs=${BENCH_WARMUP_MS} samples=${BENCH_SAMPLES} players=${PLAYER_COUNT}`,
  );
  console.log(
    `pollMs=${MULTIPLAYER_POLL_MS} timerTickMs=${MULTIPLAYER_TIMER_TICK_MS} networkLatency=${BENCH_NET_BASE_LATENCY_MS}±${BENCH_NET_JITTER_MS}ms`,
  );
  console.log("");

  for (const scenario of scenarios) {
    const naive = summarizeScenario(results, scenario, "naive");
    const optimized = summarizeScenario(results, scenario, "optimized");
    const naiveUpdateMean = mean(naive.updatesPerSecond);
    const optimizedUpdateMean = mean(optimized.updatesPerSecond);

    console.log(`Scenario: ${scenario}`);
    for (const mode of modes) {
      const summary = summarizeScenario(results, scenario, mode);
      const updatesPerSecond = summary.updatesPerSecond.map((value) => value).sort((a, b) => a - b);
      const upMedian = percentile(updatesPerSecond, 50);
      const upP95 = percentile(updatesPerSecond, 95);
      console.log(`  ${mode}:`);
      console.log(
        `    updates/sec: median ${upMedian.toFixed(2)} p95 ${upP95.toFixed(2)} (samples=${summary.count})`,
      );
      console.log(
        `    roomRender mean/p95/p99: ${summary.roomRenderAvgMs.toFixed(4)} / ${summary.roomRenderP95.toFixed(4)} / ${summary.roomRenderP99.toFixed(4)}`,
      );
      console.log(`    frames p95/p99: ${summary.frameP95.toFixed(3)}ms / ${summary.frameP99.toFixed(3)}ms`);
      console.log(`    dropped frames (>16.7ms): ${summary.droppedFrames.toFixed(2)}`);
      console.log(
        `    layoutReads: ${summary.layoutReads.toFixed(2)} | row mutations: ${summary.childMutations.toFixed(2)} | long tasks: ${summary.longTasks.toFixed(2)}`,
      );
    }
    console.log(
      `  updates/sec improvement: ${pctDiff(naiveUpdateMean, optimizedUpdateMean).toFixed(1)}% (naive ${naiveUpdateMean.toFixed(2)} -> optimized ${optimizedUpdateMean.toFixed(2)})`,
    );
    console.log(
      `  roomRender cost improvement: ${pctDiff(naive.roomRenderAvgMs || 0, optimized.roomRenderAvgMs || 0).toFixed(1)}%`,
    );
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
