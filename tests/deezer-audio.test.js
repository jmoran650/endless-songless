const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const MOCK_DEEZER_BYTES = Buffer.from('DEEZER_MP3_BYTES');

function startMockDeezerServer({ includePreview = true, includeSearchResults = true } = {}) {
  return new Promise((resolve, reject) => {
    let baseUrl;

    const deezerServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      const track = {
        id: 111,
        title: 'Mock Track',
        link: 'https://deezer.com/track/111',
        duration: 120,
        artist: { name: 'Mock Artist' },
        album: { cover_medium: 'https://example.com/cover.jpg' },
        preview: includePreview ? `${baseUrl}/audio/111.mp3` : '',
      };

      if (url.pathname === '/playlist/playlist-999') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 999,
            title: 'Mock Playlist',
            link: 'https://deezer.com/playlist/playlist-999',
            tracks: { data: [track] },
          })
        );
        return;
      }

      if (url.pathname === '/search/playlist') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            data: includeSearchResults ? [{ id: 'playlist-999', title: 'Mock Playlist' }] : [],
          })
        );
        return;
      }

      if (url.pathname === '/track/111') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(track));
        return;
      }

      if (url.pathname === '/audio/111.mp3') {
        res.statusCode = 200;
        res.setHeader('content-type', 'audio/mpeg');
        res.setHeader('content-length', String(MOCK_DEEZER_BYTES.length));
        res.end(MOCK_DEEZER_BYTES);
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    deezerServer.once('error', reject);
    deezerServer.listen(0, '127.0.0.1', () => {
      const { port } = deezerServer.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        close: () =>
          new Promise((done) => {
            deezerServer.close(() => {
              done();
            });
          }),
        baseUrl,
      });
    });
  });
}

function startAudioServer({
  deezerApiBase,
  playlistId = 'playlist-999',
  playlistQuery = 'mock playlist',
} = {}) {
  const routePath = require.resolve('../server/src/routes/audio');
  const servicePath = require.resolve('../server/src/services/deezer');
  delete require.cache[routePath];
  delete require.cache[servicePath];

  process.env.DEEZER_PLAYLIST_ID = playlistId;
  process.env.DEEZER_API_BASE_URL = deezerApiBase || 'http://127.0.0.1:1';
  process.env.DEEZER_PLAYLIST_QUERY = playlistQuery;
  process.env.DEEZER_CACHE_TTL_MS = '1000';

  const audioRouter = require('../server/src/routes/audio');
  const app = express();
  app.use('/api/audio', audioRouter);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

test('audio route reads Deezer playlist data in /next', async (t) => {
  const deezer = await startMockDeezerServer();
  const audio = await startAudioServer({ deezerApiBase: deezer.baseUrl });
  t.after(() => {
    return audio.close().then(() => deezer.close());
  });

  const nextResponse = await fetch(`${audio.baseUrl}/api/audio/next?hint=2`);
  const nextPayload = await nextResponse.json().catch(() => ({}));

  assert.equal(nextResponse.status, 200);
  assert.equal(nextPayload.track.id, '111');
  assert.equal(nextPayload.track.artist, 'Mock Artist');
  assert.equal(nextPayload.playlist.title, 'Mock Playlist');
  assert.equal(typeof nextPayload.audioSrc, 'string');
});

test('audio stream endpoint proxies Deezer preview bytes', async (t) => {
  const deezer = await startMockDeezerServer();
  const audio = await startAudioServer({ deezerApiBase: deezer.baseUrl });
  t.after(() => {
    return audio.close().then(() => deezer.close());
  });

  const nextResponse = await fetch(`${audio.baseUrl}/api/audio/next?hint=1`);
  const nextPayload = await nextResponse.json().catch(() => ({}));
  assert.equal(nextResponse.status, 200);
  assert.equal(typeof nextPayload.audioSrc, 'string');

  const streamResponse = await fetch(`${audio.baseUrl}${nextPayload.audioSrc}`);
  const streamBytes = Buffer.from(await streamResponse.arrayBuffer());

  assert.equal(streamResponse.status, 200);
  assert.equal(streamResponse.headers.get('content-type'), 'audio/mpeg');
  assert.equal(streamBytes.toString(), MOCK_DEEZER_BYTES.toString());
  assert.equal(streamResponse.headers.get('x-songless-track-id'), '111');
});

test('audio next discovers playlist id through Deezer public search when id is unset', async (t) => {
  const deezer = await startMockDeezerServer();
  const audio = await startAudioServer({
    deezerApiBase: deezer.baseUrl,
    playlistId: '',
    playlistQuery: 'mock playlist',
  });
  t.after(() => {
    return audio.close().then(() => deezer.close());
  });

  const nextResponse = await fetch(`${audio.baseUrl}/api/audio/next`);
  const payload = await nextResponse.json().catch(() => ({}));

  assert.equal(nextResponse.status, 200);
  assert.equal(payload.track.id, '111');
  assert.equal(payload.playlist.id, '999');
});

test('audio next returns DEEZER_PLAYLIST_NOT_FOUND when Deezer search has no playlists', async (t) => {
  const deezer = await startMockDeezerServer({ includeSearchResults: false });
  const audio = await startAudioServer({
    deezerApiBase: deezer.baseUrl,
    playlistId: '',
    playlistQuery: 'does not exist',
  });
  t.after(() => {
    return audio.close().then(() => deezer.close());
  });

  const nextResponse = await fetch(`${audio.baseUrl}/api/audio/next`);
  const payload = await nextResponse.json().catch(() => ({}));

  assert.equal(nextResponse.status, 503);
  assert.equal(payload.code, 'DEEZER_PLAYLIST_NOT_FOUND');
});

test('audio next rejects Deezer playlists without playable tracks', async (t) => {
  const deezer = await startMockDeezerServer({ includePreview: false });
  const audio = await startAudioServer({ deezerApiBase: deezer.baseUrl });
  t.after(() => {
    return audio.close().then(() => deezer.close());
  });

  const nextResponse = await fetch(`${audio.baseUrl}/api/audio/next`);
  const payload = await nextResponse.json().catch(() => ({}));

  assert.equal(nextResponse.status, 502);
  assert.equal(payload.code, 'DEEZER_EMPTY_PLAYLIST');
});
