const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

// Fallback in-memory state since full Redis CRUD is complex for this step
const memoryRooms = new Map();

async function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  let redisClient = null;

  try {
    const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    const subClient = pubClient.duplicate();

    pubClient.on('error', () => {});
    subClient.on('error', () => {});

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    redisClient = pubClient;
    console.log('Socket.io Redis adapter connected.');
  } catch (err) {
    console.log('Redis connection failed, falling back to in-memory state.');
  }

  // Helper to save room state
  async function saveRoom(code, data) {
    if (redisClient) {
      await redisClient.set(`room:${code}`, JSON.stringify(data));
    } else {
      memoryRooms.set(code, data);
    }
  }

  async function getRoom(code) {
    if (redisClient) {
      const data = await redisClient.get(`room:${code}`);
      return data ? JSON.parse(data) : null;
    } else {
      return memoryRooms.get(code) || null;
    }
  }

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create_room', async (data, callback) => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = {
        code,
        hostId: data.player.id,
        players: {
          [data.player.id]: { id: data.player.id, name: data.player.name, score: 0, solved: false }
        },
        status: 'lobby',
        round: 0,
        settings: data.settings || {}
      };
      await saveRoom(code, room);
      socket.join(code);
      if (typeof callback === 'function') callback({ room });
    });

    socket.on('join_room', async (data) => {
      const { code, player } = data;
      const room = await getRoom(code);
      if (room) {
        room.players[player.id] = { id: player.id, name: player.name, score: 0, solved: false };
        await saveRoom(code, room);
        socket.join(code);
        io.to(code).emit('room_state', { room });
      } else {
        socket.emit('error', 'Room not found');
      }
    });

    socket.on('start_round', async ({ code, hostId }) => {
      const room = await getRoom(code);
      if (room && room.hostId === hostId) {
        room.status = 'active';
        room.round += 1;
        room.currentSongId = `s${Math.floor(Math.random() * 7) + 1}`; // Mock random song from library
        room.roundEndsAt = Date.now() + 95000;
        
        Object.keys(room.players).forEach(pId => {
          room.players[pId].solved = false;
        });
        
        await saveRoom(code, room);
        io.to(code).emit('room_state', { room });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  return io;
}

module.exports = { initSocket };
