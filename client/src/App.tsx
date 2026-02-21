import {
  Menu,
  LogIn,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Search,
  SkipForward,
  UserRound,
  UserPlus,
  Users,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const STATE_POLL_MS = 10_000;
const ROUND_DURATION_MS = 120_000;
const TOKEN_STORAGE_KEY = 'songless_token';
const ALIAS_STORAGE_KEY = 'songless_alias';
const AVATAR_STORAGE_KEY = 'songless_avatar_key';

const CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const SNIPPET_DURATIONS_MS = [100, 500, 2000, 4000, 8000, 15000];
const STAGE_ROW_COUNT = 6;
const STAGE_GENRES = ['All', 'Rock', 'Hip Hop'] as const;
const STAGE_TIMELINE_MARKERS_MS = [...SNIPPET_DURATIONS_MS, 30000, 60000, ROUND_DURATION_MS];
const STAGE_TIMELINE_SEGMENTS = (() => {
  let previousMarker = 0;
  return STAGE_TIMELINE_MARKERS_MS.map((markerMs) => {
    const width = Math.max(markerMs - previousMarker, 0);
    previousMarker = markerMs;
    return (width / ROUND_DURATION_MS) * 100;
  }).filter((segment) => segment > 0);
})();

const AVATAR_OPTIONS = [
  { id: 'nova', label: 'Nova', mark: 'NV', tone: 'tone-a' },
  { id: 'echo', label: 'Echo', mark: 'EC', tone: 'tone-b' },
  { id: 'rune', label: 'Rune', mark: 'RN', tone: 'tone-c' },
  { id: 'flux', label: 'Flux', mark: 'FX', tone: 'tone-d' },
  { id: 'atlas', label: 'Atlas', mark: 'AT', tone: 'tone-e' },
  { id: 'pulse', label: 'Pulse', mark: 'PL', tone: 'tone-f' },
] as const;

type AuthMode = 'login' | 'register';

type BusyAction =
  | ''
  | 'auth'
  | 'create'
  | 'join'
  | 'start'
  | 'guess'
  | 'skip'
  | 'chat'
  | 'leave'
  | 'sync';

type AvatarOption = (typeof AVATAR_OPTIONS)[number];
type GuessResultKind = 'miss' | 'artist' | 'solved' | 'skip';

type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  avatarKey?: string | null;
  friendCode?: string;
};

type AuthResponse = {
  user: PublicUser;
  token: string;
};

type RoomPlayerApi = {
  id: string;
  name: string;
  avatarKey?: string | null;
  score: number | string;
  solved: boolean;
  guessResults?: unknown;
  roundTimeMs?: number | string | null;
};

type RoomChatMessageApi = {
  id: string | number;
  playerId: string;
  playerName: string;
  avatarKey?: string | null;
  message: string;
  createdAt: string | number;
};

type RoomStateApi = {
  code: string;
  hostId: string;
  players?: Record<string, RoomPlayerApi>;
  status: 'lobby' | 'active' | string;
  round: number | string;
  hintIndex: number | string;
  settings?: Record<string, unknown>;
  createdAt?: string;
  currentSongId?: string | null;
  currentSong?: {
    id?: string | number;
    title?: string;
    artist?: string | { name?: string };
  } | null;
  roundStartedAt?: number | string | null;
  roundEndsAt?: number | string | null;
  version?: number | string | null;
  roundMaxAttempts?: number | string | null;
  chat?: RoomChatMessageApi[];
};

type RoomPlayer = {
  id: string;
  name: string;
  avatarKey: string | null;
  score: number;
  solved: boolean;
  guessResults: GuessResultKind[];
  roundTimeMs: number | null;
};

type RoomState = {
  code: string;
  hostId: string;
  players: Record<string, RoomPlayer>;
  status: 'lobby' | 'active' | string;
  round: number;
  hintIndex: number;
  settings: Record<string, unknown>;
  createdAt?: string;
  currentSongId: string | null;
  currentSong?: RoomStateApi['currentSong'];
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  version: number;
  roundMaxAttempts: number;
};

type RoomChatMessage = {
  id: string;
  playerId: string;
  playerName: string;
  avatarKey: string | null;
  message: string;
  createdAt: number;
};

type RoundEntry = {
  round: number;
  startedAt: number | null;
  songToken: string;
};

class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function api(path: string) {
  return `${API_URL}${path}`;
}

function socketBaseUrl() {
  if (API_URL) {
    return API_URL;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return undefined;
}

function safeStorageRead(key: string, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeStorageWrite(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore localStorage write failures.
  }
}

function safeStorageDelete(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore localStorage delete failures.
  }
}

function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toNumberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeGuessResult(value: unknown): GuessResultKind | null {
  const normalized = String(value || '').toLowerCase();
  if (
    normalized === 'miss' ||
    normalized === 'artist' ||
    normalized === 'solved' ||
    normalized === 'skip'
  ) {
    return normalized;
  }
  return null;
}

function normalizeGuessResults(value: unknown) {
  if (!Array.isArray(value)) return [] as GuessResultKind[];
  return value
    .map((entry) => normalizeGuessResult(entry))
    .filter((entry): entry is GuessResultKind => entry !== null)
    .slice(0, STAGE_ROW_COUNT);
}

function privateGuessKey(code: string, round: number, index: number) {
  return `${code}:${round}:${index}`;
}

function parseGuessInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { title: '', artist: '' };

  const dashSplit = trimmed.split(/\s*[-–—]\s*/);
  if (dashSplit.length > 1) {
    const [title, ...artistParts] = dashSplit;
    return {
      title: title.trim(),
      artist: artistParts.join(' - ').trim(),
    };
  }

  const byMatch = trimmed.match(/^(.*)\s+by\s+(.*)$/i);
  if (byMatch) {
    return {
      title: byMatch[1].trim(),
      artist: byMatch[2].trim(),
    };
  }

  return {
    title: trimmed,
    artist: '',
  };
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatRoundTime(ms: number | null) {
  if (!Number.isFinite(ms) || ms === null) return '--';
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatClock(epochMs: number) {
  return CLOCK_FORMATTER.format(epochMs);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function roomPayloadFromError(error: unknown): RoomStateApi | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  const room = error.payload?.room;
  if (!room || typeof room !== 'object') {
    return null;
  }
  return room as RoomStateApi;
}

function findAvatarByKey(key: string | null | undefined): AvatarOption | null {
  if (!key) return null;
  return AVATAR_OPTIONS.find((option) => option.id === key) || null;
}

function avatarMarkForPlayer(playerName: string, avatarKey: string | null | undefined) {
  const mapped = findAvatarByKey(avatarKey);
  if (mapped) return mapped.mark;
  const normalized = playerName.trim().split(/\s+/).filter(Boolean);
  if (normalized.length === 0) return '??';
  if (normalized.length === 1) {
    return normalized[0].slice(0, 2).toUpperCase().padEnd(2, '?');
  }
  return `${normalized[0][0]}${normalized[1][0]}`.toUpperCase();
}

function avatarToneForKey(key: string | null | undefined) {
  return findAvatarByKey(key)?.tone || 'tone-fallback';
}

function getSnippetDurationMs(hintIndex: number) {
  const index = Math.max(
    0,
    Math.min(
      Number.isFinite(hintIndex) ? Math.floor(hintIndex) : 0,
      SNIPPET_DURATIONS_MS.length - 1
    )
  );
  return SNIPPET_DURATIONS_MS[index];
}

function normalizeRoomState(room: RoomStateApi): RoomState {
  const sourcePlayers = room.players || {};
  const players: Record<string, RoomPlayer> = {};

  for (const [id, value] of Object.entries(sourcePlayers)) {
    players[id] = {
      id: value.id,
      name: value.name,
      avatarKey: value.avatarKey || null,
      score: toNumberOr(value.score, 0),
      solved: Boolean(value.solved),
      guessResults: normalizeGuessResults(value.guessResults),
      roundTimeMs: toNumberOrNull(value.roundTimeMs),
    };
  }

  const currentSongId =
    room.currentSongId != null
      ? String(room.currentSongId)
      : room.currentSong?.id != null
        ? String(room.currentSong.id)
        : null;

  const roundStartedAt = toNumberOrNull(room.roundStartedAt);
  const computedRoundEndsAt =
    roundStartedAt == null ? null : roundStartedAt + ROUND_DURATION_MS;

  return {
    code: room.code,
    hostId: room.hostId,
    players,
    status: room.status,
    round: toNumberOr(room.round, 0),
    hintIndex: toNumberOr(room.hintIndex, 0),
    settings: room.settings || {},
    createdAt: room.createdAt,
    currentSongId,
    currentSong: room.currentSong || null,
    roundStartedAt,
    roundEndsAt: toNumberOrNull(room.roundEndsAt) ?? computedRoundEndsAt,
    version: toNumberOr(room.version, 0),
    roundMaxAttempts: Math.max(1, Math.min(toNumberOr(room.roundMaxAttempts, STAGE_ROW_COUNT), 12)),
  };
}

function normalizeChatMessages(messages: RoomChatMessageApi[] | undefined) {
  if (!Array.isArray(messages)) return [] as RoomChatMessage[];
  return messages
    .map((message) => ({
      id: String(message.id),
      playerId: message.playerId,
      playerName: message.playerName,
      avatarKey: message.avatarKey || null,
      message: message.message,
      createdAt: toNumberOrNull(message.createdAt) ?? Date.now(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const { method = 'GET', token, body } = options;
  const headers: HeadersInit = {};

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(api(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const roomCodeRef = useRef('');
  const roomVersionRef = useRef<number>(0);
  const roomStateRef = useRef<RoomState | null>(null);
  const snippetStopTimeoutRef = useRef<number | null>(null);

  const [token, setToken] = useState(() => safeStorageRead(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState<PublicUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(Boolean(token));

  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');

  const [alias, setAlias] = useState(() => safeStorageRead(ALIAS_STORAGE_KEY));
  const [avatarKey, setAvatarKey] = useState<string>(() => {
    const stored = safeStorageRead(AVATAR_STORAGE_KEY, AVATAR_OPTIONS[0].id);
    return findAvatarByKey(stored)?.id || AVATAR_OPTIONS[0].id;
  });

  const [joinCode, setJoinCode] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [guessInput, setGuessInput] = useState('');
  const [privateGuessByKey, setPrivateGuessByKey] = useState<Record<string, string>>({});
  const [roundHistory, setRoundHistory] = useState<RoundEntry[]>([]);
  const [chatInput, setChatInput] = useState('');

  const [busyAction, setBusyAction] = useState<BusyAction>('');
  const [uiError, setUiError] = useState('');
  const [uiInfo, setUiInfo] = useState('');

  const [nowMs, setNowMs] = useState(Date.now());
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [onlinePlayerIds, setOnlinePlayerIds] = useState<string[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<
    'offline' | 'connecting' | 'connected' | 'reconnecting'
  >('offline');

  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [isStageMenuOpen, setIsStageMenuOpen] = useState(false);

  const selectedAvatar =
    AVATAR_OPTIONS.find((option) => option.id === avatarKey) || AVATAR_OPTIONS[0];
  const activeAlias = alias.trim() || user?.displayName || user?.username || 'Player';

  const isHost = Boolean(room && user && room.hostId === user.id);
  const roomCode = room?.code || '';
  const stageRowCount = room?.roundMaxAttempts ?? STAGE_ROW_COUNT;
  const currentPlayer = room && user ? room.players[user.id] || null : null;
  const players = useMemo(() => {
    if (!room) return [] as RoomPlayer[];
    return Object.values(room.players).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = a.roundTimeMs ?? Number.POSITIVE_INFINITY;
      const bTime = b.roundTimeMs ?? Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name);
    });
  }, [room]);

  const roundEndsAt = room?.roundEndsAt ?? null;
  const isRoundActive = Boolean(room?.status === 'active' && roundEndsAt);
  const remainingMs = isRoundActive
    ? Math.max((roundEndsAt as number) - nowMs, 0)
    : ROUND_DURATION_MS;
  const timerProgress = isRoundActive
    ? Math.min(((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS) * 100, 100)
    : 0;

  const currentSongId = room?.currentSongId;
  const sharedSongToken = currentSongId
    ? `TRACK-${currentSongId.slice(-4).toUpperCase()}`
    : 'TRACK-PENDING';
  const sharedAudioSrc = currentSongId
    ? api(
        `/api/audio/stream/${encodeURIComponent(currentSongId)}?hint=${Math.max(
          room?.hintIndex ?? 0,
          0
        ) + 1}`
      )
    : '';

  const canCreateOrJoin = Boolean(user && !room && !busyAction);
  const canStartRound = Boolean(room && isHost && room.status !== 'active' && !busyAction);
  const canSkipHint = Boolean(room && isHost && room.status === 'active' && !busyAction);
  const guessesUsed = currentPlayer?.guessResults.length ?? 0;
  const hasGuessesRemaining = guessesUsed < stageRowCount;
  const canGuess = Boolean(
    room &&
      room.status === 'active' &&
      !currentPlayer?.solved &&
      hasGuessesRemaining &&
      guessInput.trim() &&
      !busyAction
  );
  const isInRoom = Boolean(!sessionLoading && user && room);

  const stageSnippetDurationMs = getSnippetDurationMs(room?.hintIndex ?? 0);
  const stageSnippetDurationLabel = `${(stageSnippetDurationMs / 1000).toFixed(1)}seconds`;
  const stageSnippetPositionPercent = Math.max(
    1,
    Math.min((stageSnippetDurationMs / ROUND_DURATION_MS) * 100, 99)
  );
  const stageGuessRows = useMemo(() => {
    const ownResults = currentPlayer?.guessResults || [];
    return Array.from({ length: stageRowCount }, (_, index) => {
      const result = ownResults[index] || null;
      const rowKey =
        room && result ? privateGuessKey(room.code, room.round, index) : '';
      const guessText = rowKey ? privateGuessByKey[rowKey] || '' : '';
      const placeholder = !result;

      const fallbackLabel =
        result === 'skip'
          ? 'Skipped'
          : result === 'artist'
            ? 'Artist matched'
            : result === 'solved'
              ? 'Song + artist matched'
              : result === 'miss'
                ? 'Guess submitted'
                : '';

      return {
        id: `guess-row-${index}`,
        index,
        result,
        placeholder,
        guessLabel: guessText || fallbackLabel,
      };
    });
  }, [currentPlayer?.guessResults, privateGuessByKey, room, stageRowCount]);

  useEffect(() => {
    roomCodeRef.current = roomCode;
    roomVersionRef.current = room?.version ?? 0;
    roomStateRef.current = room;
  }, [room, roomCode]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const activePrefix = `${room.code}:${room.round}:`;
    setPrivateGuessByKey((previous) => {
      const nextEntries = Object.entries(previous).filter(([key]) =>
        key.startsWith(activePrefix)
      );
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [room?.code, room?.round]);

  const clearRoomState = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    if (snippetStopTimeoutRef.current !== null) {
      window.clearTimeout(snippetStopTimeoutRef.current);
      snippetStopTimeoutRef.current = null;
    }

    setRoom(null);
    setChatMessages([]);
    setGuessInput('');
    setPrivateGuessByKey({});
    setRoundHistory([]);
    setChatInput('');
    setNowMs(Date.now());
    setLastSyncedAt(null);
    setOnlinePlayerIds([]);
    setIsPlaying(false);
    setAudioError('');
    setIsStageMenuOpen(false);
  }, []);

  const clearSnippetStopTimeout = useCallback(() => {
    if (snippetStopTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(snippetStopTimeoutRef.current);
    snippetStopTimeoutRef.current = null;
  }, []);

  const scheduleSnippetStop = useCallback(() => {
    clearSnippetStopTimeout();
    const audio = audioRef.current;
    if (!audio || audio.paused || !sharedAudioSrc) {
      return;
    }

    const hintIndex = toNumberOr(room?.hintIndex, 0);
    const stopAfterMs = getSnippetDurationMs(hintIndex);
    snippetStopTimeoutRef.current = window.setTimeout(() => {
      const currentAudio = audioRef.current;
      if (!currentAudio || currentAudio.paused) {
        return;
      }
      currentAudio.pause();
    }, stopAfterMs);
  }, [clearSnippetStopTimeout, room?.hintIndex, sharedAudioSrc]);

  const applyRoomPayload = useCallback((roomPayload: RoomStateApi) => {
    const normalizedRoom = normalizeRoomState(roomPayload);
    const currentRoom = roomStateRef.current;
    if (
      currentRoom &&
      currentRoom.code === normalizedRoom.code &&
      Number(normalizedRoom.version) < Number(currentRoom.version)
    ) {
      return;
    }

    const normalizedChat = normalizeChatMessages(roomPayload.chat);
    const songToken =
      normalizedRoom.currentSongId != null
        ? `TRACK-${normalizedRoom.currentSongId.slice(-4).toUpperCase()}`
        : 'TRACK-PENDING';

    setRoom(normalizedRoom);
    setChatMessages(normalizedChat);
    setLastSyncedAt(Date.now());

    if (normalizedRoom.round > 0) {
      setRoundHistory((previous) => {
        const next = [...previous];
        const existingIndex = next.findIndex((entry) => entry.round === normalizedRoom.round);
        const entry: RoundEntry = {
          round: normalizedRoom.round,
          startedAt: normalizedRoom.roundStartedAt,
          songToken,
        };

        if (existingIndex >= 0) {
          next[existingIndex] = entry;
        } else {
          next.push(entry);
        }

        return next
          .sort((a, b) => a.round - b.round)
          .slice(-12);
      });
    }
  }, []);

  const refreshRoomState = useCallback(async () => {
    if (!token || !roomCode) return;
    const payload = await apiRequest<{ room: RoomStateApi }>(
      `/api/rooms/${encodeURIComponent(roomCode)}/state`,
      { token }
    );
    applyRoomPayload(payload.room);
  }, [applyRoomPayload, roomCode, token]);

  useEffect(() => {
    if (token) {
      safeStorageWrite(TOKEN_STORAGE_KEY, token);
    } else {
      safeStorageDelete(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    safeStorageWrite(ALIAS_STORAGE_KEY, alias);
  }, [alias]);

  useEffect(() => {
    safeStorageWrite(AVATAR_STORAGE_KEY, avatarKey);
  }, [avatarKey]);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setRealtimeStatus('offline');
      return;
    }

    setRealtimeStatus('connecting');
    const socket = io(socketBaseUrl(), {
      path: '/socket.io',
      transports: ['websocket'],
      auth: {
        token,
      },
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
    });
    socketRef.current = socket;

    const handleConnect = () => {
      setRealtimeStatus('connected');
      const currentRoomCode = roomCodeRef.current;
      if (currentRoomCode) {
        socket.emit('room:join', {
          code: currentRoomCode,
          lastVersion: roomVersionRef.current,
        });
      }
    };

    const handleDisconnect = () => {
      setRealtimeStatus('reconnecting');
    };

    const handleConnectError = (error: Error) => {
      setRealtimeStatus('offline');
      if (error?.message === 'Unauthorized') {
        setUiError('Realtime authentication failed.');
      }
    };

    const handleRoomSync = (payload: { room?: RoomStateApi }) => {
      if (!payload?.room) {
        return;
      }
      applyRoomPayload(payload.room);
    };

    const handleRoomUpdate = (payload: { room?: RoomStateApi }) => {
      if (!payload?.room) {
        return;
      }
      applyRoomPayload(payload.room);
    };

    const handleRoomChat = (payload: {
      code?: string;
      message?: RoomChatMessageApi;
      meta?: { version?: number | string };
    }) => {
      const code = normalizeRoomCode(payload?.code || '');
      if (!code || code !== roomCodeRef.current || !payload.message) {
        return;
      }

      const normalized = normalizeChatMessages([payload.message]);
      if (normalized[0]) {
        setChatMessages((previous) => {
          if (previous.some((item) => item.id === normalized[0].id)) {
            return previous;
          }
          return [...previous, normalized[0]]
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(-100);
        });
      }

      const incomingVersion = toNumberOr(payload?.meta?.version, roomVersionRef.current);
      setRoom((previous) => {
        if (!previous || previous.code !== code) {
          return previous;
        }
        if (incomingVersion <= previous.version) {
          return previous;
        }
        return {
          ...previous,
          version: incomingVersion,
        };
      });
    };

    const handleRoomPresence = (payload: {
      code?: string;
      onlinePlayerIds?: string[];
    }) => {
      const code = normalizeRoomCode(payload?.code || '');
      if (!code || code !== roomCodeRef.current) {
        return;
      }
      setOnlinePlayerIds(Array.isArray(payload.onlinePlayerIds) ? payload.onlinePlayerIds : []);
    };

    const handleRoomClosed = (payload: { code?: string }) => {
      const code = normalizeRoomCode(payload?.code || '');
      if (!code || code !== roomCodeRef.current) {
        return;
      }
      clearRoomState();
      setUiError('Room was closed.');
    };

    const handleRoomError = (payload: { error?: string }) => {
      if (payload?.error) {
        setUiError(payload.error);
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('room:sync', handleRoomSync);
    socket.on('room:update', handleRoomUpdate);
    socket.on('room:chat', handleRoomChat);
    socket.on('room:presence', handleRoomPresence);
    socket.on('room:closed', handleRoomClosed);
    socket.on('room:error', handleRoomError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('room:sync', handleRoomSync);
      socket.off('room:update', handleRoomUpdate);
      socket.off('room:chat', handleRoomChat);
      socket.off('room:presence', handleRoomPresence);
      socket.off('room:closed', handleRoomClosed);
      socket.off('room:error', handleRoomError);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [applyRoomPayload, clearRoomState, token]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    if (!roomCode) {
      setOnlinePlayerIds([]);
      socket.emit('room:leave');
      return;
    }

    if (socket.connected) {
      socket.emit('room:join', {
        code: roomCode,
        lastVersion: roomVersionRef.current,
      });
    }
  }, [roomCode]);

  useEffect(() => {
    let active = true;

    if (!token) {
      setUser(null);
      setSessionLoading(false);
      return () => {
        active = false;
      };
    }

    setSessionLoading(true);
    apiRequest<PublicUser>('/api/users/me', { token })
      .then((profile) => {
        if (!active) return;
        setUser(profile);
        if (!alias.trim()) {
          setAlias(profile.displayName || profile.username);
        }
        if (profile.avatarKey && findAvatarByKey(profile.avatarKey)) {
          setAvatarKey(profile.avatarKey);
        }
      })
      .catch(() => {
        if (!active) return;
        setToken('');
        setUser(null);
        clearRoomState();
        setUiError('Session expired. Please sign in again.');
      })
      .finally(() => {
        if (active) {
          setSessionLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [clearRoomState, token]);

  useEffect(() => {
    if (!roomCode || !token) return;

    let active = true;

    const poll = async () => {
      try {
        const payload = await apiRequest<{ room: RoomStateApi }>(
          `/api/rooms/${encodeURIComponent(roomCode)}/state`,
          { token }
        );
        if (!active) return;
        applyRoomPayload(payload.room);
        setUiError('');
      } catch (error) {
        if (!active) return;

        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          clearRoomState();
          setUiError('Room is no longer available.');
          return;
        }

        setUiError(getErrorMessage(error, 'Failed to sync room state.'));
      }
    };

    poll();
    const interval = window.setInterval(poll, STATE_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [applyRoomPayload, clearRoomState, roomCode, token]);

  useEffect(() => {
    if (!isRoundActive) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRoundActive, room?.round]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      scheduleSnippetStop();
    };
    const onPause = () => {
      clearSnippetStopTimeout();
      setIsPlaying(false);
    };
    const onEnded = () => {
      clearSnippetStopTimeout();
      setIsPlaying(false);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      clearSnippetStopTimeout();
    };
  }, [clearSnippetStopTimeout, scheduleSnippetStop]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    clearSnippetStopTimeout();
    setIsPlaying(false);
    setAudioError('');
  }, [sharedAudioSrc]);

  useEffect(() => {
    if (!isPlaying) return;
    scheduleSnippetStop();
  }, [isPlaying, room?.hintIndex, scheduleSnippetStop]);

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyAction) return;

    const username = authUsername.trim();
    const password = authPassword.trim();
    const displayName = authDisplayName.trim();

    if (!username || !password || (authMode === 'register' && !displayName)) {
      setUiError('Complete all required fields.');
      return;
    }

    setBusyAction('auth');
    setUiError('');
    setUiInfo('');

    try {
      const path = authMode === 'login' ? '/api/users/login' : '/api/users/register';
      const payload = await apiRequest<AuthResponse>(path, {
        method: 'POST',
        body:
          authMode === 'login'
            ? { username, password }
            : { username, password, displayName },
      });

      setToken(payload.token);
      setUser(payload.user);
      setAuthPassword('');
      if (!alias.trim()) {
        setAlias(payload.user.displayName || payload.user.username);
      }
      if (payload.user.avatarKey && findAvatarByKey(payload.user.avatarKey)) {
        setAvatarKey(payload.user.avatarKey);
      }
      setUiInfo(authMode === 'login' ? 'Signed in.' : 'Account created.');
    } catch (error) {
      setUiError(getErrorMessage(error, 'Authentication failed.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleCreateRoom = async () => {
    if (!token || busyAction) return;

    setBusyAction('create');
    setUiError('');
    setUiInfo('');

    try {
      const payload = await apiRequest<{ room: RoomStateApi }>('/api/rooms', {
        method: 'POST',
        token,
        body: {
          player: {
            name: activeAlias,
            avatarKey: selectedAvatar.id,
          },
          mode: 'multiplayer',
          difficulty: 'normal',
          genre: 'Any',
          decade: 'Any',
        },
      });

      setPrivateGuessByKey({});
      setRoundHistory([]);
      setChatInput('');
      applyRoomPayload(payload.room);
      setJoinCode(payload.room.code);
      setUiInfo(`Room ${payload.room.code} created.`);
    } catch (error) {
      setUiError(getErrorMessage(error, 'Unable to create room.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleJoinRoom = async () => {
    if (!token || busyAction) return;

    const code = normalizeRoomCode(joinCode);
    if (code.length !== 6) {
      setUiError('Room code must be 6 characters.');
      return;
    }

    setBusyAction('join');
    setUiError('');
    setUiInfo('');

    try {
      const payload = await apiRequest<{ room: RoomStateApi }>(
        `/api/rooms/${encodeURIComponent(code)}/join`,
        {
          method: 'POST',
          token,
          body: {
            player: {
              name: activeAlias,
              avatarKey: selectedAvatar.id,
            },
          },
        }
      );

      setPrivateGuessByKey({});
      setRoundHistory([]);
      setChatInput('');
      applyRoomPayload(payload.room);
      setUiInfo(`Joined room ${payload.room.code}.`);
    } catch (error) {
      setUiError(getErrorMessage(error, 'Unable to join room.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleStartRound = async () => {
    if (!room || !token || !isHost || busyAction) return;

    setBusyAction('start');
    setUiError('');

    try {
      const payload = await apiRequest<{ room: RoomStateApi }>(
        `/api/rooms/${encodeURIComponent(room.code)}/start`,
        {
          method: 'POST',
          token,
          body: {
            expectedRound: room.round,
            expectedVersion: room.version,
          },
        }
      );
      applyRoomPayload(payload.room);
      setUiInfo(`Round ${payload.room.round} started.`);
    } catch (error) {
      const roomPayload = roomPayloadFromError(error);
      if (roomPayload) {
        applyRoomPayload(roomPayload);
      }
      setUiError(getErrorMessage(error, 'Unable to start round.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleSkipHint = async () => {
    if (!room || !token || !isHost || busyAction) return;

    setBusyAction('skip');
    setUiError('');

    try {
      const payload = await apiRequest<{ room: RoomStateApi }>(
        `/api/rooms/${encodeURIComponent(room.code)}/skip`,
        {
          method: 'POST',
          token,
          body: {
            expectedRound: room.round,
            expectedVersion: room.version,
          },
        }
      );
      applyRoomPayload(payload.room);
      setUiInfo(`Hint moved to level ${toNumberOr(payload.room.hintIndex, 0) + 1}.`);
    } catch (error) {
      const roomPayload = roomPayloadFromError(error);
      if (roomPayload) {
        applyRoomPayload(roomPayload);
      }
      setUiError(getErrorMessage(error, 'Unable to skip hint.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleSubmitGuess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!room || !token || busyAction || room.status !== 'active') return;

    const parsedGuess = parseGuessInput(guessInput);
    if (!parsedGuess.title && !parsedGuess.artist) {
      setUiError('Enter a song and artist guess.');
      return;
    }

    setBusyAction('guess');
    setUiError('');

    try {
      const payload = await apiRequest<{
        solved: boolean;
        room: RoomStateApi;
        guessResult?: GuessResultKind | null;
        guessIndex?: number | null;
      }>(
        `/api/rooms/${encodeURIComponent(room.code)}/guess`,
        {
          method: 'POST',
          token,
          body: {
            title: parsedGuess.title,
            artist: parsedGuess.artist,
            expectedRound: room.round,
            expectedVersion: room.version,
          },
        }
      );

      applyRoomPayload(payload.room);
      const guessIndex = toNumberOrNull(payload.guessIndex);
      if (guessIndex !== null && guessIndex >= 0) {
        const guessKey = privateGuessKey(room.code, room.round, guessIndex);
        const guessLabel = `${parsedGuess.title || '(no title)'} - ${parsedGuess.artist || '(no artist)'}`;
        setPrivateGuessByKey((previous) => ({
          ...previous,
          [guessKey]: guessLabel,
        }));
      }
      setGuessInput('');
      if (payload.solved) {
        setUiInfo('Correct. You solved this round.');
      } else if (payload.guessResult === 'artist') {
        setUiInfo('Artist matched.');
      } else {
        setUiInfo('Guess submitted.');
      }
    } catch (error) {
      const roomPayload = roomPayloadFromError(error);
      if (roomPayload) {
        applyRoomPayload(roomPayload);
      }
      setUiError(getErrorMessage(error, 'Unable to submit guess.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleSendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!room || !token || busyAction) return;

    const message = chatInput.trim();
    if (!message) return;

    setBusyAction('chat');
    setUiError('');

    try {
      const payload = await apiRequest<{ message: RoomChatMessageApi }>(
        `/api/rooms/${encodeURIComponent(room.code)}/chat`,
        {
          method: 'POST',
          token,
          body: {
            message,
            expectedVersion: room.version,
          },
        }
      );

      const normalized = normalizeChatMessages([payload.message]);
      if (normalized[0]) {
        setChatMessages((previous) => [...previous, normalized[0]].slice(-100));
      }
      const updatedVersion = toNumberOr((payload as { version?: number | string }).version, room.version);
      setRoom((previous) => {
        if (!previous) {
          return previous;
        }
        if (updatedVersion <= previous.version) {
          return previous;
        }
        return {
          ...previous,
          version: updatedVersion,
        };
      });
      setChatInput('');
    } catch (error) {
      const roomPayload = roomPayloadFromError(error);
      if (roomPayload) {
        applyRoomPayload(roomPayload);
      }
      setUiError(getErrorMessage(error, 'Unable to send chat.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleManualSync = async () => {
    if (!room || !token || busyAction) return;
    setIsStageMenuOpen(false);
    setBusyAction('sync');
    setUiError('');

    try {
      await refreshRoomState();
    } catch (error) {
      setUiError(getErrorMessage(error, 'Unable to sync room.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleLeaveRoom = async () => {
    if (!room || !token || busyAction) return;

    setIsStageMenuOpen(false);
    setBusyAction('leave');
    setUiError('');

    try {
      await apiRequest<{ room: RoomStateApi | null }>(
        `/api/rooms/${encodeURIComponent(room.code)}/leave`,
        {
          method: 'POST',
          token,
        }
      );

      clearRoomState();
      setJoinCode('');
      setUiInfo('You left the room.');
    } catch (error) {
      setUiError(getErrorMessage(error, 'Unable to leave room.'));
    } finally {
      setBusyAction('');
    }
  };

  const handleTogglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !sharedAudioSrc) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
      setAudioError('');
    } catch {
      setAudioError('Playback blocked by browser. Press play again.');
    }
  };

  const handleSignOut = () => {
    setIsStageMenuOpen(false);
    clearRoomState();
    setUser(null);
    setToken('');
    setUiInfo('Signed out.');
  };

  return (
    <div className="arena-root">
      <div className="background-glow" aria-hidden />

      {!isInRoom && (
        <header className="arena-header">
          <div className="brand-shell">
            <span className="brand-icon">
              <Users size={18} />
            </span>
            <div>
              <p className="eyebrow">Shared Multiplayer</p>
              <h1>Songless Arena</h1>
            </div>
          </div>

          {user && (
            <div className="header-right">
              <span className={`avatar-pill ${selectedAvatar.tone}`}>{selectedAvatar.mark}</span>
              <span className="header-name">{activeAlias}</span>
              {room && <span className="room-code-pill">{room.code}</span>}
              <button className="ghost-btn" type="button" onClick={handleSignOut}>
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </header>
      )}

      <main className={`arena-main ${isInRoom ? 'arena-main-stage' : ''}`}>
        {sessionLoading && (
          <section className="panel loading-panel">
            <h2>Checking session</h2>
            <p>Connecting to multiplayer backend...</p>
          </section>
        )}

        {!sessionLoading && !user && (
          <section className="auth-grid">
            <article className="panel intro-panel">
              <h2>Everyone gets the same song and advances together.</h2>
              <p>
                Host starts the room, every player gets the same two-minute round timer, and the
                server advances songs sequentially for everyone.
              </p>
              <ul className="feature-list">
                <li>Shared 2-minute rounds</li>
                <li>Server-synced progression</li>
                <li>Realtime-feeling room polling</li>
                <li>Persistent room chat + avatar identity</li>
              </ul>
            </article>

            <article className="panel auth-panel">
              <div className="auth-mode">
                <button
                  type="button"
                  className={authMode === 'login' ? 'active' : ''}
                  onClick={() => setAuthMode('login')}
                >
                  <LogIn size={14} />
                  Login
                </button>
                <button
                  type="button"
                  className={authMode === 'register' ? 'active' : ''}
                  onClick={() => setAuthMode('register')}
                >
                  <UserPlus size={14} />
                  Register
                </button>
              </div>

              <form className="stack-form" onSubmit={handleAuthSubmit}>
                <label>
                  Username
                  <input
                    value={authUsername}
                    onChange={(event) => setAuthUsername(event.target.value)}
                    autoComplete="username"
                  />
                </label>

                {authMode === 'register' && (
                  <label>
                    Display name
                    <input
                      value={authDisplayName}
                      onChange={(event) => setAuthDisplayName(event.target.value)}
                      autoComplete="name"
                    />
                  </label>
                )}

                <label>
                  Password
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  />
                </label>

                <button className="primary-btn" type="submit" disabled={busyAction === 'auth'}>
                  {busyAction === 'auth'
                    ? 'Working...'
                    : authMode === 'login'
                      ? 'Sign in'
                      : 'Create account'}
                </button>
              </form>
            </article>
          </section>
        )}

        {!sessionLoading && user && !room && (
          <section className="lobby-grid">
            <article className="panel profile-panel">
              <h2>Player setup</h2>
              <p>Choose your multiplayer identity before creating or joining a room.</p>

              <label className="inline-field">
                Alias
                <input
                  value={alias}
                  onChange={(event) => setAlias(event.target.value)}
                  placeholder={user.displayName || user.username}
                />
              </label>

              <div className="avatar-grid" role="radiogroup" aria-label="Avatar picker">
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`avatar-option ${option.tone} ${option.id === selectedAvatar.id ? 'selected' : ''}`}
                    onClick={() => setAvatarKey(option.id)}
                  >
                    <span>{option.mark}</span>
                    <small>{option.label}</small>
                  </button>
                ))}
              </div>

              <p className="meta-line">
                Logged in as <strong>{user.username}</strong>{' '}
                {user.friendCode ? `(friend code ${user.friendCode})` : ''}
              </p>
            </article>

            <article className="panel room-panel">
              <h2>Room actions</h2>
              <p>Create your room or join an existing one with a code.</p>

              <button
                className="primary-btn"
                type="button"
                onClick={handleCreateRoom}
                disabled={!canCreateOrJoin}
              >
                <Plus size={14} />
                {busyAction === 'create' ? 'Creating...' : 'Create room'}
              </button>

              <div className="join-row">
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                  placeholder="ABC123"
                  maxLength={6}
                />
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={handleJoinRoom}
                  disabled={!canCreateOrJoin}
                >
                  {busyAction === 'join' ? 'Joining...' : 'Join'}
                </button>
              </div>
            </article>
          </section>
        )}

        {!sessionLoading && user && room && (
          <section className="stage-room">
            <article className="stage-shell">
              <div className="stage-top-row">
                <div className="stage-menu-wrap">
                  <button
                    className="stage-icon-btn"
                    type="button"
                    onClick={() => setIsStageMenuOpen((previous) => !previous)}
                    aria-label="Toggle room menu"
                    aria-expanded={isStageMenuOpen}
                  >
                    <Menu size={18} />
                  </button>

                  {isStageMenuOpen && (
                    <div className="stage-menu-panel">
                      <p className="stage-menu-meta">
                        Room {room.code} · v{room.version} · {realtimeStatus}
                      </p>
                      <button
                        className="stage-menu-btn"
                        type="button"
                        onClick={handleManualSync}
                        disabled={Boolean(busyAction)}
                      >
                        <RefreshCcw size={14} />
                        {busyAction === 'sync' ? 'Syncing...' : 'Sync room'}
                      </button>
                      {isHost && room.status !== 'active' && (
                        <button
                          className="stage-menu-btn"
                          type="button"
                          onClick={() => {
                            setIsStageMenuOpen(false);
                            void handleStartRound();
                          }}
                          disabled={!canStartRound}
                        >
                          {busyAction === 'start' ? 'Starting...' : 'Start round'}
                        </button>
                      )}
                      {isHost && room.status === 'active' && (
                        <button
                          className="stage-menu-btn"
                          type="button"
                          onClick={() => {
                            setIsStageMenuOpen(false);
                            void handleSkipHint();
                          }}
                          disabled={!canSkipHint}
                        >
                          <SkipForward size={14} />
                          {busyAction === 'skip' ? 'Skipping...' : 'Skip hint'}
                        </button>
                      )}
                      <button
                        className="stage-menu-btn"
                        type="button"
                        onClick={handleLeaveRoom}
                        disabled={busyAction === 'leave'}
                      >
                        <LogOut size={14} />
                        {busyAction === 'leave' ? 'Leaving...' : 'Leave room'}
                      </button>
                      <button className="stage-menu-btn" type="button" onClick={handleSignOut}>
                        Sign out
                      </button>
                    </div>
                  )}
                </div>

                <button
                  className="stage-icon-btn stage-profile-btn"
                  type="button"
                  onClick={() => setIsStageMenuOpen((previous) => !previous)}
                  aria-label="Open player menu"
                >
                  <UserRound size={18} />
                </button>
              </div>

              <div className="stage-brand">
                <h2>Songless</h2>
                <p>
                  {activeAlias} · Room {room.code} · Round {Math.max(room.round, 0)}
                </p>
              </div>

              <div className="stage-genre-tabs" role="tablist" aria-label="Genre filters">
                {STAGE_GENRES.map((genre, index) => (
                  <button
                    key={genre}
                    type="button"
                    className={`stage-genre-tab ${index === 0 ? 'active' : ''}`}
                    aria-selected={index === 0}
                  >
                    {genre}
                  </button>
                ))}
              </div>

              <ul className="stage-answer-rows" aria-label="Recent guesses">
                {stageGuessRows.map((entry) => (
                  <li
                    key={entry.id}
                    className={`stage-answer-row ${
                      entry.placeholder ? 'placeholder' : `result-${entry.result}`
                    }`}
                  >
                    {entry.placeholder ? (
                      <span className="stage-row-placeholder" aria-hidden />
                    ) : (
                      <>
                        <strong>{entry.guessLabel}</strong>
                        <small>
                          {entry.result === 'solved'
                            ? 'Song and artist correct'
                            : entry.result === 'artist'
                              ? 'Artist correct'
                              : entry.result === 'skip'
                                ? 'Skipped'
                                : 'Not correct'}
                        </small>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <div className="stage-timeline">
                <div
                  className="stage-duration-marker"
                  style={{ left: `${stageSnippetPositionPercent}%` }}
                >
                  <span>{stageSnippetDurationLabel}</span>
                  <i aria-hidden />
                </div>
                <div className="stage-track">
                  <span className="stage-track-progress" style={{ width: `${timerProgress}%` }} />
                  <div className="stage-track-segments">
                    {STAGE_TIMELINE_SEGMENTS.map((segmentWidth, index) => (
                      <span key={`segment-${index}`} style={{ flexBasis: `${segmentWidth}%` }} />
                    ))}
                  </div>
                </div>
              </div>

              <button
                className="stage-play-btn"
                type="button"
                onClick={handleTogglePlayback}
                disabled={!sharedAudioSrc}
                aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
              >
                {isPlaying ? <Pause size={26} /> : <Play size={26} fill="currentColor" />}
              </button>

              <form className="stage-guess-form" onSubmit={handleSubmitGuess}>
                <label className="stage-search-field">
                  <Search size={18} />
                  <input
                    value={guessInput}
                    onChange={(event) => setGuessInput(event.target.value)}
                    placeholder="Search a song"
                    disabled={
                      room.status !== 'active' ||
                      busyAction === 'guess' ||
                      !hasGuessesRemaining ||
                      Boolean(currentPlayer?.solved)
                    }
                  />
                </label>
                <button
                  className="stage-skip-btn"
                  type="button"
                  onClick={() => {
                    if (room.status === 'active') {
                      void handleSkipHint();
                      return;
                    }
                    void handleStartRound();
                  }}
                  disabled={room.status === 'active' ? !canSkipHint : !canStartRound}
                >
                  {room.status === 'active'
                    ? busyAction === 'skip'
                      ? 'Skipping...'
                      : 'Skip'
                    : busyAction === 'start'
                      ? 'Starting...'
                      : 'Start'}
                </button>
              </form>

              <p className="stage-hint-text">
                {room.status === 'active'
                  ? currentPlayer?.solved
                    ? 'Round complete. You solved this song.'
                    : !hasGuessesRemaining
                      ? 'No guesses left this round.'
                      : canGuess
                    ? 'Press Enter to submit your guess.'
                    : 'Type a guess and press Enter.'
                  : isHost
                    ? 'Start the round to begin shared playback.'
                    : 'Waiting for the host to start the round.'}{' '}
                {sharedSongToken} · {onlinePlayerIds.length} online ·{' '}
                {lastSyncedAt ? `Synced ${formatClock(lastSyncedAt)}` : 'Sync pending'} ·{' '}
                {room.status === 'active'
                  ? `${formatDuration(remainingMs)} left · ${Math.max(stageRowCount - guessesUsed, 0)} guesses left`
                  : 'Lobby state'}
              </p>

              <section className="stage-player-results" aria-label="Players guess progress">
                {players.map((playerEntry) => (
                  <div
                    key={playerEntry.id}
                    className={`stage-player-row ${user.id === playerEntry.id ? 'you' : ''}`}
                  >
                    <div className="stage-player-meta">
                      <span className={`avatar-mini ${avatarToneForKey(playerEntry.avatarKey)}`}>
                        {avatarMarkForPlayer(playerEntry.name, playerEntry.avatarKey)}
                      </span>
                      <strong>
                        {playerEntry.name}
                        {user.id === playerEntry.id ? ' (You)' : ''}
                      </strong>
                      {playerEntry.roundTimeMs !== null && (
                        <span className="stage-player-time">
                          {formatRoundTime(playerEntry.roundTimeMs)}
                        </span>
                      )}
                    </div>
                    <div
                      className="stage-player-bars"
                      style={{ gridTemplateColumns: `repeat(${stageRowCount}, minmax(0, 1fr))` }}
                    >
                      {Array.from({ length: stageRowCount }, (_, index) => {
                        const result = playerEntry.guessResults[index] || 'pending';
                        return (
                          <span
                            key={`${playerEntry.id}-guess-${index}`}
                            className={`stage-player-bar ${result}`}
                            aria-label={
                              result === 'solved'
                                ? 'Solved'
                                : result === 'artist'
                                  ? 'Artist matched'
                                  : result === 'skip'
                                    ? 'Skipped'
                                    : result === 'miss'
                                      ? 'Not correct'
                                      : 'Pending'
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            </article>
          </section>
        )}

        {uiInfo && <p className="info-line">{uiInfo}</p>}
        {uiError && <p className="error-line">{uiError}</p>}
        {audioError && <p className="error-line">{audioError}</p>}
      </main>

      <audio ref={audioRef} src={sharedAudioSrc} preload="metadata" />
    </div>
  );
}

export default App;
