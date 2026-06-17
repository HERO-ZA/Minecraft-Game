const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.use(express.static('public'));

let players = {};

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    players[socket.id] = { x: 0, y: 0, z: 0, ry: 0, anim: 'idle' };

    // အသစ်ဝင်လာသူကို လက်ရှိရှိနေတဲ့ Player စာရင်း ပို့ပေးခြင်း
    socket.emit('currentPlayers', players);
    // အခြားသူများဆီသို့ Player အသစ်ဝင်လာကြောင်း အသိပေးခြင်း
    socket.broadcast.emit('newPlayer', { id: socket.id, ...players[socket.id] });

    // တည်နေရာနှင့် Animation ပြောင်းလဲမှုများကို Sync လုပ်ခြင်း
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].ry = movementData.ry;
            players[socket.id].anim = movementData.anim;
            socket.broadcast.emit('playerMoved', { id: socket.id, ...players[socket.id] });
        }
    });

    // Emoji အထူး Animation စနစ်
    socket.on('playEmoji', (emojiData) => {
        socket.broadcast.emit('emojiTriggered', { id: socket.id, emoji: emojiData.emoji });
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
mongoose.connect(MONGO_URI, { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=> console.log('✅ MongoDB connected'))
  .catch(e=> console.warn('⚠️  MongoDB not connected (offline mode):', e.message));

// World changes (delta)
const BlockDeltaSchema = new mongoose.Schema({
  world:  { type:String, default:'main' },
  x: Number, y: Number, z: Number,
  blockType: Number,
  updatedAt: { type:Date, default:Date.now }
});
BlockDeltaSchema.index({ world:1, x:1, y:1, z:1 }, { unique:true });
const BlockDelta = mongoose.model('BlockDelta', BlockDeltaSchema);

// Player inventory
const PlayerSchema = new mongoose.Schema({
  username:  { type:String, unique:true },
  inventory: { type:[Object], default:[] },
  posX: { type:Number, default:8 },
  posY: { type:Number, default:50 },
  posZ: { type:Number, default:8 },
  lastSeen: { type:Date, default:Date.now },
});
const PlayerData = mongoose.model('PlayerData', PlayerSchema);

// ============================================================
// IN-MEMORY STATE
// ============================================================
const players = new Map(); // socketId -> { username, x, y, z, yaw, walking }
const mobs    = new Map(); // mobId    -> { id, type, x, y, z, health, target }
let   mobIdCounter = 0;
const TICK_RATE = 20; // ticks per second

// ============================================================
// REST ENDPOINTS
// ============================================================
app.get('/api/world-delta', async (req, res) => {
  try {
    const deltas = await BlockDelta.find({ world:'main' }).lean();
    res.json(deltas);
  } catch(e) { res.json([]); }
});

app.get('/api/player/:username', async (req, res) => {
  try {
    const p = await PlayerData.findOne({ username: req.params.username }).lean();
    res.json(p || {});
  } catch(e) { res.json({}); }
});

app.post('/api/player/:username/inventory', async (req, res) => {
  try {
    const { inventory, x, y, z } = req.body;
    await PlayerData.findOneAndUpdate(
      { username: req.params.username },
      { inventory, posX:x, posY:y, posZ:z, lastSeen:new Date() },
      { upsert:true, new:true }
    );
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ============================================================
// SOCKET.IO EVENTS
// ============================================================
io.on('connection', (socket) => {
  console.log(`🔌 Player connected: ${socket.id}`);

  // Send existing players to newcomer
  const existing = [];
  players.forEach((p, id) => existing.push({ id, ...p }));
  socket.emit('existingPlayers', existing);

  // Send world delta (all block changes since world generated)
  BlockDelta.find({ world:'main' }).lean()
    .then(deltas => socket.emit('worldDelta', deltas))
    .catch(()=>{});

  // ---- JOIN ----
  socket.on('join', async (data) => {
    const username = (data.username || 'Player').slice(0,16);
    let spawnX = data.x || 8, spawnY = data.y || 50, spawnZ = data.z || 8;

    // Load saved position & inventory
    try {
      const saved = await PlayerData.findOne({ username });
      if(saved){
        spawnX = saved.posX; spawnY = saved.posY; spawnZ = saved.posZ;
        socket.emit('loadInventory', saved.inventory);
      }
    } catch(e){}

    const playerInfo = { username, x:spawnX, y:spawnY, z:spawnZ, yaw:0, walking:false };
    players.set(socket.id, playerInfo);

    // Tell others
    socket.broadcast.emit('playerJoined', { id:socket.id, ...playerInfo });
    console.log(`👤 ${username} joined`);
  });

  // ---- MOVE ----
  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if(!p) return;
    p.x=data.x; p.y=data.y; p.z=data.z;
    p.yaw=data.yaw||0; p.walking=data.walking||false;
    // Broadcast to everyone else
    socket.broadcast.emit('playerMoved', { id:socket.id, ...data });
  });

  // ---- BLOCK UPDATE ----
  socket.on('blockUpdate', async (data) => {
    const { x, y, z, type } = data;
    // Broadcast to all others
    socket.broadcast.emit('blockUpdate', { x, y, z, type });
    // Save to DB (upsert)
    try {
      await BlockDelta.findOneAndUpdate(
        { world:'main', x, y, z },
        { blockType:type, updatedAt:new Date() },
        { upsert:true }
      );
    } catch(e){}
  });

  // ---- INVENTORY SAVE ----
  socket.on('saveInventory', async (data) => {
    const p = players.get(socket.id);
    if(!p) return;
    try {
      await PlayerData.findOneAndUpdate(
        { username:p.username },
        { inventory:data.inventory, posX:p.x, posY:p.y, posZ:p.z, lastSeen:new Date() },
        { upsert:true }
      );
    } catch(e){}
  });

  // ---- EMOJI ----
  socket.on('emoji', (data) => {
    const p = players.get(socket.id);
    if(!p) return;
    io.emit('emoji', { id:socket.id, username:p.username, emoji:data.emoji });
  });

  // ---- CHAT ----
  socket.on('chat', (data) => {
    const p = players.get(socket.id);
    if(!p) return;
    const msg = { id:socket.id, username:p.username, text:(data.text||'').slice(0,200) };
    io.emit('chat', msg);
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', async () => {
    const p = players.get(socket.id);
    if(p){
      console.log(`👋 ${p.username} disconnected`);
      io.emit('playerLeft', { id:socket.id, username:p.username });
      // Auto-save position
      try {
        await PlayerData.findOneAndUpdate(
          { username:p.username },
          { posX:p.x, posY:p.y, posZ:p.z, lastSeen:new Date() },
          { upsert:true }
        );
      } catch(e){}
      players.delete(socket.id);
    }
  });
});

// ============================================================
// MOB SYSTEM - Server-Authoritative AI
// ============================================================
const MOB_TYPES = ['zombie','cow','sheep'];
const MAX_MOBS_PER_PLAYER = 5;

function spawnMobNear(px, py, pz) {
  if(mobs.size >= 30) return; // global cap
  const angle = Math.random() * Math.PI * 2;
  const dist  = 20 + Math.random() * 20;
  const id    = ++mobIdCounter;
  const isHostile = Math.random() < 0.3;
  mobs.set(id, {
    id,
    type: isHostile ? 'zombie' : (Math.random()<0.5?'cow':'sheep'),
    x: px + Math.cos(angle)*dist,
    y: py,
    z: pz + Math.sin(angle)*dist,
    health: isHostile ? 20 : 10,
    hostile: isHostile,
    targetId: null,
    wanderAngle: Math.random()*Math.PI*2,
    wanderTimer: 0,
  });
}

function updateMobs(dt) {
  if(players.size === 0) return;

  // Spawn mobs near each player
  players.forEach(p => {
    const nearbyMobs = [...mobs.values()].filter(m =>
      Math.abs(m.x-p.x)<48 && Math.abs(m.z-p.z)<48
    );
    if(nearbyMobs.length < MAX_MOBS_PER_PLAYER) {
      if(Math.random() < 0.01) spawnMobNear(p.x, p.y, p.z);
    }
  });

  // Move mobs
  mobs.forEach((mob, id) => {
    // Remove if too far from all players
    let nearAnyPlayer = false;
    players.forEach(p => {
      if(Math.abs(mob.x-p.x)<64 && Math.abs(mob.z-p.z)<64) nearAnyPlayer=true;
    });
    if(!nearAnyPlayer){ mobs.delete(id); return; }

    if(mob.hostile) {
      // Chase nearest player
      let nearestDist = Infinity, target = null;
      players.forEach((p, sid) => {
        const d = Math.hypot(mob.x-p.x, mob.z-p.z);
        if(d < nearestDist){ nearestDist=d; target=p; }
      });
      if(target && nearestDist < 40) {
        const angle = Math.atan2(target.z-mob.z, target.x-mob.x);
        mob.x += Math.cos(angle) * 2.5 * dt;
        mob.z += Math.sin(angle) * 2.5 * dt;
      }
    } else {
      // Passive wander
      mob.wanderTimer -= dt;
      if(mob.wanderTimer <= 0){
        mob.wanderAngle += (Math.random()-0.5)*1.5;
        mob.wanderTimer = 2+Math.random()*3;
      }
      mob.x += Math.cos(mob.wanderAngle) * 1.5 * dt;
      mob.z += Math.sin(mob.wanderAngle) * 1.5 * dt;
    }
  });

  // Broadcast mob positions
  if(mobs.size > 0){
    const mobList = [...mobs.values()].map(m=>({ id:m.id, type:m.type, x:m.x, y:m.y, z:m.z }));
    io.emit('mobUpdate', mobList);
  }
}

// Tick loop
let lastTick = Date.now();
setInterval(()=>{
  const now = Date.now();
  const dt  = (now - lastTick) / 1000;
  lastTick  = now;
  updateMobs(dt);
}, 1000 / TICK_RATE);

// ============================================================
// SERVE FRONTEND (fallback)
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================
server.listen(PORT, ()=>{
  console.log(`🎮 Minecraft PWA Server running on port ${PORT}`);
  console.log(`📡 Socket.io ready for multiplayer`);
  console.log(`🌍 World: procedural generation active`);
});
