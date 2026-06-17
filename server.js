const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static('public'));

const players = {};
const WORLD_SIZE = 50;
const blocks = {};

// Generate basic world
for (let x = 0; x < WORLD_SIZE; x++) {
  for (let z = 0; z < WORLD_SIZE; z++) {
    blocks[`${x},0,${z}`] = 'grass';
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  players[socket.id] = {
    id: socket.id,
    x: 25, y: 1, z: 25,
    name: 'Player' + Object.keys(players).length
  };

  socket.emit('init', { 
    player: players[socket.id], 
    players, 
    blocks 
  });

  socket.broadcast.emit('playerJoined', players[socket.id]);

  socket.on('move', (pos) => {
    if (players[socket.id]) {
      players[socket.id] = { ...players[socket.id], ...pos };
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('placeBlock', (data) => {
    blocks[`${data.x},${data.y},${data.z}`] = data.type;
    io.emit('blockPlaced', data);
  });

  socket.on('removeBlock', (data) => {
    delete blocks[`${data.x},${data.y},${data.z}`];
    io.emit('blockRemoved', data);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
