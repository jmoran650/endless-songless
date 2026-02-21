const axios = require('axios');

const DEFAULT_API_BASE = 'https://api.deezer.com';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PLAYLIST_QUERY = 'top';
const DEFAULT_SEARCH_LIMIT = 10;

let playlistCache = {
  key: '',
  expiresAt: 0,
  data: null,
};

class DeezerError extends Error {
  constructor(message, { status = 500, code = 'DEEZER_ERROR', cause = undefined } = {}) {
    super(message);
    this.name = 'DeezerError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function normalizeAxiosError(error) {
  if (!axios.isAxiosError(error)) {
    return new DeezerError('Unexpected Deezer error.', {
      status: 502,
      code: 'DEEZER_REQUEST_FAILED',
      cause: error,
    });
  }

  const status = error.response?.status;

  if (status === 401 || status === 403) {
    return new DeezerError('Deezer API rejected request.', {
      status: 502,
      code: 'DEEZER_AUTH_FAILED',
      cause: error,
    });
  }

  if (status === 404) {
    return new DeezerError('Deezer resource was not found.', {
      status: 404,
      code: 'DEEZER_NOT_FOUND',
      cause: error,
    });
  }

  if (status && status >= 500) {
    return new DeezerError('Deezer is temporarily unavailable.', {
      status: 502,
      code: 'DEEZER_UPSTREAM_ERROR',
      cause: error,
    });
  }

  if (error.code === 'ECONNABORTED') {
    return new DeezerError('Deezer request timed out.', {
      status: 504,
      code: 'DEEZER_TIMEOUT',
      cause: error,
    });
  }

  return new DeezerError('Failed to reach Deezer.', {
    status: 502,
    code: 'DEEZER_REQUEST_FAILED',
    cause: error,
  });
}

function getDeezerConfig() {
  const playlistId = String(process.env.DEEZER_PLAYLIST_ID || '').trim();
  const apiBase = process.env.DEEZER_API_BASE_URL || DEFAULT_API_BASE;
  const cacheTtlMs = Number(process.env.DEEZER_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS);
  const playlistQuery = String(process.env.DEEZER_PLAYLIST_QUERY || DEFAULT_PLAYLIST_QUERY).trim() || DEFAULT_PLAYLIST_QUERY;

  return {
    playlistId,
    playlistQuery,
    apiBase,
    cacheTtlMs: Number.isFinite(cacheTtlMs) && cacheTtlMs > 0 ? cacheTtlMs : DEFAULT_CACHE_TTL_MS,
  };
}

async function resolvePlaylistId({ playlistId, playlistQuery, apiBase }) {
  if (playlistId) {
    return playlistId;
  }

  let searchResults;
  try {
    const response = await axios.get(`${apiBase}/search/playlist`, {
      params: {
        q: playlistQuery,
        limit: 1,
      },
      timeout: 12_000,
    });
    searchResults = response.data;
  } catch (error) {
    throw normalizeAxiosError(error);
  }

  const discoveredPlaylist = Array.isArray(searchResults?.data)
    ? searchResults.data.find((playlist) => playlist?.id)
    : null;
  const discoveredPlaylistId = discoveredPlaylist?.id ? String(discoveredPlaylist.id) : '';

  if (!discoveredPlaylistId) {
    throw new DeezerError(`No Deezer playlists found for query "${playlistQuery}".`, {
      status: 503,
      code: 'DEEZER_PLAYLIST_NOT_FOUND',
    });
  }

  return discoveredPlaylistId;
}

function parsePlayableTrack(track) {
  const previewUrl = track?.preview || '';
  if (!track?.id || !previewUrl) {
    return null;
  }

  return {
    id: String(track.id),
    title: track.title || 'Untitled',
    artist: track.artist?.name || 'Unknown Artist',
    durationMs: Number(track.duration) ? Number(track.duration) * 1000 : 0,
    previewUrl,
    permalinkUrl: track.link || null,
    artworkUrl: track.album?.cover_medium || track.album?.cover || track.artist?.picture_medium || null,
  };
}

function pickRandomTrack(tracks) {
  const index = Math.floor(Math.random() * tracks.length);
  return tracks[index];
}

function parseTrackList(responseData) {
  const tracks = responseData?.tracks;
  if (Array.isArray(tracks)) {
    return tracks;
  }
  if (Array.isArray(tracks?.data)) {
    return tracks.data;
  }
  return [];
}

async function fetchPlaylistTracks({
  forceRefresh = false,
  playlistId: configuredPlaylistId = '',
  playlistQuery: configuredPlaylistQuery = '',
} = {}) {
  const now = Date.now();
  const {
    playlistId,
    playlistQuery,
    apiBase,
    cacheTtlMs,
  } = getDeezerConfig();
  const effectivePlaylistId = String(configuredPlaylistId || playlistId || '').trim();
  const effectivePlaylistQuery = String(configuredPlaylistQuery || playlistQuery || DEFAULT_PLAYLIST_QUERY).trim();

  const resolvedPlaylistId = await resolvePlaylistId({
    playlistId: effectivePlaylistId,
    playlistQuery: effectivePlaylistQuery,
    apiBase,
  });
  const cacheKey = String(resolvedPlaylistId);

  if (!forceRefresh && playlistCache.data && playlistCache.key === cacheKey && now < playlistCache.expiresAt) {
    return playlistCache.data;
  }

  let playlist;
  try {
    const response = await axios.get(`${apiBase}/playlist/${encodeURIComponent(String(resolvedPlaylistId))}`, {
      timeout: 12_000,
    });
    playlist = response.data;
  } catch (error) {
    throw normalizeAxiosError(error);
  }

  const tracks = parseTrackList(playlist).map(parsePlayableTrack).filter(Boolean);

  if (tracks.length === 0) {
    throw new DeezerError('No playable Deezer tracks found in playlist.', {
      status: 502,
      code: 'DEEZER_EMPTY_PLAYLIST',
    });
  }

  const data = {
    playlist: {
      id: playlist?.id ? String(playlist.id) : String(resolvedPlaylistId),
      title: playlist?.title || 'Deezer Playlist',
      permalinkUrl: playlist?.link || null,
    },
    tracks,
  };

  playlistCache = {
    key: cacheKey,
    data,
    expiresAt: now + cacheTtlMs,
  };

  return data;
}

function normalizeTrackSearchValue(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSearchLimit(value, fallback = DEFAULT_SEARCH_LIMIT) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 20);
}

async function searchTracksInPlaylist(
  query,
  {
    forceRefresh = false,
    playlistId = '',
    playlistQuery = '',
    limit = DEFAULT_SEARCH_LIMIT,
  } = {}
) {
  const normalizedQuery = normalizeTrackSearchValue(query);
  if (!normalizedQuery) {
    return {
      playlist: null,
      tracks: [],
    };
  }

  const { playlist, tracks } = await fetchPlaylistTracks({
    forceRefresh,
    playlistId,
    playlistQuery,
  });
  const effectiveLimit = parseSearchLimit(limit);
  const searchTerms = normalizedQuery.split(' ').filter(Boolean);

  const matchingTracks = tracks
    .filter((track) => {
      const haystack = normalizeTrackSearchValue(`${track.title} ${track.artist}`);
      return searchTerms.every((term) => haystack.includes(term));
    })
    .slice(0, effectiveLimit);

  return { playlist, tracks: matchingTracks };
}

async function fetchTrackDetails(trackId) {
  const { apiBase } = getDeezerConfig();

  try {
    const response = await axios.get(`${apiBase}/track/${encodeURIComponent(String(trackId))}`, {
      timeout: 12_000,
    });
    return response.data;
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}

async function getTrackById(trackId) {
  const normalizedId = String(trackId || '').trim();
  if (!normalizedId) {
    throw new DeezerError('Missing Deezer track id.', {
      status: 400,
      code: 'DEEZER_BAD_TRACK_ID',
    });
  }

  const cachedTrack = playlistCache.data?.tracks?.find((track) => track.id === normalizedId);
  if (cachedTrack) {
    return cachedTrack;
  }

  const details = await fetchTrackDetails(normalizedId);
  const parsed = parsePlayableTrack(details);

  if (!parsed) {
    throw new DeezerError(`Deezer track ${normalizedId} is not playable.`, {
      status: 404,
      code: 'DEEZER_TRACK_NOT_PLAYABLE',
    });
  }

  return parsed;
}

async function getRandomPlayableTrack({ playlistId, playlistQuery } = {}) {
  const { playlist, tracks } = await fetchPlaylistTracks({
    playlistId,
    playlistQuery,
  });

  return {
    playlist,
    track: pickRandomTrack(tracks),
  };
}

async function resolveTrackStreamUrl(trackId) {
  const track = await getTrackById(trackId);

  if (!/^https?:\/\/.+/i.test(track.previewUrl || '')) {
    throw new DeezerError(`Deezer did not return a stream URL for track ${track.id}.`, {
      status: 502,
      code: 'DEEZER_EMPTY_STREAM_URL',
    });
  }

  return track.previewUrl;
}

function createDeezerError(error) {
  if (error instanceof DeezerError) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    return normalizeAxiosError(error);
  }
  return normalizeAxiosError(error);
}

module.exports = {
  DeezerError,
  createDeezerError,
  searchTracksInPlaylist,
  getRandomPlayableTrack,
  getTrackById,
  resolveTrackStreamUrl,
};
