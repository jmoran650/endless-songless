const express = require('express');
const axios = require('axios');
const router = express.Router();

// Extracted from original script.js state
const SONG_LIBRARY = [
  { id: 's1', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 's2', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 's3', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 's4', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 's5', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { id: 's6', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
  { id: 's7', audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3' },
];

router.get('/stream/:songId', async (req, res) => {
  const { songId } = req.params;
  const hintLevel = parseInt(req.query.hint || '1', 10);
  const song = SONG_LIBRARY.find(s => s.id === songId);
  
  if (!song) return res.status(404).json({ error: 'Song not found' });

  try {
    const response = await axios({
      method: 'get',
      url: song.audio,
      responseType: 'arraybuffer'
    });
    
    const buffer = Buffer.from(response.data);
    
    // Naive audio slicing: hintLevel goes from 1 to 6
    // hint 1 = 16% of the song size, hint 6 = 100% of the song size
    const ratio = Math.min(hintLevel / 6, 1.0);
    const bytesToSend = Math.floor(buffer.length * ratio);
    const slicedBuffer = buffer.subarray(0, bytesToSend);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': slicedBuffer.length,
      'Accept-Ranges': 'bytes'
    });

    res.send(slicedBuffer);
  } catch (err) {
    console.error('Audio proxy error:', err.message);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});

module.exports = router;
