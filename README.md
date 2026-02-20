# Songless Clone

An opinionated local implementation of a music guessing game with:

- Single-player classic mode
- Daily challenge mode (seeded by date)
- Story mode with 5 themed chapters
- Unlimited mode
- Leaderboards (all-time + today)
- Pause/resume
- Progressive 6-level hints with skip
- Dual title + artist guessing
- Result sharing
- Friends list and shareable friend code
- Multiplayer "rooms" using `BroadcastChannel` for same-browser realtime sessions

## Run

Open `index.html` directly in a browser, or serve with any static server.

Example with Python:

```bash
cd /Users/jonathanmoran/Documents/endless-songless
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

Local and backend commands:

```bash
cd /Users/jonathanmoran/Documents/endless-songless
npm start
```

Run the backend test suite:

```bash
cd /Users/jonathanmoran/Documents/endless-songless
npm test
```

## Notes

- Multiplayer rooms synchronize only in the current browser environment using `BroadcastChannel`.
- Audio clips use remote public MP3 samples and are played as short snippets.
