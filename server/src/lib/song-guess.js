function normalizeSongText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGuessPayload(payload) {
  const submittedTitle = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const submittedArtist = typeof payload?.artist === 'string' ? payload.artist.trim() : '';
  if (submittedTitle || submittedArtist) {
    return {
      title: submittedTitle,
      artist: submittedArtist,
    };
  }

  const rawGuess = typeof payload?.guess === 'string' ? payload.guess.trim() : '';
  if (!rawGuess) {
    return { title: '', artist: '' };
  }

  const splitByDash = rawGuess.split(/\s*[-–—]\s*/);
  if (splitByDash.length > 1) {
    const [title, ...artistRemainder] = splitByDash;
    return {
      title: title.trim(),
      artist: artistRemainder.join(' - ').trim(),
    };
  }

  const byMatch = rawGuess.match(/^(.*)\s+by\s+(.*)$/i);
  if (byMatch) {
    return {
      title: byMatch[1].trim(),
      artist: byMatch[2].trim(),
    };
  }

  return { title: rawGuess, artist: '' };
}

function readSongArtist(song) {
  if (typeof song?.artist === 'string') {
    return song.artist;
  }
  if (typeof song?.artist?.name === 'string') {
    return song.artist.name;
  }
  return '';
}

function evaluateSongGuess(guess, currentSong) {
  const guessedTitle = normalizeSongText(guess?.title);
  const guessedArtist = normalizeSongText(guess?.artist);
  const songTitle = normalizeSongText(currentSong?.title);
  const songArtist = normalizeSongText(readSongArtist(currentSong));

  const titleMatch = Boolean(guessedTitle && songTitle && guessedTitle === songTitle);
  const artistMatch = Boolean(guessedArtist && songArtist && guessedArtist === songArtist);
  const solved = titleMatch && artistMatch;
  const result = solved ? 'solved' : artistMatch ? 'artist' : 'miss';

  return {
    titleMatch,
    artistMatch,
    solved,
    result,
  };
}

function isSongGuessMatch(guess, currentSong) {
  return evaluateSongGuess(guess, currentSong).solved;
}

module.exports = {
  evaluateSongGuess,
  normalizeSongText,
  parseGuessPayload,
  isSongGuessMatch,
};
