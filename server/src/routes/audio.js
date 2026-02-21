const express = require('express');
const axios = require('axios');
const {
  DeezerError,
  getRandomPlayableTrack,
  searchTracksInPlaylist,
  resolveTrackStreamUrl,
} = require('../services/deezer');
const { logError, logInfo } = require('../lib/observability');

const router = express.Router();

function toHintLevel(value) {
  const parsed = parseInt(String(value || '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function toPositiveInt(value, fallback = 1) {
  const parsed = parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function sendDeezerError(res, error, fallbackMessage) {
  if (error instanceof DeezerError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
    });
  }

  if (axios.isAxiosError(error)) {
    return res.status(502).json({
      error: 'Deezer stream request failed.',
      code: 'DEEZER_PROXY_FAILED',
    });
  }

  return res.status(500).json({
    error: fallbackMessage,
    code: 'INTERNAL_ERROR',
  });
}

router.get('/next', async (req, res) => {
  const hintLevel = toHintLevel(req.query.hint);
  const playlistId = String(req.query.playlistId || '').trim();
  const playlistQuery = String(req.query.playlistQuery || '').trim();

  try {
    const { track, playlist } = await getRandomPlayableTrack({
      playlistId,
      playlistQuery,
    });
    logInfo('audio.next.success', {
      requestId: req.requestId,
      hintLevel,
      trackId: track.id,
    });
    return res.json({
      hintLevel,
      playlist,
      track,
      audioSrc: `/api/audio/stream/${encodeURIComponent(track.id)}?hint=${hintLevel}`,
    });
  } catch (error) {
    logError('audio.next.failure', error, {
      requestId: req.requestId,
      hintLevel,
    });
    return sendDeezerError(res, error, 'Failed to get next Deezer track.');
  }
});

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const playlistId = String(req.query.playlistId || '').trim();
  const playlistQuery = String(req.query.playlistQuery || '').trim();
  const limit = toPositiveInt(req.query.limit, 10);

  if (!query) {
    return res.status(400).json({
      error: 'Missing search query.',
      code: 'DEEZER_SEARCH_QUERY_REQUIRED',
    });
  }

  try {
    const { playlist, tracks } = await searchTracksInPlaylist(query, {
      playlistId,
      playlistQuery,
      forceRefresh: false,
      limit,
    });

    return res.json({
      query,
      playlist,
      tracks,
    });
  } catch (error) {
    logError('audio.search.failure', error, {
      requestId: req.requestId,
      playlistId: playlistId || undefined,
      query,
    });
    return sendDeezerError(res, error, 'Failed to search Deezer tracks.');
  }
});

router.get('/stream/:trackId', async (req, res) => {
  const { trackId } = req.params;
  const hintLevel = toHintLevel(req.query.hint);

  try {
    const normalizedTrackId = String(trackId || '').trim();
    const streamUrl = await resolveTrackStreamUrl(normalizedTrackId);

    const passthroughHeaders = {};
    if (req.headers.range) {
      passthroughHeaders.Range = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: streamUrl,
      responseType: 'stream',
      headers: passthroughHeaders,
      timeout: 20_000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    res.status(response.status);

    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified']
      .forEach((headerName) => {
        const value = response.headers[headerName];
        if (value) {
          res.set(headerName, value);
        }
      });

    if (!res.getHeader('content-type')) {
      res.set('Content-Type', 'audio/mpeg');
    }

    res.set('X-Songless-Track-Id', normalizedTrackId);
    res.set('X-Songless-Hint-Level', String(hintLevel));
    logInfo('audio.stream.success', {
      requestId: req.requestId,
      trackId: normalizedTrackId,
      status: response.status,
    });

    req.on('close', () => {
      response.data.destroy();
    });

    response.data.pipe(res);
  } catch (error) {
    logError('audio.stream.failure', error, {
      requestId: req.requestId,
      trackId: String(trackId || '').trim(),
      hintLevel,
    });
    return sendDeezerError(res, error, 'Failed to stream Deezer audio.');
  }
});

module.exports = router;
