import axios from 'axios';
import { Disc, Play, Settings, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:8080';
let socket: Socket;

function App() {
  const [activeTab, setActiveTab] = useState('play');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState<{ displayName: string } | null>(null);

  useEffect(() => {
    socket = io(SOCKET_URL);
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    if (token) {
      axios.get('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setUser(res.data))
        .catch(() => { setToken(''); localStorage.removeItem('token'); });
    }
  }, [token]);

  return (
    <div className="app-container">
      <header className="mb-4">
        <p className="eyebrow">Endless Songless</p>
        <h1>Songless Clone</h1>
      </header>

      <div className="nav-tabs">
        <button className={`nav-tab ${activeTab === 'play' ? 'active' : ''}`} onClick={() => setActiveTab('play')}><Play size={16}/> Play</button>
        <button className={`nav-tab ${activeTab === 'multiplayer' ? 'active' : ''}`} onClick={() => setActiveTab('multiplayer')}><Users size={16}/> Multiplayer</button>
        <button className={`nav-tab ${activeTab === 'leaderboard' ? 'active' : ''}`} onClick={() => setActiveTab('leaderboard')}><Trophy size={16}/> Leaderboard</button>
        <button className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}><Settings size={16}/> Settings</button>
      </div>

      <main>
        {activeTab === 'play' && (
          <div className="glass-panel">
            <h2>Classic Guessing</h2>
            <div className="mb-4" style={{ color: 'var(--text-muted)' }}>
              Select your difficulty and genre to start the endless music guessing journey.
            </div>
            <div className="flex-row">
              <select defaultValue="normal">
                <option value="easy">Easy (120s, 6 hints)</option>
                <option value="normal">Normal (95s, 6 hints)</option>
                <option value="hard">Hard (70s, 6 hints)</option>
              </select>
              <select defaultValue="Any">
                <option value="Any">Any Genre</option>
                <option value="Electronic">Electronic</option>
                <option value="Rock">Rock</option>
                <option value="Pop">Pop</option>
              </select>
            </div>
            <div className="flex-row mt-4">
              <button><Play size={16} /> Start Single Player</button>
            </div>
            
            <div className="audio-player-container mt-4">
              <h3><Disc size={18} style={{ display: 'inline', marginRight: '0.5rem' }} /> Now Playing</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Audio will play once the game starts. The snippet size expands with each hint level securely synced from the backend proxy.</p>
              <audio controls src="/api/audio/stream/s1?hint=1" className="mt-4" style={{ width: '100%' }}></audio>
            </div>
            
            <div className="mt-4">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Guess the Song Title</label>
              <input type="text" placeholder="Title..." />
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Guess the Artist</label>
              <input type="text" placeholder="Artist..." />
              <br/>
              <button disabled>Submit Guess</button>
            </div>
          </div>
        )}

        {activeTab === 'multiplayer' && (
          <div className="glass-panel">
            <h2>Real-time Multiplayer</h2>
            <p style={{ color: 'var(--text-muted)' }}>Join a room to battle friends using WebSockets.</p>
            <div className="flex-row mt-4">
              <input type="text" placeholder="Room Code (e.g. ABC123)" style={{ marginBottom: 0 }} />
              <button>Join Room</button>
              <button>Create Room</button>
            </div>
            
            <div className="audio-player-container mt-4">
              <h3>Room Status: Lobby</h3>
              <p>Waiting for host to start...</p>
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="glass-panel">
            <h2>Global Leaderboard</h2>
            <p style={{ color: 'var(--text-muted)' }}>Powered by PostgreSQL.</p>
            <div className="audio-player-container mt-4">
              <p>Loading scores...</p>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="glass-panel">
            <h2>Profile & Settings</h2>
            {user ? (
              <div>
                <p>Welcome, <strong>{user.displayName}</strong>!</p>
                <button className="mt-4" onClick={() => { setToken(''); localStorage.removeItem('token'); }}>Log Out</button>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--text-muted)' }}>You must be logged in to track statistics.</p>
                <div className="mt-4">
                  <label>Username</label>
                  <input type="text" />
                  <label>Password</label>
                  <input type="password" />
                  <div className="flex-row">
                    <button>Log In</button>
                    <button>Register</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
