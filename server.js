// ─────────────────────────────────────────────────────────────────────────
// MINECRAFT CLONE ADVANCED MULTIPLAYER SERVER ENGINE
// ─────────────────────────────────────────────────────────────────────────
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const WORLD_SAVE_FILE = path.join(__dirname, 'world_backup.json');

// ─────────────────────────────────────────
// SERVER MEMORY & STATE MANAGEMENT
// ─────────────────────────────────────────
let worldBlocks = {};    // Key: "x,y,z", Value: "grass", "stone", "wood" etc.
let activePlayers = {};  // Key: socket.id, Value: { x, y, z, yaw, pitch, hp, name }
let serverTimeOfDay = 0.25; // 0.0 မှ 1.0 အထိ နေ့/ည အလှည့်ကျစနစ်

// ဂိမ်းမြေပုံ ဖျက်မပျက်သွားအောင် Auto-Load လုပ်ခြင်း
if (fs.existsSync(WORLD_SAVE_FILE)) {
    try {
        worldBlocks = JSON.parse(fs.readFileSync(WORLD_SAVE_FILE, 'utf8'));
        console.log(`💾 [World Engine] Loaded ${Object.keys(worldBlocks).length} blocks from backup.`);
    } catch (e) {
        console.log("⚠️ [World Engine] Backup file read error. Starting with empty world.");
    }
}

// ဂိမ်းမြေပုံကို ၅ မိနစ်တစ်ကြိမ် Auto-Save လုပ်ပေးမည့်စနစ်
setInterval(() => {
    try {
        fs.writeFileSync(WORLD_SAVE_FILE, JSON.stringify(worldBlocks), 'utf8');
        console.log(`📝 [World Engine] Auto-saved world state: ${Object.keys(worldBlocks).length} blocks.`);
    } catch (e) {
        console.error("❌ [World Engine] Save error:", e);
    }
}, 300000); // 5 minutes

// Static HTML Web Client Folder သတ်မှတ်ခြင်း
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────
// REAL-TIME MULTIPLAYER CONTROLLER
// ─────────────────────────────────────────
io.on('connection', (socket) => {
    // ကစားသမားတစ်ဦးချင်းစီအတွက် ကျပန်းနာမည်ပေးခြင်း (ဥပမာ - Player_402)
    const playerRandomId = Math.floor(100 + Math.random() * 900);
    const playerName = `Player_${playerRandomId}`;
    
    console.log(`📥 [Join] ${playerName} connected. ID: ${socket.id}`);

    // ၁။ ဝင်လာသူဆီ လက်ရှိကမ္ဘာထဲက ဆောက်ထားသမျှ Block စာရင်းအကုန် ပို့ပေးမယ်
    socket.emit('initialWorld', worldBlocks);

    // ၂။ လက်ရှိအချိန် (Day/Night Time) ကို Sync လုပ်ပေးမယ်
    socket.emit('timeSync', { tod: serverTimeOfDay });

    // ၃။ လက်ရှိဆော့နေတဲ့ တခြားကစားသမားတွေရဲ့ စာရင်းကို ပို့ပေးမယ်
    Object.keys(activePlayers).forEach((id) => {
        socket.emit('playerMoved', { id, ...activePlayers[id] });
    });

    // ၄။ Player လှုပ်ရှားမှု စင့်ခ်လုပ်ခြင်း (Real-time Movement Sync)
    socket.on('move', (data) => {
        // data = { x, y, z, yaw, pitch }
        activePlayers[socket.id] = {
            name: playerName,
            x: data.x,
            y: data.y,
            z: data.z,
            yaw: data.yaw || 0,
            pitch: data.pitch || 0,
            hp: data.hp || 20
        };

        // တခြားဆော့နေသူအားလုံးဆီ ဒီ player ရဲ့ တည်နေရာ အသစ်ကို ချက်ချင်းဖြန့်ဝေမယ်
        socket.broadcast.emit('playerMoved', {
            id: socket.id,
            ...activePlayers[socket.id]
        });
    });

    // ၅။ Block အသစ်ချခြင်း (Place Block Sync)
    socket.on('placeBlock', (data) => {
        // data = { x, y, z, type }
        const key = `${data.x},${data.y},${data.z}`;
        worldBlocks[key] = data.type; 

        // တခြားသူတွေဆီမှာပါ block အသစ် ချက်ချင်းပေါ်လာအောင်လုပ်မယ်
        socket.broadcast.emit('blockPlaced', data);
    });

    // ၆။ Block ဖျက်ခြင်း (Remove Block Sync)
    socket.on('removeBlock', (data) => {
        // data = { x, y, z }
        const key = `${data.x},${data.y},${data.z}`;
        if (worldBlocks[key]) {
            delete worldBlocks[key];
        }

        // တခြားသူတွေဆီမှာပါ အဲဒီ block ပျောက်သွားအောင်လုပ်မယ်
        socket.broadcast.emit('blockRemoved', data);
    });

    // ၇။ Chat System (ကစားသမားအချင်းချင်း စာပို့စနစ်)
    socket.on('chatMessage', (msg) => {
        const chatPayload = {
            sender: playerName,
            text: msg.trim()
        };
        // ဆော့နေတဲ့သူအားလုံးဆီ (အထွက်အဝင်အပါအဝင်) Message ဖြန့်ပေးမယ်
        io.emit('chatBroadcast', chatPayload);
    });

    // ၈။ Emoji Expression Sync
    socket.on('emoji', (data) => {
        // data = { emoji: '👋' }
        socket.broadcast.emit('emoji', {
            id: socket.id,
            emoji: data.emoji
        });
    });

    // ၉။ သွေးလျော့ခြင်း သို့မဟုတ် သေဆုံးခြင်း (Health/Death Sync)
    socket.on('playerDamage', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].hp = data.hp;
            if (data.hp <= 0) {
                io.emit('systemMessage', { text: `💀 ${playerName} was slain by a zombie.` });
            }
        }
    });

    // ၁၀။ Game ထဲက ထွက်သွားတဲ့အခါ (Disconnect Handling)
    socket.on('disconnect', () => {
        console.log(`📤 [Leave] ${playerName} disconnected.`);
        delete activePlayers[socket.id];
        
        // အခြားသူတွေရဲ့ Screen မှာပါ ဒီ Player ရဲ့ 3D Body ပျောက်သွားစေရန် လှမ်းပို့ခြင်း
        io.emit('playerLeft', socket.id);
    });
});

// ─────────────────────────────────────────
// SERVER-SIDE WORLD TIME CONTROLLER
// ─────────────────────────────────────────
// ကောင်းကင် နေ့/ည လည်ပတ်မှုကို Server ကနေ တပြေးညီ ထိန်းချုပ်ပေးခြင်း
setInterval(() => {
    serverTimeOfDay = (serverTimeOfDay + 0.000085) % 1;
    // အချိန်ပြောင်းလဲမှုကို ၁ စက္ကန့်တစ်ကြိမ် Player အားလုံးဆီ လှမ်းပို့ပေးမယ်
    io.emit('timeSync', { tod: serverTimeOfDay });
}, 1000);

// Server မောင်းနှင်ခြင်း
server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` ⛏  MINECLONE REAL-TIME ADVANCED SERVER IS NOW ONLINE!`);
    console.log(` 🌐 Local Network: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
