const STATE_KEY = "songless_clone_state_v1";
const ROOM_KEY = "songless_clone_rooms_v1";
const DIRECTORY_KEY = "songless_clone_directory_v1";
const MULTIPLAYER_API_KEY = "songless_clone_mp_api_v1";
const AUTH_USERS_KEY = "songless_clone_auth_users_v1";
const AUTH_SESSIONS_KEY = "songless_clone_auth_session_v1";
const AUTH_USER_STATES_KEY = "songless_clone_auth_states_v1";
const AUTH_GUEST_STATE_KEY = "songless_clone_auth_guest_state_v1";
const SOUNDCLOUD_CLIENT_ID_KEY = "songless_clone_soundcloud_client_id_v1";
const SOUNDCLOUD_QUERY_KEY = "songless_clone_soundcloud_query_v1";
const SOUNDCLOUD_LIMIT_KEY = "songless_clone_soundcloud_limit_v1";
const MULTIPLAYER_POLL_MS = 1100;
const MULTIPLAYER_TIMER_TICK_MS = 500;
const GAME_TIMER_TICK_MS = 250;
const ROOM_RENDER_TICK_MS = 1000;
const MULTIPLAYER_FALLBACK_URL = `${window.location.protocol}//${window.location.hostname}:8080/api`;
const MULTIPLAYER_BASE_URL = localStorage.getItem(MULTIPLAYER_API_KEY) || MULTIPLAYER_FALLBACK_URL;
const SOUNDCLOUD_SEARCH_API = "https://api-v2.soundcloud.com/search/tracks";
const SOUNDCLOUD_DEFAULT_QUERY = "electronic pop songs";
const SOUNDCLOUD_DEFAULT_LIMIT = 30;
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_SONG_LIBRARY = [
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
let SONG_LIBRARY = [...DEFAULT_SONG_LIBRARY];

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

const STORY_CHAPTERS = [
  {
    id: "chapter-1",
    title: "Warmup: Pop Current",
    description: "Learn by guessing modern pop songs with short clips.",
    filters: { genre: "Pop", decade: "Any" },
    rounds: 4,
  },
  {
    id: "chapter-2",
    title: "Neon Rock Run",
    description: "Shift into guitar-led tracks with tighter clues.",
    filters: { genre: "Rock", decade: "Any" },
    rounds: 4,
  },
  {
    id: "chapter-3",
    title: "Old School Flashback",
    description: "A mixed set with older tracks and mixed hints.",
    filters: { genre: "Any", decade: "1980s" },
    rounds: 4,
  },
  {
    id: "chapter-4",
    title: "Cloudy Electronic",
    description: "Pulse through synthetic layers and beat-driven picks.",
    filters: { genre: "Electronic", decade: "Any" },
    rounds: 4,
  },
  {
    id: "chapter-5",
    title: "Indie Coda",
    description: "Final chapter, all styles with hardest timing.",
    filters: { genre: "Any", decade: "Any" },
    rounds: 4,
  },
];

const DEFAULT_ACHIEVEMENTS = [
  { id: "first-win", name: "First Win", text: "Solve your first round." },
  { id: "streak-3", name: "Small Run", text: "Reach a streak of 3." },
  { id: "streak-5", name: "Momentum", text: "Reach a streak of 5." },
  { id: "daily", name: "Daily Driver", text: "Finish the daily challenge." },
  { id: "story-1", name: "Chapter 1", text: "Finish Story chapter 1." },
  { id: "story-3", name: "Chapter 3", text: "Finish Story chapter 3." },
  { id: "story-5", name: "Full Story", text: "Finish all 5 story chapters." },
];

const elements = {
  tabs: [...document.querySelectorAll(".tab")],
  views: {
    play: document.getElementById("view-play"),
    story: document.getElementById("view-story"),
    leaderboard: document.getElementById("view-leaderboard"),
    multiplayer: document.getElementById("view-multiplayer"),
    friends: document.getElementById("view-friends"),
    settings: document.getElementById("view-settings"),
  },
  statusTicker: document.getElementById("statusTicker"),
  gameMode: document.getElementById("gameMode"),
  difficulty: document.getElementById("difficulty"),
  genreFilter: document.getElementById("genreFilter"),
  decadeFilter: document.getElementById("decadeFilter"),
  startGameBtn: document.getElementById("startGameBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  skipBtn: document.getElementById("skipBtn"),
  newRoundBtn: document.getElementById("newRoundBtn"),
  roundNote: document.getElementById("roundNote"),
  songClue: document.getElementById("songClue"),
  timerText: document.getElementById("timerText"),
  clipText: document.getElementById("clipText"),
  hintText: document.getElementById("hintText"),
  sessionScore: document.getElementById("sessionScore"),
  streakText: document.getElementById("streakText"),
  bestScoreText: document.getElementById("bestScoreText"),
  feedback: document.getElementById("feedback"),
  titleGuess: document.getElementById("titleGuess"),
  artistGuess: document.getElementById("artistGuess"),
  guessBtn: document.getElementById("guessBtn"),
  shareBtn: document.getElementById("shareBtn"),
  showAnswerBtn: document.getElementById("showAnswerBtn"),
  songAudio: document.getElementById("songAudio"),

  storyTitle: document.getElementById("storyTitle"),
  storyDescription: document.getElementById("storyDescription"),
  storyProgress: document.getElementById("storyProgress"),
  storyGoal: document.getElementById("storyGoal"),
  storyAdvanceBtn: document.getElementById("storyAdvanceBtn"),
  achievementList: document.getElementById("achievementList"),

  leaderboardAll: document.getElementById("leaderboardAll"),
  leaderboardDaily: document.getElementById("leaderboardDaily"),

  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  startRoomBtn: document.getElementById("startRoomBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  roomCodeView: document.getElementById("roomCodeView"),
  roomModeView: document.getElementById("roomModeView"),
  roomHintView: document.getElementById("roomHintView"),
  roomSongView: document.getElementById("roomSongView"),
  roomStatus: document.getElementById("roomStatus"),
  roomPlayers: document.getElementById("roomPlayers"),
  mpTitleGuess: document.getElementById("mpTitleGuess"),
  mpArtistGuess: document.getElementById("mpArtistGuess"),
  mpGuessBtn: document.getElementById("mpGuessBtn"),
  mpSkipBtn: document.getElementById("mpSkipBtn"),
  mpFeedback: document.getElementById("mpFeedback"),
  mpTimer: document.getElementById("mpTimer"),

  myFriendCode: document.getElementById("myFriendCode"),
  friendCodeInput: document.getElementById("friendCodeInput"),
  addFriendBtn: document.getElementById("addFriendBtn"),
  friendList: document.getElementById("friendList"),

  userNameInput: document.getElementById("userNameInput"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  gameSummary: document.getElementById("gameSummary"),
  authUsernameInput: document.getElementById("authUsernameInput"),
  authPasswordInput: document.getElementById("authPasswordInput"),
  authRegisterBtn: document.getElementById("authRegisterBtn"),
  authLoginBtn: document.getElementById("authLoginBtn"),
  authLogoutBtn: document.getElementById("authLogoutBtn"),
  authStatus: document.getElementById("authStatus"),
  authSessionText: document.getElementById("authSessionText"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  saveServerUrlBtn: document.getElementById("saveServerUrlBtn"),
  testServerBtn: document.getElementById("testServerBtn"),
  serverStatus: document.getElementById("serverStatus"),
};

function setupTabs() {
  const activeTab = localStorage.getItem("songless_active_tab") || "play";
  elements.tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
  Object.entries(elements.views).forEach(([key, view]) => {
    view.classList.toggle("active", key === activeTab);
  });
}

const defaultState = {
  profile: {
    id: `p-${Math.floor(Math.random() * 1e9).toString(16)}`,
    name: "Player",
    bestScore: 0,
    totalScore: 0,
    streak: 0,
    friendCode: generateCode(),
    achievements: [],
    totalCorrect: 0,
    totalPlayed: 0,
  },
  settings: {
    mode: "unlimited",
    difficulty: "normal",
    genre: "Any",
    decade: "Any",
  },
  story: {
    chapterIndex: 0,
    roundInChapter: 0,
  },
  leaderboards: {
    global: [],
    daily: {},
  },
  friends: [],
  lastSessionScore: 0,
};

let authSession = loadAuthSession();
const state = loadState();
let activeGame = null;
let gameTick = null;
let clipTick = null;
let mpState = loadMpStateFromStorage();
let mpTick = null;
let roomStore = loadRoomStore();
let roomPollTimer = null;
let roomEventSource = null;
let roomPollInFlight = false;
let soundCloudLastSource = "built-in";
let soundCloudLastError = "";
let backend = { baseUrl: MULTIPLAYER_BASE_URL, connected: false, lastState: null };
let roomRenderState = {
  metaFingerprint: "",
  playersFingerprint: "",
  lastMetaRenderAt: 0,
};

async function init() {
  elements.serverUrlInput.value = backend.baseUrl;
  setupTabs();
  await loadSongLibrary();
  const sourceText = soundCloudLastSource === "built-in"
    ? `built-in fallback (${soundCloudLastError || "SoundCloud unavailable"})`
    : soundCloudLastSource;
  populateFilters();
  ensureAuthSessionProfileDisplay();
  bindEvents();
  refreshAuthUi();
  syncDirectorySelf();
  ensureDefaultAchievements();
  refreshProfile();
  renderGlobalLeaderboard();
  renderFriendList();
  renderAchievements();
  renderStoryPanel();
  renderMultiplayer();
  updateStatusText();
  setTicker(`Ready. Press Start Game. Songs: ${sourceText}.`);
  initMultiplayerBackend();
  elements.statusTicker.dataset.currentMode = state.settings.mode;
}

function getSoundCloudConfig() {
  const params = new URLSearchParams(window.location.search);
  const queryFromParams = params.get("scQuery") || params.get("soundcloudQuery");
  const limitFromParams = params.get("scLimit") || params.get("soundcloudLimit");
  const clientFromParams = params.get("scClientId") || params.get("soundcloudClientId");

  if (clientFromParams) localStorage.setItem(SOUNDCLOUD_CLIENT_ID_KEY, clientFromParams);
  if (queryFromParams) localStorage.setItem(SOUNDCLOUD_QUERY_KEY, queryFromParams);
  if (limitFromParams) localStorage.setItem(SOUNDCLOUD_LIMIT_KEY, String(limitFromParams));

  const limitValue = Number.parseInt(
    limitFromParams || localStorage.getItem(SOUNDCLOUD_LIMIT_KEY) || SOUNDCLOUD_DEFAULT_LIMIT,
    10,
  );

  return {
    clientId:
      clientFromParams || localStorage.getItem(SOUNDCLOUD_CLIENT_ID_KEY) || "",
    query:
      queryFromParams || localStorage.getItem(SOUNDCLOUD_QUERY_KEY) || SOUNDCLOUD_DEFAULT_QUERY,
    limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.min(Math.max(limitValue, 5), 50) : SOUNDCLOUD_DEFAULT_LIMIT,
  };
}

function parseTrackDecade(track) {
  const yearCandidates = [
    track.release_year,
    track.year,
    track.created_at,
    track.release_date,
    track.last_modified,
    track.createdAt,
  ].map((value) => {
    const stringValue = String(value || "").trim();
    const match = stringValue.match(/\d{4}/);
    return match ? Number.parseInt(match[0], 10) : NaN;
  });
  const year = yearCandidates.find((candidate) => Number.isFinite(candidate) && candidate > 0);
  if (!year) return "Unknown";
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

function parseTrackGenre(track) {
  const candidate = track.genre || track.tag_list || "";
  if (!candidate) return "Unknown";
  if (typeof candidate === "string") {
    return candidate.split(/[,\s]+/).find(Boolean) || "Unknown";
  }
  return "Unknown";
}

function appendClientId(url, clientId) {
  if (!url || !clientId) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("client_id", clientId);
    return parsed.toString();
  } catch {
    const glue = url.includes("?") ? "&" : "?";
    return `${url}${glue}client_id=${encodeURIComponent(clientId)}`;
  }
}

function normalizeSoundCloudTrack(track, clientId) {
  if (!track || !track.title || !track.user?.username) return null;
  const mediaUrl =
    track.stream_url ||
    (Array.isArray(track.media?.transcodings) ? track.media.transcodings.find((t) => t.url)?.url : null);
  const audio = appendClientId(mediaUrl, clientId);
  if (!audio) return null;
  return {
    id: `sc-${track.id || Math.random().toString(16).slice(2)}`,
    title: track.title,
    artist: track.user.username,
    genre: parseTrackGenre(track),
    decade: parseTrackDecade(track),
    audio,
  };
}

function dedupeSongs(songs) {
  const seen = new Set();
  return songs.filter((song) => {
    const key = `${song.title.toLowerCase()}::${song.artist.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function setSongLoadStatus(source, error = "") {
  soundCloudLastSource = source;
  soundCloudLastError = error;
}

async function loadSongLibrary() {
  const config = getSoundCloudConfig();
  if (!config.clientId) {
    SONG_LIBRARY = [...DEFAULT_SONG_LIBRARY];
    setSongLoadStatus("built-in", "Missing SoundCloud client_id");
    return;
  }
  try {
    const endpoint = new URL(SOUNDCLOUD_SEARCH_API);
    endpoint.searchParams.set("client_id", config.clientId);
    endpoint.searchParams.set("q", config.query);
    endpoint.searchParams.set("limit", String(config.limit));
    const response = await fetch(endpoint.toString(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`SoundCloud request failed with ${response.status}`);
    }
    const payload = await response.json();
    const candidates = Array.isArray(payload.collection) ? payload.collection : [];
    const loaded = dedupeSongs(
      candidates
        .map((track) => normalizeSoundCloudTrack(track, config.clientId))
        .filter(Boolean),
    );
    if (loaded.length === 0) {
      throw new Error("No playable tracks returned from SoundCloud.");
    }
    SONG_LIBRARY = loaded;
    setSongLoadStatus(`SoundCloud (${config.query})`, "");
  } catch (error) {
    SONG_LIBRARY = [...DEFAULT_SONG_LIBRARY];
    setSongLoadStatus("built-in", error instanceof Error ? error.message : "SoundCloud load failed");
  }
}

function loadState() {
  const session = activeAuthSession();
  let source = null;
  if (session?.username) {
    source = getStoredUserState(session.username);
    if (!source) {
      source = getAuthSeedState(session.username);
    }
  } else {
    source = loadGuestRawState();
  }
  const merged = deepMerge(structuredClone(defaultState), source || {});
  return normalizeStateIdentity(merged);
}

function saveState() {
  authSession = activeAuthSession();
  if (!authSession) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    localStorage.setItem(AUTH_GUEST_STATE_KEY, JSON.stringify(state));
  } else {
    saveStoredUserState(authSession.username, state);
  }
  persistAuthSession(authSession);
}

function normalizeStateIdentity(baseState) {
  const normalized = deepMerge(structuredClone(defaultState), baseState || {});
  if (!normalized.profile.friendCode) normalized.profile.friendCode = generateCode();
  if (!normalized.profile.id) normalized.profile.id = `p-${Math.floor(Math.random() * 1e9).toString(16)}`;
  return normalized;
}

function normalizeAuthUsername(raw) {
  return String(raw || "").trim().toLowerCase();
}

function generateSessionToken() {
  const bytes = new Uint8Array(16);
  if (crypto && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function isSessionExpired(session) {
  return !session || !session.expiresAt || session.expiresAt <= Date.now();
}

function activeAuthSession() {
  if (!authSession) return null;
  if (isSessionExpired(authSession)) {
    clearAuthSession();
    authSession = null;
    return null;
  }
  return authSession;
}

function loadAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSIONS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.username || !parsed?.token || isSessionExpired(parsed)) {
      clearAuthSession();
      return null;
    }
    parsed.username = normalizeAuthUsername(parsed.username);
    return parsed;
  } catch {
    return null;
  }
}

function persistAuthSession(session) {
  if (!session?.username) {
    localStorage.removeItem(AUTH_SESSIONS_KEY);
    return;
  }
  localStorage.setItem(AUTH_SESSIONS_KEY, JSON.stringify(session));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSIONS_KEY);
}

function createAuthSession(username) {
  const now = Date.now();
  authSession = {
    username,
    token: generateSessionToken(),
    issuedAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
  };
  persistAuthSession(authSession);
  return authSession;
}

function getAuthUsers() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USERS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAuthUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function getStoredUserState(username) {
  if (!username) return null;
  const key = normalizeAuthUsername(username);
  try {
    const users = JSON.parse(localStorage.getItem(AUTH_USER_STATES_KEY)) || {};
    return users[key] || null;
  } catch {
    return null;
  }
}

function getAuthSeedState(username) {
  const account = getAuthUsers()[normalizeAuthUsername(username)];
  if (!account) return null;
  return deepMerge(structuredClone(defaultState), {
    profile: {
      id: account.profileId || `u-${Math.floor(Math.random() * 1e9).toString(16)}`,
      name: account.displayName || username,
    },
  });
}

function saveStoredUserState(username, nextState) {
  if (!username) return;
  const key = normalizeAuthUsername(username);
  let users;
  try {
    users = JSON.parse(localStorage.getItem(AUTH_USER_STATES_KEY)) || {};
  } catch {
    users = {};
  }
  users[key] = normalizeStateIdentity(nextState);
  localStorage.setItem(AUTH_USER_STATES_KEY, JSON.stringify(users));
}

function loadGuestRawState() {
  const guestRaw = localStorage.getItem(AUTH_GUEST_STATE_KEY);
  if (guestRaw) return parseStoredJson(guestRaw, null);
  return parseStoredJson(localStorage.getItem(STATE_KEY), null);
}

function parseStoredJson(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function deepMerge(base, patch) {
  const merged = { ...base };
  for (const key of Object.keys(patch || {})) {
    if (patch[key] && typeof patch[key] === "object" && !Array.isArray(patch[key])) {
      merged[key] = deepMerge(base[key] || {}, patch[key]);
    } else {
      merged[key] = patch[key];
    }
  }
  return merged;
}

function loadRoomStore() {
  try {
    return JSON.parse(localStorage.getItem(ROOM_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRoomStore() {
  localStorage.setItem(ROOM_KEY, JSON.stringify(roomStore));
}

function loadMpStateFromStorage() {
  return {
    joinedRoomCode: null,
    running: false,
    solved: false,
    roundEndsAt: 0,
    timerSecond: -1,
    skips: 0,
    hintLevel: 0,
    song: null,
    songStartedAt: 0,
    pauseStart: 0,
    pausedMs: 0,
    clipEndAt: 0,
    remainingClipMs: 0,
    startedAt: 0,
    timeLimit: 75,
    roomCode: null,
    skipTimer: 0,
    snippetText: "",
  };
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function setTicker(text) {
  elements.statusTicker.textContent = text;
}

function setTextIfChanged(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setDisabledIfChanged(element, disabled) {
  if (element && element.disabled !== disabled) element.disabled = disabled;
}

function resetRoomRenderState() {
  roomRenderState.metaFingerprint = "";
  roomRenderState.playersFingerprint = "";
  roomRenderState.lastMetaRenderAt = 0;
}

function roomPlayersFingerprint(players) {
  const entries = Object.entries(players || {});
  return entries
    .map(([id, profile]) => `${id}:${profile.name}:${profile.score}:${profile.solved ? 1 : 0}`)
    .join("|");
}

function setRoomPlayers(players) {
  const nextFingerprint = roomPlayersFingerprint(players);
  if (nextFingerprint === roomRenderState.playersFingerprint) return;
  roomRenderState.playersFingerprint = nextFingerprint;

  const rows = document.createDocumentFragment();
  Object.values(players || {}).forEach((profile) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${profile.name}</td><td>${profile.score}</td><td>${profile.solved ? "solved" : "trying"}</td>`;
    rows.append(row);
  });
  elements.roomPlayers.replaceChildren(rows);
}

function setRoomMetaFromRoom(room, isHost, isActive) {
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

  setRoomPlayers(players);
}

function populateFilters() {
  elements.genreFilter.replaceChildren();
  elements.decadeFilter.replaceChildren();
  const genres = ["Any", ...new Set(SONG_LIBRARY.map((s) => s.genre))];
  const decades = ["Any", ...new Set(SONG_LIBRARY.map((s) => s.decade))];
  const selectedGenre = genres.includes(state.settings.genre) ? state.settings.genre : "Any";
  const selectedDecade = decades.includes(state.settings.decade) ? state.settings.decade : "Any";
  if (!genres.includes(state.settings.genre)) state.settings.genre = "Any";
  if (!decades.includes(state.settings.decade)) state.settings.decade = "Any";
  genres.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if (g === selectedGenre) opt.selected = true;
    elements.genreFilter.append(opt);
  });
  decades.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    if (d === selectedDecade) opt.selected = true;
    elements.decadeFilter.append(opt);
  });
  elements.difficulty.value = state.settings.difficulty;
  elements.gameMode.value = state.settings.mode;
}

function bindEvents() {
  elements.tabs.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      for (const b of elements.tabs) {
        b.classList.toggle("active", b === button);
      }
      Object.entries(elements.views).forEach(([key, value]) => {
        value.classList.toggle("active", key === tab);
      });
      if (tab === "multiplayer") renderMultiplayer();
      if (tab === "friends") renderFriendList();
      if (tab === "leaderboard") renderGlobalLeaderboard();
      if (tab === "story") renderAchievements();
      if (tab === "settings") {
        refreshProfile();
        refreshAuthUi();
      }
      if (tab === "story") renderStoryPanel();
    });
  });

  elements.startGameBtn.addEventListener("click", startSingleGameRound);
  elements.pauseBtn.addEventListener("click", pauseGame);
  elements.resumeBtn.addEventListener("click", resumeGame);
  elements.skipBtn.addEventListener("click", skipCurrentSong);
  elements.newRoundBtn.addEventListener("click", startSingleGameRound);
  elements.guessBtn.addEventListener("click", handleGuess);
  elements.shareBtn.addEventListener("click", shareCurrentRound);
  elements.showAnswerBtn.addEventListener("click", revealAnswer);
  elements.titleGuess.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleGuess();
  });
  elements.artistGuess.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleGuess();
  });

  elements.storyAdvanceBtn.addEventListener("click", startStoryMode);

  elements.createRoomBtn.addEventListener("click", createRoom);
  elements.joinRoomBtn.addEventListener("click", joinRoomFromInput);
  elements.leaveRoomBtn.addEventListener("click", leaveRoom);
  elements.startRoomBtn.addEventListener("click", startRoomBattle);
  elements.nextRoundBtn.addEventListener("click", broadcastNextMpRound);
  elements.mpGuessBtn.addEventListener("click", handleMpGuess);
  elements.mpSkipBtn.addEventListener("click", handleMpSkip);

  elements.addFriendBtn.addEventListener("click", addFriendFromInput);
  elements.saveProfileBtn.addEventListener("click", saveProfileName);
  elements.saveServerUrlBtn.addEventListener("click", saveServerUrl);
  elements.testServerBtn.addEventListener("click", testServerUrl);
  elements.authRegisterBtn.addEventListener("click", registerCurrentAuthInput);
  elements.authLoginBtn.addEventListener("click", loginCurrentAuthInput);
  elements.authLogoutBtn.addEventListener("click", logoutCurrentSession);
  elements.authPasswordInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    loginCurrentAuthInput();
  });

  elements.gameMode.addEventListener("change", () => {
    state.settings.mode = elements.gameMode.value;
    saveState();
    updateStatusText();
    renderStoryPanel();
    renderMultiplayer();
  });
  elements.difficulty.addEventListener("change", () => {
    state.settings.difficulty = elements.difficulty.value;
    saveState();
    if (activeGame) {
      resetGameRound(activeGame.song);
    }
  });
  elements.genreFilter.addEventListener("change", () => {
    state.settings.genre = elements.genreFilter.value;
    saveState();
  });
  elements.decadeFilter.addEventListener("change", () => {
    state.settings.decade = elements.decadeFilter.value;
    saveState();
  });
}

function updateStatusText() {
  setTicker(`Mode: ${titleCase(state.settings.mode)} / ${titleCase(state.settings.difficulty)}`);
  elements.sessionScore.textContent = state.lastSessionScore || 0;
  elements.streakText.textContent = state.profile.streak || 0;
  elements.bestScoreText.textContent = state.profile.bestScore || 0;
}

function titleCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function refreshProfile() {
  elements.userNameInput.value = state.profile.name;
  elements.myFriendCode.textContent = `Your friend code: ${state.profile.friendCode}`;
  elements.gameSummary.textContent = `Games played: ${state.profile.totalPlayed} | Correct: ${state.profile.totalCorrect} | Total score: ${state.profile.totalScore}`;
  saveState();
}

function saveProfileName() {
  const name = elements.userNameInput.value.trim();
  if (!name) return;
  state.profile.name = name.slice(0, 20);
  if (authSession) {
    const users = getAuthUsers();
    const account = users[normalizeAuthUsername(authSession.username)] || {};
    account.displayName = state.profile.name;
    users[normalizeAuthUsername(authSession.username)] = account;
    saveAuthUsers(users);
  }
  syncDirectorySelf();
  refreshProfile();
  renderFriendList();
  renderGlobalLeaderboard();
}

function refreshAuthUi() {
  if (!elements.authStatus || !elements.authSessionText || !elements.authLogoutBtn) return;
  if (!authSession?.username) {
    elements.authStatus.textContent = "Not signed in.";
    elements.authSessionText.textContent = "Session: none";
    setDisabledIfChanged(elements.authLogoutBtn, true);
    setDisabledIfChanged(elements.authUsernameInput, false);
    setDisabledIfChanged(elements.authPasswordInput, false);
    setDisabledIfChanged(elements.authRegisterBtn, false);
    setDisabledIfChanged(elements.authLoginBtn, false);
    return;
  }
  const sessionUser = normalizeAuthUsername(authSession.username);
  const users = getAuthUsers();
  const displayName = users[sessionUser]?.displayName || sessionUser;
  elements.authStatus.textContent = `Signed in as ${displayName}.`;
  const expiry = new Date(authSession.expiresAt || Date.now()).toLocaleString();
  elements.authSessionText.textContent = `Session: active until ${expiry}`;
  setDisabledIfChanged(elements.authLogoutBtn, false);
  setDisabledIfChanged(elements.authUsernameInput, true);
  setDisabledIfChanged(elements.authPasswordInput, true);
  setDisabledIfChanged(elements.authRegisterBtn, true);
  setDisabledIfChanged(elements.authLoginBtn, true);
}

function setAuthFeedback(message) {
  elements.authStatus.textContent = message;
}

function buildGuestStateSnapshot() {
  localStorage.setItem(AUTH_GUEST_STATE_KEY, JSON.stringify(state));
}

function replaceState(nextState) {
  const normalized = normalizeStateIdentity(nextState);
  Object.keys(state).forEach((key) => {
    delete state[key];
  });
  Object.keys(normalized).forEach((key) => {
    state[key] = normalized[key];
  });
}

function ensureAuthSessionProfileDisplay() {
  if (!authSession?.username) return;
  const users = getAuthUsers();
  const account = users[normalizeAuthUsername(authSession.username)];
  if (!account) {
    clearAuthSession();
    authSession = null;
    return;
  }
  if (!account.displayName) {
    account.displayName = state.profile.name;
    users[normalizeAuthUsername(authSession.username)] = account;
    saveAuthUsers(users);
  }
  if (account.profileId && account.profileId !== state.profile.id) {
    state.profile.id = account.profileId;
  }
}

async function hashCredential(value) {
  const input = String(value || "").trim();
  if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) return input;
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function registerCurrentAuthInput() {
  const usernameRaw = elements.authUsernameInput.value;
  const password = elements.authPasswordInput.value;
  const username = normalizeAuthUsername(usernameRaw);
  if (!username || username.length < 3) {
    setAuthFeedback("Username needs at least 3 characters.");
    return;
  }
  if (password.length < 4) {
    setAuthFeedback("Password needs at least 4 characters.");
    return;
  }
  const users = getAuthUsers();
  if (users[username]) {
    setAuthFeedback("Username already exists. Try logging in.");
    return;
  }
  const passwordHash = await hashCredential(password);
  users[username] = {
    username,
    displayName: usernameRaw.trim() || username,
    passwordHash,
    profileId: `u-${Math.floor(Math.random() * 1e12).toString(16)}`,
    createdAt: Date.now(),
  };
  saveAuthUsers(users);
  const seeded = deepMerge(state, {
    profile: {
      id: users[username].profileId,
      name: users[username].displayName,
    },
  });
  saveStoredUserState(username, seeded);
  await loginCurrentAuthInput();
  setAuthFeedback(`Created account ${users[username].displayName}.`);
}

async function loginCurrentAuthInput() {
  const username = normalizeAuthUsername(elements.authUsernameInput.value);
  const password = elements.authPasswordInput.value;
  if (!username || !password) {
    setAuthFeedback("Enter username and password.");
    return;
  }
  const users = getAuthUsers();
  const account = users[username];
  if (!account) {
    setAuthFeedback("No account found. Register first.");
    return;
  }
  const passwordHash = await hashCredential(password);
  if (account.passwordHash && passwordHash !== account.passwordHash) {
    setAuthFeedback("Invalid credentials.");
    return;
  }
  if (authSession) {
    buildGuestStateSnapshot();
  }
  const previousState = loadGuestRawState();
  const userState = getStoredUserState(username) || deepMerge(previousState, {
    profile: {
      id: account.profileId || `u-${Math.floor(Math.random() * 1e12).toString(16)}`,
      name: account.displayName || username,
    },
  });
  replaceState(userState);
  ensureAuthSessionProfileDisplay();
  createAuthSession(username);
  saveState();
  refreshAuthUi();
  refreshProfile();
  elements.authPasswordInput.value = "";
  setAuthFeedback("Signed in.");
}

function logoutCurrentSession() {
  if (!authSession) {
    setAuthFeedback("Already signed out.");
    return;
  }
  saveState();
  clearAuthSession();
  authSession = null;
  const guestRaw = loadGuestRawState();
  replaceState(guestRaw || {});
  refreshAuthUi();
  refreshProfile();
  elements.authPasswordInput.value = "";
  setAuthFeedback("Signed out.");
  renderGlobalLeaderboard();
  renderFriendList();
}

function saveServerUrl() {
  const value = elements.serverUrlInput.value.trim();
  if (!value) return;
  const normalized = normalizeBackendBase(value);
  backend.baseUrl = normalized;
  localStorage.setItem(MULTIPLAYER_API_KEY, normalized);
  elements.serverUrlInput.value = normalized;
  elements.serverStatus.textContent = `Server URL set: ${normalized}`;
  checkMultiplayerBackend();
}

function testServerUrl() {
  const value = elements.serverUrlInput.value.trim() || backend.baseUrl;
  const normalized = normalizeBackendBase(value);
  elements.serverStatus.textContent = `Testing ${normalized}...`;
  fetch(`${normalized}/health`)
    .then((response) => response.json())
    .then((payload) => {
      if (payload.ok) {
        elements.serverStatus.textContent = "Server reachable.";
      } else {
        elements.serverStatus.textContent = "Server did not respond as expected.";
      }
    })
    .catch(() => {
      elements.serverStatus.textContent = "Server unreachable.";
    });
}

function filterSongs() {
  return SONG_LIBRARY.filter((song) => {
    const genreMatch = state.settings.genre === "Any" || song.genre === state.settings.genre;
    const decadeMatch = state.settings.decade === "Any" || song.decade === state.settings.decade;
    return genreMatch && decadeMatch;
  });
}

function pickSong(mode = state.settings.mode) {
  let pool = SONG_LIBRARY.slice();
  if (mode === "story") {
    const ch = STORY_CHAPTERS[state.story.chapterIndex];
    pool = SONG_LIBRARY.filter((song) => {
      const byGenre = ch.filters.genre === "Any" || song.genre === ch.filters.genre;
      const byDecade = ch.filters.decade === "Any" || song.decade === ch.filters.decade;
      return byGenre && byDecade;
    });
  } else if (state.settings.genre !== "Any" || state.settings.decade !== "Any") {
    pool = filterSongs();
  }
  if (pool.length === 0) pool = SONG_LIBRARY.slice();
  const previous = activeGame?.song?.id;
  const list = pool.filter((s) => s.id !== previous);
  if (list.length === 0) return pool[Math.floor(Math.random() * pool.length)];
  return list[Math.floor(Math.random() * list.length)];
}

function getDailySong() {
  const date = new Date().toISOString().slice(0, 10);
  const seed = date.split("-").reduce((a, c) => a + c.charCodeAt(0), 0);
  const idx = seed % SONG_LIBRARY.length;
  return SONG_LIBRARY[idx];
}

function startSingleGameRound() {
  const mode = elements.gameMode.value;
  state.settings.mode = mode;
  const target =
    mode === "daily"
      ? getDailySong()
      : mode === "story"
      ? pickSong("story")
      : pickSong("unlimited");

  resetGameRound(target);
}

function startStoryMode() {
  elements.gameMode.value = "story";
  state.settings.mode = "story";
  startSingleGameRound();
}

function resetGameRound(song) {
  clearGameTimers();
  const difficulty = DIFFICULTY[state.settings.difficulty];
  activeGame = {
    running: true,
    paused: false,
    solved: false,
    song,
    skips: 0,
    hintLevel: 0,
    startedAt: performance.now(),
    pausedAt: 0,
    pausedTotalMs: 0,
    timeLimit: difficulty.timeLimit,
    snippetMs: difficulty.hints[0] * 1000,
    snippetEndAt: 0,
    timeLeft: difficulty.timeLimit,
  };
  elements.feedback.textContent = "";
  elements.guessBtn.disabled = false;
  elements.skipBtn.disabled = false;
  elements.roundNote.textContent = `Round started in ${titleCase(state.settings.mode)} mode.`;
  state.lastSessionScore = 0;
  state.profile.totalPlayed += 1;
  saveState();
  setTicker(`Now guessing: ${titleCase(state.settings.mode)}`);
  setGameInputs(false);
  renderGameRound();
  startClip();
  startGameTimer();
}

function setGameInputs(disabled) {
  elements.titleGuess.disabled = disabled;
  elements.artistGuess.disabled = disabled;
  elements.guessBtn.disabled = disabled;
  elements.skipBtn.disabled = disabled;
}

function clearGameTimers() {
  if (clipTick) {
    clearTimeout(clipTick);
    clipTick = null;
  }
  if (gameTick) {
    clearInterval(gameTick);
    gameTick = null;
  }
}

function gameDifficulty() {
  return DIFFICULTY[state.settings.difficulty] || DIFFICULTY.normal;
}

function startClip() {
  if (!activeGame || !activeGame.song) return;
  clearTimeout(clipTick);
  const audio = elements.songAudio;
  const levels = gameDifficulty().hints;
  activeGame.snippetMs = levels[Math.min(activeGame.hintLevel, levels.length - 1)] * 1000;

  audio.src = activeGame.song.audio;
  audio.currentTime = 0;
  audio.load();
  audio.play().catch(() => {});
  activeGame.snippetEndAt = performance.now() + activeGame.snippetMs;
  clipTick = setTimeout(() => {
    elements.songAudio.pause();
  }, activeGame.snippetMs);

  renderGameRound();
}

function startGameTimer() {
  if (gameTick) clearInterval(gameTick);
  gameTick = setInterval(() => {
    if (!activeGame || activeGame.paused || !activeGame.running) return;
    const now = performance.now();
    const elapsed = now - activeGame.startedAt - activeGame.pausedTotalMs;
    const nextTimeLeft = Math.max(0, Math.ceil(activeGame.timeLimit - elapsed / 1000));
    if (nextTimeLeft !== activeGame.timeLeft) {
      activeGame.timeLeft = nextTimeLeft;
      elements.timerText.textContent = `${nextTimeLeft}s`;
    }
    if (activeGame.timeLeft <= 0) endRound("time");
  }, GAME_TIMER_TICK_MS);
}

function pauseGame() {
  if (!activeGame || activeGame.paused) return;
  activeGame.paused = true;
  activeGame.pausedAt = performance.now();
  elements.songAudio.pause();
  clearTimeout(clipTick);
  clipTick = null;
  activeGame.snippetMs = Math.max(0, activeGame.snippetEndAt - activeGame.pausedAt);
  setTicker("Paused.");
}

function resumeGame() {
  if (!activeGame || !activeGame.paused || activeGame.solved) return;
  activeGame.paused = false;
  const now = performance.now();
  activeGame.pausedTotalMs += now - activeGame.pausedAt;
  activeGame.snippetEndAt = now + activeGame.snippetMs;
  elements.songAudio.play().catch(() => {});
  if (clipTick) clearTimeout(clipTick);
  clipTick = setTimeout(() => {
    elements.songAudio.pause();
  }, activeGame.snippetMs);
  setTicker(`Now guessing: ${titleCase(state.settings.mode)}`);
}

function skipCurrentSong() {
  if (!activeGame || activeGame.solved || activeGame.paused) return;
  activeGame.skips += 1;
  activeGame.hintLevel = Math.min(activeGame.hintLevel + 1, gameDifficulty().hints.length - 1);
  activeGame.timeLimit = Math.max(activeGame.timeLimit - 3, 20);
  startClip();
  elements.feedback.textContent = "Skipped. More of the song is revealed.";
  if (activeGame.hintLevel >= gameDifficulty().hints.length - 1) {
    elements.feedback.textContent = "Max hint reached. Solve carefully or reveal answer.";
  }
}

function handleGuess() {
  if (!activeGame || !activeGame.running || activeGame.solved || activeGame.paused) return;
  const titleInput = elements.titleGuess.value.trim();
  const artistInput = elements.artistGuess.value.trim();
  if (!titleInput || !artistInput) {
    elements.feedback.textContent = "Both title and artist fields are required.";
    return;
  }
  const normalizedTitle = normalize(titleInput);
  const normalizedArtist = normalize(artistInput);
  const targetTitle = normalize(activeGame.song.title);
  const targetArtist = normalize(activeGame.song.artist);

  if (normalizedTitle === targetTitle && normalizedArtist === targetArtist) {
    const score = computeScore(true);
    state.profile.streak = (state.profile.streak || 0) + 1;
    state.profile.totalCorrect += 1;
    state.profile.totalScore += score;
    state.profile.bestScore = Math.max(state.profile.bestScore || 0, state.profile.totalScore);
    state.lastSessionScore = score;
    activeGame.solved = true;
    activeGame.running = false;
    clearGameTimers();
    elements.feedback.textContent = `Correct! ${activeGame.song.title} by ${activeGame.song.artist}. +${score} points.`;
    elements.songClue.textContent = `Answer: ${activeGame.song.title} — ${activeGame.song.artist}`;
    addLeaderboardEntry("classic", score);
    checkAchievement("first-win");
    if (state.profile.streak >= 3) checkAchievement("streak-3");
    if (state.profile.streak >= 5) checkAchievement("streak-5");
    if (state.settings.mode === "daily") checkAchievement("daily");
    if (state.settings.mode === "story") {
      progressStory();
    }
    updateStatusText();
    setGameInputs(true);
    setTicker(`Solved: ${activeGame.song.title}`);
    elements.newRoundBtn.disabled = false;
    elements.skipBtn.disabled = true;
    setTimeout(() => {
      renderStoryPanel();
      if (state.settings.mode === "unlimited") elements.newRoundBtn.focus();
    }, 200);
    renderGlobalLeaderboard();
    renderAchievements();
    saveState();
  } else {
    elements.feedback.textContent = "Nope. Try again or skip for a bigger clip.";
    activeGame.skips += 0;
  }
  renderGameRound();
}

function endRound(reason) {
  if (!activeGame || activeGame.solved) return;
  activeGame.solved = true;
  activeGame.running = false;
  activeGame.failedReason = reason;
  clearGameTimers();
  state.profile.streak = 0;
  elements.feedback.textContent = `Round ended (${reason}).`;
  elements.songClue.textContent = `Answer: ${activeGame.song.title} — ${activeGame.song.artist}`;
  elements.songAudio.pause();
  setTicker(`Round ended: ${reason}`);
  updateStatusText();
  setGameInputs(true);
  saveState();
}

function computeScore(correct) {
  if (!correct) return 0;
  const difficulty = gameDifficulty();
  const elapsed = (performance.now() - activeGame.startedAt - activeGame.pausedTotalMs) / 1000;
  const timeLeft = Math.max(0, activeGame.timeLimit - elapsed);
  const skipPenalty = 1 - Math.min(0.65, activeGame.skips * 0.11);
  const difficultyMult = difficulty.scoreScale;
  const bonus = difficulty.hints.length - activeGame.hintLevel;
  const streakMult = 1 + Math.min(4, state.profile.streak) * 0.12;
  return Math.max(20, Math.round((difficulty.scoreBase + timeLeft * 8 + bonus * 20) * skipPenalty * difficultyMult * streakMult));
}

function revealAnswer() {
  if (!activeGame || !activeGame.song) return;
  elements.songClue.textContent = `Answer: ${activeGame.song.title} — ${activeGame.song.artist}`;
}

function renderHint(song, level) {
  const levels = gameDifficulty().hints;
  const revealRatio = (level + 1) / levels.length;
  const titleHint = maskedReveal(song.title, revealRatio);
  const artistHint = maskedReveal(song.artist, revealRatio);
  return `${titleHint} — ${artistHint}`;
}

function maskedReveal(value, ratio) {
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
}

function renderGameRound() {
  if (!activeGame) {
    elements.songClue.textContent = "Press Start Game to begin.";
    elements.hintText.textContent = "--";
    return;
  }
  elements.songClue.textContent =
    activeGame.solved || state.settings.mode === "unlimited"
      ? `Now playing: ${activeGame.song.title}, ${activeGame.song.artist}`
      : `Now playing: ${renderHint(activeGame.song, activeGame.hintLevel)}`;
  elements.hintText.textContent = renderHint(activeGame.song, activeGame.hintLevel);
  elements.clipText.textContent = `${Math.ceil(activeGame.snippetMs / 1000)}s clip`;
  elements.sessionScore.textContent = `${state.lastSessionScore}`;
  elements.streakText.textContent = state.profile.streak || 0;
  elements.timerText.textContent = `${activeGame.timeLeft}s`;
}

function addLeaderboardEntry(mode, score) {
  const entry = {
    name: state.profile.name,
    mode,
    score,
    date: new Date().toISOString(),
  };
  state.leaderboards.global.push(entry);
  state.leaderboards.global.sort((a, b) => b.score - a.score);
  state.leaderboards.global = state.leaderboards.global.slice(0, 100);

  const today = new Date().toISOString().slice(0, 10);
  if (!state.leaderboards.daily[today]) state.leaderboards.daily[today] = [];
  state.leaderboards.daily[today].push(entry);
  state.leaderboards.daily[today].sort((a, b) => b.score - a.score);
  state.leaderboards.daily[today] = state.leaderboards.daily[today].slice(0, 50);
}

function renderGlobalLeaderboard() {
  const globalRows = [...state.leaderboards.global]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  elements.leaderboardAll.innerHTML = "";
  globalRows.forEach((entry, i) => {
    const row = document.createElement("tr");
    const time = new Date(entry.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    row.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td>${entry.mode}</td><td>${entry.score}</td><td>${time}</td>`;
    elements.leaderboardAll.append(row);
  });
  if (globalRows.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5">No scores yet.</td>`;
    elements.leaderboardAll.append(row);
  }

  const today = new Date().toISOString().slice(0, 10);
  const dailyRows = state.leaderboards.daily[today] || [];
  elements.leaderboardDaily.innerHTML = "";
  dailyRows.slice(0, 20).forEach((entry, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td>${entry.score}</td>`;
    elements.leaderboardDaily.append(row);
  });
  if (dailyRows.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="3">No scores yet.</td>`;
    elements.leaderboardDaily.append(row);
  }
}

function progressStory() {
  if (state.settings.mode !== "story") return;
  const chapter = STORY_CHAPTERS[state.story.chapterIndex];
  state.story.roundInChapter += 1;
  if (state.story.roundInChapter >= chapter.rounds) {
    checkAchievement(`story-${state.story.chapterIndex + 1}`);
    if (state.story.chapterIndex >= 2) checkAchievement("story-3");
    state.story.chapterIndex += 1;
    state.story.roundInChapter = 0;
    if (state.story.chapterIndex >= STORY_CHAPTERS.length) {
      checkAchievement("story-5");
      state.story.chapterIndex = STORY_CHAPTERS.length - 1;
      state.profile.streak = 0;
      elements.feedback.textContent = "You finished all chapters!";
      state.settings.mode = "unlimited";
      elements.gameMode.value = "unlimited";
      updateStatusText();
    } else {
      state.feedbackMessage = `Chapter complete. ${chapter.title} unlocked.`;
      elements.feedback.textContent = state.feedbackMessage;
    }
  }
  renderStoryPanel();
  renderAchievements();
}

function renderStoryPanel() {
  const chapter = STORY_CHAPTERS[state.story.chapterIndex] || STORY_CHAPTERS[0];
  elements.storyTitle.textContent = `${chapter.title} (${state.story.chapterIndex + 1}/5)`;
  elements.storyDescription.textContent = chapter.description;
  const total = chapter.rounds || 4;
  const percent = Math.min(100, Math.round((state.story.roundInChapter / total) * 100));
  elements.storyProgress.style.width = `${percent}%`;
  elements.storyGoal.textContent = `Round progress: ${state.story.roundInChapter}/${total}`;
}

function ensureDefaultAchievements() {
  if (!state.profile.achievements) state.profile.achievements = [];
  const existing = new Set(state.profile.achievements.map((a) => a));
  DEFAULT_ACHIEVEMENTS.forEach((entry) => {
    if (!existing.has(entry.id)) return;
  });
}

function checkAchievement(id) {
  const known = new Set(state.profile.achievements);
  if (known.has(id)) return;
  const def = DEFAULT_ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return;
  state.profile.achievements.push(id);
  elements.feedback.textContent = `Achievement unlocked: ${def.name}`;
  renderAchievements();
  saveState();
}

function renderAchievements() {
  elements.achievementList.innerHTML = "";
  DEFAULT_ACHIEVEMENTS.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.name} — ${state.profile.achievements.includes(entry.id) ? "unlocked" : "locked"}`;
    if (state.profile.achievements.includes(entry.id)) li.style.color = "#7dffb0";
    elements.achievementList.append(li);
  });
  refreshProfile();
}

function syncDirectorySelf() {
  const directory = getDirectory();
  directory[state.profile.friendCode] = {
    id: state.profile.id,
    name: state.profile.name,
    code: state.profile.friendCode,
    bestScore: state.profile.bestScore || 0,
  };
  localStorage.setItem(DIRECTORY_KEY, JSON.stringify(directory));
}

function getDirectory() {
  try {
    return JSON.parse(localStorage.getItem(DIRECTORY_KEY)) || {};
  } catch {
    return {};
  }
}

function addFriendFromInput() {
  const raw = elements.friendCodeInput.value.trim().toUpperCase();
  if (!raw) return;
  if (raw === state.profile.friendCode) return;
  const directory = getDirectory();
  const candidate = directory[raw];
  if (!candidate) {
    directory[raw] = {
      id: `f-${Math.random().toString(16).slice(2, 8)}`,
      name: `Guest ${raw}`,
      code: raw,
      bestScore: 0,
    };
    localStorage.setItem(DIRECTORY_KEY, JSON.stringify(directory));
  }
  if (!state.friends.includes(raw)) state.friends.push(raw);
  renderFriendList();
  saveState();
}

function renderFriendList() {
  const directory = getDirectory();
  elements.friendList.innerHTML = "";
  state.friends.forEach((code) => {
    const profile = directory[code] || { name: code, bestScore: 0 };
    const row = document.createElement("tr");
    row.innerHTML = `<td>${profile.name}</td><td>${profile.bestScore || 0}</td><td>${code}</td>`;
    elements.friendList.append(row);
  });
  if (state.friends.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="3">No friends yet.</td>`;
    elements.friendList.append(row);
  }
  elements.myFriendCode.textContent = `Your code: ${state.profile.friendCode}`;
}

function normalizeMpError(err) {
  return err?.message || "Multiplayer request failed.";
}

function initMultiplayerBackend() {
  const raw = localStorage.getItem(MULTIPLAYER_API_KEY);
  if (raw) backend.baseUrl = normalizeBackendBase(raw);
  const query = new URLSearchParams(window.location.search).get("mpServer");
  if (query) {
    backend.baseUrl = normalizeBackendBase(query);
    localStorage.setItem(MULTIPLAYER_API_KEY, backend.baseUrl);
  }
  checkMultiplayerBackend();
}

function normalizeBackendBase(value) {
  if (!value) return MULTIPLAYER_FALLBACK_URL;
  const trimmed = value.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed}/api`;
}

async function checkMultiplayerBackend() {
  try {
    const healthy = await requestMp("/health");
    if (healthy?.ok) {
      backend.connected = true;
      elements.roomStatus.textContent = "Multiplayer backend connected.";
      elements.serverStatus.textContent = "Server reachable.";
      return;
    }
  } catch {
    backend.connected = false;
    elements.roomStatus.textContent = `No backend at ${backend.baseUrl}. Using local multiplayer fallback.`;
    elements.serverStatus.textContent = `Server unreachable at ${backend.baseUrl}.`;
  }
}

function getMpBody() {
  return {
    player: {
      id: state.profile.id,
      name: state.profile.name,
    },
    mode: state.settings.mode,
    difficulty: state.settings.difficulty,
    genre: state.settings.genre,
    decade: state.settings.decade,
  };
}

async function requestMp(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const response = await fetch(`${backend.baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
    body,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const err = new Error(parsed?.error || `HTTP ${response.status}`);
    throw err;
  }
  return parsed;
}

function startRoomEventStream(code) {
  if (!backend.connected || !code) return;
  if (roomEventSource) {
    roomEventSource.close();
    roomEventSource = null;
  }
  try {
    roomEventSource = new EventSource(`${backend.baseUrl}/rooms/${code}/events`);
    roomEventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.room) {
          backend.lastState = payload.room;
          mpState.roomCode = payload.room.code;
          applyRoomState(payload.room);
        } else if (payload.type === "room-closed") {
          resetLocalRoomState();
        }
      } catch {}
    };
    roomEventSource.onerror = () => {
      if (roomEventSource) {
        roomEventSource.close();
        roomEventSource = null;
      }
      // fallback to polling if the stream drops
      setupRoomPolling(code);
    };
  } catch {
    setupRoomPolling(code);
  }
}

function setupRoomPolling(code) {
  if (roomPollTimer) clearInterval(roomPollTimer);
  if (!code) return;
  roomPollTimer = setInterval(async () => {
    if (!mpState.roomCode) {
      clearInterval(roomPollTimer);
      roomPollTimer = null;
      return;
    }
    if (document.hidden) return;
    if (roomPollInFlight) return;
    roomPollInFlight = true;
    try {
      const response = await safeRequestRoom(code);
      if (response?.room) {
        applyRoomState(response.room);
      }
    } finally {
      roomPollInFlight = false;
    }
  }, MULTIPLAYER_POLL_MS);
}

function stopRoomStreaming() {
  if (roomPollTimer) {
    clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
  roomPollInFlight = false;
  if (mpTick) {
    clearInterval(mpTick);
    mpTick = null;
  }
  if (roomEventSource) {
    roomEventSource.close();
    roomEventSource = null;
  }
}

async function safeRequestRoom(code) {
  try {
    return await requestMp(`/rooms/${code}/state`);
  } catch {
    return null;
  }
}

function mpStateFromDefaults() {
  return {
    joinedRoomCode: null,
    running: false,
    solved: false,
    roundEndsAt: 0,
    timerSecond: -1,
    skips: 0,
    hintLevel: 0,
    song: null,
    songStartedAt: 0,
    pauseStart: 0,
    pausedMs: 0,
    clipEndAt: 0,
    remainingClipMs: 0,
    startedAt: 0,
    timeLimit: 75,
    roomCode: null,
    skipTimer: 0,
    snippetText: "",
  };
}

function renderMultiplayer() {
  if (!backend.connected || !mpState.roomCode) {
    renderMultiplayerLocal();
    return;
  }
  renderMultiplayerRemote();
}

async function renderMultiplayerRemote() {
  const roomCode = mpState.roomCode;
  const response = await safeRequestRoom(roomCode);
  if (!response?.room) {
    setTextIfChanged(elements.roomStatus, "Room not found.");
    resetLocalRoomState();
    return;
  }
  backend.lastState = response.room;
  mpState.roomCode = roomCode;
  applyRoomState(response.room);
}

function applyRoomState(room) {
  const isHost = room.hostId === state.profile.id;
  const isActive = room.status === "active" && room.currentSongId;
  mpState.roomCode = room.code;
  setRoomMetaFromRoom(room, isHost, isActive);
  if (isActive) {
    mpState.running = true;
    mpRenderFromRoom(room);
    syncMpTimer();
  } else {
    mpState.running = false;
    mpState.timerSecond = -1;
    if (mpTick) {
      clearInterval(mpTick);
      mpTick = null;
    }
    setTextIfChanged(elements.mpFeedback, `Room ${room.status === "lobby" ? "waiting" : "done"}`);
    setTextIfChanged(elements.mpTimer, "Timer: --");
    setDisabledIfChanged(elements.mpSkipBtn, true);
    setDisabledIfChanged(elements.mpGuessBtn, true);
    setDisabledIfChanged(elements.mpTitleGuess, true);
    setDisabledIfChanged(elements.mpArtistGuess, true);
  }
  if (mpState.running && isActive) {
    setDisabledIfChanged(elements.mpGuessBtn, false);
    setDisabledIfChanged(elements.mpTitleGuess, false);
    setDisabledIfChanged(elements.mpArtistGuess, false);
    setDisabledIfChanged(elements.mpSkipBtn, !isHost);
  }
}

function renderMultiplayerLocal() {
  roomStore = loadRoomStore();
  if (!mpState.roomCode) {
    resetRoomRenderState();
    setTextIfChanged(elements.roomStatus, "Not in a room.");
    setTextIfChanged(elements.roomCodeView, "--");
    setTextIfChanged(elements.roomModeView, "Mode: --");
    setTextIfChanged(elements.roomHintView, "Hint lvl: --");
    setTextIfChanged(elements.roomSongView, "Song: --");
    setRoomPlayers({}, true);
    setTextIfChanged(elements.mpTimer, "Timer: --");
    mpState.running = false;
    mpState.timerSecond = -1;
    setDisabledIfChanged(elements.startRoomBtn, true);
    setDisabledIfChanged(elements.nextRoundBtn, true);
    if (mpTick) {
      clearInterval(mpTick);
      mpTick = null;
    }
    setDisabledIfChanged(elements.mpSkipBtn, true);
    setDisabledIfChanged(elements.mpGuessBtn, true);
    setDisabledIfChanged(elements.mpTitleGuess, true);
    setDisabledIfChanged(elements.mpArtistGuess, true);
    return;
  }
  const room = roomStore[mpState.roomCode];
  if (!room) {
    resetRoomRenderState();
    setTextIfChanged(elements.roomStatus, "Room not found.");
    setTextIfChanged(elements.roomCodeView, "--");
    setTextIfChanged(elements.roomModeView, "Mode: --");
    setTextIfChanged(elements.roomHintView, "Hint index: --");
    setTextIfChanged(elements.roomSongView, "Song: --");
    mpState.running = false;
    mpState.timerSecond = -1;
    setDisabledIfChanged(elements.startRoomBtn, true);
    setDisabledIfChanged(elements.nextRoundBtn, true);
    if (mpTick) {
      clearInterval(mpTick);
      mpTick = null;
    }
    setRoomPlayers({}, true);
    setTextIfChanged(elements.mpFeedback, "Room not found.");
    setTextIfChanged(elements.mpTimer, "Timer: --");
    return;
  }
  const isHost = room.hostId === state.profile.id;
  const isActive = room.status === "active" && room.currentSongId;
  setRoomMetaFromRoom(room, isHost, isActive);

  if (room.status === "active" && room.currentSongId) {
    mpRenderFromRoom(room);
    syncMpTimer();
  } else {
    mpState.running = false;
    mpState.timerSecond = -1;
    if (mpTick) {
      clearInterval(mpTick);
      mpTick = null;
    }
    setTextIfChanged(elements.mpFeedback, `Room ${room.status === "lobby" ? "waiting" : "done"}`);
    setTextIfChanged(elements.mpTimer, "Timer: --");
    setDisabledIfChanged(elements.mpSkipBtn, true);
    setDisabledIfChanged(elements.mpGuessBtn, true);
    setDisabledIfChanged(elements.mpTitleGuess, true);
    setDisabledIfChanged(elements.mpArtistGuess, true);
  }
  if (mpState.running && isActive) {
    setDisabledIfChanged(elements.mpGuessBtn, false);
    setDisabledIfChanged(elements.mpTitleGuess, false);
    setDisabledIfChanged(elements.mpArtistGuess, false);
    setDisabledIfChanged(elements.mpSkipBtn, !isHost);
  }
}

function getRoomStoreSong(id) {
  return SONG_LIBRARY.find((song) => song.id === id) || SONG_LIBRARY[0];
}

function roomPoolFromFilters(room) {
  return SONG_LIBRARY.filter((song) => {
    const byGenre = room.genre === "Any" || song.genre === room.genre;
    const byDecade = room.decade === "Any" || song.decade === room.decade;
    return byGenre && byDecade;
  });
}

function createRoom() {
  if (!backend.connected) {
    return createRoomLocal();
  }
  requestMp("/rooms", { method: "POST", body: getMpBody() })
    .then((response) => {
      if (!response?.room) {
        elements.mpFeedback.textContent = "Unable to create room.";
        return;
      }
      mpState.roomCode = response.room.code;
      elements.roomCodeInput.value = response.room.code;
      elements.mpFeedback.textContent = "Room created.";
      startRoomEventStream(response.room.code);
      applyRoomState(response.room);
    })
    .catch((error) => {
      elements.mpFeedback.textContent = normalizeMpError(error);
      backend.connected = false;
      createRoomLocal();
    });
}

function createRoomLocal() {
  const code = generateCode();
  const room = {
    code,
    hostId: state.profile.id,
    hostName: state.profile.name,
    mode: state.settings.mode,
    difficulty: state.settings.difficulty,
    genre: state.settings.genre,
    decade: state.settings.decade,
    status: "lobby",
    currentSongId: null,
    hintIndex: 0,
    round: 0,
    players: {},
    createdAt: Date.now(),
    roundEndsAt: 0,
  };
  room.players[state.profile.id] = {
    name: state.profile.name,
    score: 0,
    solved: false,
  };
  roomStore[code] = room;
  saveRoomStore();
  mpState = Object.assign(mpState, { roomCode: code, joinedRoomCode: code, running: false });
  elements.roomCodeInput.value = code;
  renderMultiplayerLocal();
}

function joinRoomFromInput() {
  if (!backend.connected) {
    joinRoomFromInputLocal();
    return;
  }
  const code = elements.roomCodeInput.value.trim().toUpperCase();
  if (!code) return;
  requestMp(`/rooms/${code}/join`, { method: "POST", body: getMpBody() })
    .then((response) => {
      if (!response?.room) {
        elements.mpFeedback.textContent = "Join failed. Room not found.";
        return;
      }
      mpState.roomCode = response.room.code;
      elements.roomCodeInput.value = response.room.code;
      startRoomEventStream(response.room.code);
      applyRoomState(response.room);
      renderMultiplayerRemote();
      syncDirectorySelf();
    })
    .catch((error) => {
      elements.mpFeedback.textContent = normalizeMpError(error);
      joinRoomFromInputLocal();
    });
}

function joinRoomFromInputLocal() {
  const code = elements.roomCodeInput.value.trim().toUpperCase();
  if (!code) return;
  const room = roomStore[code];
  if (!room) return;
  if (!room.players[state.profile.id]) {
    room.players[state.profile.id] = {
      name: state.profile.name,
      score: 0,
      solved: false,
    };
  }
  roomStore[code] = room;
  saveRoomStore();
  mpState.roomCode = code;
  mpState.joinedRoomCode = code;
  mpState.running = false;
  syncDirectorySelf();
  elements.roomCodeInput.value = code;
  renderMultiplayerLocal();
}

function leaveRoom() {
  if (!mpState.roomCode) return;
  if (!backend.connected) {
    leaveRoomLocal();
    return;
  }
  requestMp(`/rooms/${mpState.roomCode}/leave`, { method: "POST", body: getMpBody() })
    .then(() => {
      stopRoomStreaming();
      mpState = mpStateFromDefaults();
      elements.mpFeedback.textContent = "Left room.";
      elements.roomCodeInput.value = "";
      renderMultiplayer();
    })
    .catch(() => {
      leaveRoomLocal();
    });
}

function leaveRoomLocal() {
  if (!mpState.roomCode) return;
  const room = roomStore[mpState.roomCode];
  if (room) {
    delete room.players[state.profile.id];
    if (Object.keys(room.players).length === 0) {
      delete roomStore[mpState.roomCode];
    }
    saveRoomStore();
  }
  mpState = mpStateFromDefaults();
  elements.mpFeedback.textContent = "Left room.";
  renderMultiplayerLocal();
}

function startRoomBattle() {
  if (backend.connected) {
    if (!mpState.roomCode) return;
    requestMp(`/rooms/${mpState.roomCode}/start`, { method: "POST", body: getMpBody() })
      .then((response) => {
        if (!response?.room) return;
        applyRoomState(response.room);
        renderMultiplayerRemote();
      })
      .catch((error) => {
        elements.mpFeedback.textContent = normalizeMpError(error);
      });
    return;
  }
  startRoomBattleLocal();
}

function broadcastNextMpRound() {
  if (!backend.connected) {
    if (!mpState.roomCode) return;
    const room = roomStore[mpState.roomCode];
    if (!room || room.hostId !== state.profile.id) return;
    nextMpRoundFromRoom(room.code);
    return;
  }
  if (!mpState.roomCode) return;
  requestMp(`/rooms/${mpState.roomCode}/next`, { method: "POST", body: getMpBody() }).then((response) => {
    if (response?.room) {
      applyRoomState(response.room);
      renderMultiplayerRemote();
    }
  });
}

function handleMpSkip() {
  if (!backend.connected) {
    handleMpSkipLocal();
    return;
  }
  if (!mpState.roomCode) return;
  requestMp(`/rooms/${mpState.roomCode}/skip`, { method: "POST", body: getMpBody() }).then((response) => {
    if (response?.room) {
      applyRoomState(response.room);
      renderMultiplayerRemote();
    }
  });
}

function handleMpGuess() {
  if (!backend.connected) {
    handleMpGuessLocal();
    return;
  }
  const title = normalize(elements.mpTitleGuess.value);
  const artist = normalize(elements.mpArtistGuess.value);
  if (!title || !artist) {
    elements.mpFeedback.textContent = "Please fill title and artist.";
    return;
  }
  if (!mpState.roomCode) return;
  requestMp(`/rooms/${mpState.roomCode}/guess`, {
    method: "POST",
    body: {
      ...getMpBody(),
      title: elements.mpTitleGuess.value,
      artist: elements.mpArtistGuess.value,
    },
  })
    .then((response) => {
      if (!response) return;
      if (response.solved) {
        elements.mpFeedback.textContent = `Correct for ${response.score} points.`;
        addLeaderboardEntry("multiplayer", response.score);
        renderGlobalLeaderboard();
      } else if (response?.room) {
        elements.mpFeedback.textContent = "Incorrect in battle.";
      }
      if (response.room) {
        applyRoomState(response.room);
      }
    })
    .catch((error) => {
      elements.mpFeedback.textContent = normalizeMpError(error);
    });
}

function startRoomBattleLocal() {
  if (!mpState.roomCode) return;
  const room = roomStore[mpState.roomCode];
  if (!room || room.hostId !== state.profile.id || room.status !== "lobby") return;
  room.status = "active";
  room.round = 1;
  room.hintIndex = 0;
  room.difficulty = state.settings.difficulty;
  room.currentSongId = pickSongFromRoom(room);
  room.roundEndsAt = Date.now() + DIFFICULTY[room.difficulty].timeLimit * 1000;
  room.roundStartAt = Date.now();
  room.currentSongStart = Date.now();
  room.currentSongDuration = DIFFICULTY[room.difficulty].hints[0] * 1000;
  room.songClipEndAt = Date.now() + room.currentSongDuration;
  Object.keys(room.players).forEach((id) => {
    room.players[id].solved = false;
  });
  room.storeSongHint = renderHint(getRoomStoreSong(room.currentSongId), room.hintIndex);
  roomStore[room.code] = room;
  saveRoomStore();
  renderMultiplayerLocal();
}

function pickSongFromRoom(room) {
  const pool = roomPoolFromFilters(room);
  if (pool.length === 0) return SONG_LIBRARY[0].id;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx].id;
}

function nextMpRoundFromRoom(code) {
  const room = roomStore[code];
  if (!room || room.hostId !== state.profile.id) return;
  room.round += 1;
  room.hintIndex = 0;
  room.currentSongId = pickSongFromRoom(room);
  room.songClipEndAt = Date.now() + DIFFICULTY[room.difficulty].hints[0] * 1000;
  room.roundEndsAt = Date.now() + DIFFICULTY[room.difficulty].timeLimit * 1000;
  room.currentSongStart = Date.now();
  room.currentSongDuration = DIFFICULTY[room.difficulty].hints[0] * 1000;
  room.storeSongHint = renderHint(getRoomStoreSong(room.currentSongId), room.hintIndex);
  Object.keys(room.players).forEach((id) => {
    room.players[id].solved = false;
  });
  roomStore[room.code] = room;
  saveRoomStore();
  renderMultiplayerLocal();
}

function handleMpSkipLocal() {
  if (!mpState.roomCode) return;
  const room = roomStore[mpState.roomCode];
  if (!room || room.hostId !== state.profile.id || room.status !== "active") return;
  const diff = DIFFICULTY[room.difficulty];
  room.hintIndex = Math.min(room.hintIndex + 1, diff.hints.length - 1);
  room.currentSongDuration = diff.hints[room.hintIndex] * 1000;
  room.songClipEndAt = Date.now() + room.currentSongDuration;
  room.storeSongHint = renderHint(getRoomStoreSong(room.currentSongId), room.hintIndex);
  roomStore[room.code] = room;
  saveRoomStore();
  renderMultiplayerLocal();
}

function handleMpGuessLocal() {
  if (!mpState.roomCode || !activeRoomHasPlayer()) return;
  const room = roomStore[mpState.roomCode];
  if (!room || room.status !== "active" || !room.currentSongId) return;
  const title = normalize(elements.mpTitleGuess.value);
  const artist = normalize(elements.mpArtistGuess.value);
  if (!title || !artist) {
    elements.mpFeedback.textContent = "Please fill title and artist.";
    return;
  }
  const song = getRoomStoreSong(room.currentSongId);
  if (room.players[state.profile.id].solved) {
    elements.mpFeedback.textContent = "Already solved this round.";
    return;
  }
  if (normalize(song.title) === title && normalize(song.artist) === artist) {
    const remainingMs = Math.max(0, room.roundEndsAt - Date.now());
    const roundScore = computeMpScore(room.difficulty, room.hintIndex, remainingMs / 1000);
    room.players[state.profile.id].solved = true;
    room.players[state.profile.id].score = (room.players[state.profile.id].score || 0) + roundScore;
    elements.mpFeedback.textContent = `Correct for ${roundScore} points.`;
    roomStore[room.code] = room;
    saveRoomStore();
    renderMultiplayerLocal();
    addLeaderboardEntry("multiplayer", roundScore);
    renderGlobalLeaderboard();
    if (Object.values(room.players).every((p) => p.solved)) {
      setTimeout(() => {
        nextMpRoundFromRoom(room.code);
      }, 1000);
    }
  } else {
    elements.mpFeedback.textContent = "Incorrect in battle.";
  }
}

function computeMpScore(difficultyKey, hintIndex, remainingSec) {
  const diff = DIFFICULTY[difficultyKey];
  const ratio = 1 - hintIndex * 0.08;
  const hintBonus = 12 * (3 - hintIndex);
  const timeBonus = Math.max(0, remainingSec) * 8;
  return Math.max(20, Math.round((diff.scoreBase * 0.8 + hintBonus + timeBonus) * ratio));
}

function activeRoomHasPlayer() {
  if (!mpState.roomCode) return false;
  const room = roomStore[mpState.roomCode];
  if (!room) return false;
  return Boolean(room.players[state.profile.id]);
}

function syncMpTimer() {
  if (!mpState.running || !mpState.roundEndsAt) {
    if (mpState.roundEndsAt <= 0) {
      mpState.timerSecond = -1;
      elements.mpTimer.textContent = "Timer: --";
    }
    return;
  }

  const roundEndsAt = mpState.roundEndsAt;
  const remaining = Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000));
  if (remaining !== mpState.timerSecond) {
    mpState.timerSecond = remaining;
    elements.mpTimer.textContent = `Timer: ${remaining}s`;
  }
  if (remaining <= 0) {
    mpState.running = false;
    if (mpTick) {
      clearInterval(mpTick);
      mpTick = null;
    }
    mpState.timerSecond = 0;
    elements.mpTimer.textContent = "Timer: 0s";
  }
}

function mpRenderFromRoom(room) {
  if (!room.currentSongId) return;
  const song = getRoomStoreSong(room.currentSongId);
  const hintText = renderHint(song, room.hintIndex);
  if (!elements.mpFeedback.textContent.startsWith("Correct")) {
    elements.mpFeedback.textContent = `Hint: ${room.hintText || hintText}`;
  }
  if (room.status !== "active") return;
  mpState.song = song;
  mpState.songStartedAt = room.currentSongStart || Date.now();
  mpState.timeLimit = Math.ceil((room.roundEndsAt - room.currentSongStart) / 1000) || DIFFICULTY[room.difficulty].timeLimit;
  const nextRoundEndsAt = room.roundEndsAt || 0;
  if (nextRoundEndsAt !== mpState.roundEndsAt) {
    mpState.timerSecond = -1;
  }
  mpState.roundEndsAt = nextRoundEndsAt;
  mpState.running = true;
  syncMpTimer();
  if (!mpTick) {
    mpTick = setInterval(() => syncMpTimer(), MULTIPLAYER_TIMER_TICK_MS);
  }
}

function resetLocalRoomState() {
  stopRoomStreaming();
  resetRoomRenderState();
  mpState = mpStateFromDefaults();
  renderMultiplayer();
}

function shareCurrentRound() {
  if (!activeGame || !activeGame.song) return;
  const text = `I scored ${state.lastSessionScore} in Songless Clone on ${titleCase(state.settings.mode)} mode for ${activeGame.song.artist} — ${activeGame.song.title}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    elements.feedback.textContent = "Result copied to clipboard.";
  } else {
    elements.feedback.textContent = text;
  }
}

function shareMultiplayerResult() {
  if (!mpState.roomCode) return;
  const room = roomStore[mpState.roomCode];
  if (!room) return;
  const text = `Songless Clone room ${room.code} active with ${Object.keys(room.players).length} players.`;
  if (navigator.clipboard) navigator.clipboard.writeText(text);
}

function mpStateFromRoom(room) {
  mpState = {
    ...mpState,
    roomCode: room.code,
    running: room.status === "active",
    solved: false,
  };
}

function setupPeriodicSync() {
  window.addEventListener("storage", (event) => {
    if (event.key === ROOM_KEY && !backend.connected) {
      roomStore = loadRoomStore();
      renderMultiplayer();
      renderGlobalLeaderboard();
    }
  });
}

function setTickerOnLoad() {
  const today = new Date().toISOString().slice(0, 10);
  const hasPlayedDaily = state.leaderboards.daily[today]?.length > 0;
  if (state.settings.mode === "daily" && hasPlayedDaily) {
    setTicker(`Today's challenge available: ${today}.`);
  }
}

function startIntervalCleanup() {
  setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(state.leaderboards.daily);
    keys.forEach((key) => {
      if (key !== today) {
        delete state.leaderboards.daily[key];
      }
    });
  }, 3600 * 1000);
}

init();
setupPeriodicSync();
setTickerOnLoad();
startIntervalCleanup();
