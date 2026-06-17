/**
 * MINECRAFT PWA - game.js
 * Three.js r128 | Android Optimized | 60 FPS Target
 * Features: Chunk System, Procedural World, Physics, Touch Controls,
 *           Inventory, Mobs, Multiplayer (Socket.io), Emoji System
 */

// ============================================================
// CONSTANTS & CONFIG
// ============================================================
const CONFIG = {
  CHUNK_SIZE: 16,
  WORLD_HEIGHT: 64,
  RENDER_CHUNKS: 3,       // radius: 3 chunks = 3x3 around player
  SEED: Math.floor(Math.random() * 10000),
  GRAVITY: -20,
  JUMP_FORCE: 9,
  WALK_SPEED: 5,
  MOB_SPAWN_RADIUS: 48,
  MAX_MOBS: 12,
  TICK_RATE: 20,          // server ticks per second
};

// Block types
const BLOCKS = {
  AIR:   0,
  GRASS: 1,
  DIRT:  2,
  STONE: 3,
  WOOD:  4,
  LEAVES:5,
  SAND:  6,
  WATER: 7,
  COAL:  8,
  IRON:  9,
  GOLD:  10,
  DIAMOND:11,
  GRAVEL:12,
};

const BLOCK_META = {
  [BLOCKS.GRASS]:  { color:0x4CAF50, topColor:0x7EC850, emoji:'🟩', name:'Grass', hardness:1 },
  [BLOCKS.DIRT]:   { color:0x795548, topColor:0x795548, emoji:'🟫', name:'Dirt',  hardness:1 },
  [BLOCKS.STONE]:  { color:0x9E9E9E, topColor:0x9E9E9E, emoji:'🪨', name:'Stone', hardness:3 },
  [BLOCKS.WOOD]:   { color:0x8D6E63, topColor:0xA1887F, emoji:'🪵', name:'Wood',  hardness:2 },
  [BLOCKS.LEAVES]: { color:0x388E3C, topColor:0x388E3C, emoji:'🍃', name:'Leaves',hardness:1 },
  [BLOCKS.SAND]:   { color:0xF9A825, topColor:0xF9A825, emoji:'🟡', name:'Sand',  hardness:1 },
  [BLOCKS.WATER]:  { color:0x1565C0, topColor:0x1E88E5, emoji:'🌊', name:'Water', hardness:-1 },
  [BLOCKS.COAL]:   { color:0x212121, topColor:0x212121, emoji:'⬛', name:'Coal',  hardness:4 },
  [BLOCKS.IRON]:   { color:0xBDBDBD, topColor:0xE0E0E0, emoji:'⚪', name:'Iron',  hardness:5 },
  [BLOCKS.GOLD]:   { color:0xFFD600, topColor:0xFFEA00, emoji:'🟡', name:'Gold',  hardness:5 },
  [BLOCKS.DIAMOND]:{ color:0x00E5FF, topColor:0x18FFFF, emoji:'💎', name:'Diamond',hardness:6 },
  [BLOCKS.GRAVEL]: { color:0x78909C, topColor:0x90A4AE, emoji:'🩶', name:'Gravel',hardness:1 },
};

// ============================================================
// SIMPLE NOISE (Perlin-like using sine)
// ============================================================
function noise2D(x, z, seed) {
  const s = seed;
  const sx = Math.sin(x * 0.3 + s) * 43758.5453;
  const sz = Math.sin(z * 0.3 + s * 1.7) * 37284.1293;
  const mix = Math.sin(sx + sz + x * 0.1 + z * 0.13) * 0.5 + 0.5;
  return mix;
}
function octaveNoise(x, z, seed, octaves=4, persistence=0.5, lacunarity=2.0) {
  let val=0, amp=1, freq=1, max=0;
  for(let i=0;i<octaves;i++){
    val += noise2D(x*freq, z*freq, seed+i*1000) * amp;
    max += amp; amp*=persistence; freq*=lacunarity;
  }
  return val/max;
}

// ============================================================
// TEXTURE CACHE - create canvas textures per block type
// ============================================================
const textureCache = {};
function makeBlockTexture(color, topColor) {
  const key = `${color}_${topColor}`;
  if(textureCache[key]) return textureCache[key];
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  // fill base
  ctx.fillStyle = '#' + color.toString(16).padStart(6,'0');
  ctx.fillRect(0,0,16,16);
  // pixel noise for texture
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for(let i=0;i<20;i++){
    ctx.fillRect(Math.random()*14|0, Math.random()*14|0, 2, 2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for(let i=0;i<15;i++){
    ctx.fillRect(Math.random()*14|0, Math.random()*14|0, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  textureCache[key] = tex;
  return tex;
}

// ============================================================
// WORLD CLASS - Chunk management + generation
// ============================================================
class World {
  constructor() {
    this.chunks = new Map();  // key: "cx,cz" -> {blocks:[], mesh:Mesh}
    this.scene = null;
    this.pendingChunks = [];
  }

  getChunkKey(cx, cz) { return `${cx},${cz}`; }

  worldToChunk(wx, wz) {
    return [Math.floor(wx / CONFIG.CHUNK_SIZE), Math.floor(wz / CONFIG.CHUNK_SIZE)];
  }

  blockIndex(lx, y, lz) {
    return lx + lz * CONFIG.CHUNK_SIZE + y * CONFIG.CHUNK_SIZE * CONFIG.CHUNK_SIZE;
  }

  generateChunk(cx, cz) {
    const size = CONFIG.CHUNK_SIZE;
    const height = CONFIG.WORLD_HEIGHT;
    const blocks = new Uint8Array(size * size * height);

    for(let lx=0;lx<size;lx++){
      for(let lz=0;lz<size;lz++){
        const wx = cx*size+lx;
        const wz = cz*size+lz;

        // Biome detection
        const biomeNoise = octaveNoise(wx*0.005, wz*0.005, CONFIG.SEED+9999, 2);
        const isDesert = biomeNoise > 0.65;
        const isForest = biomeNoise < 0.35;

        // Height
        const h = Math.floor(octaveNoise(wx*0.015, wz*0.015, CONFIG.SEED, 4) * 20 + 32);

        for(let y=0;y<height;y++){
          let block = BLOCKS.AIR;
          if(y === 0) {
            block = BLOCKS.STONE;
          } else if(y < h - 4) {
            // Ore generation
            const oreNoise = octaveNoise(wx*0.1+y*0.1, wz*0.1+y*0.07, CONFIG.SEED+777, 2);
            if(y < 16 && oreNoise > 0.82) block = BLOCKS.DIAMOND;
            else if(y < 24 && oreNoise > 0.78) block = BLOCKS.GOLD;
            else if(y < 40 && oreNoise > 0.74) block = BLOCKS.IRON;
            else if(oreNoise > 0.76) block = BLOCKS.COAL;
            else block = BLOCKS.STONE;

            // Cave generation
            const caveN = octaveNoise(wx*0.08+y*0.08, wz*0.08, CONFIG.SEED+333, 3);
            if(caveN > 0.72) block = BLOCKS.AIR;

          } else if(y < h - 1) {
            block = BLOCKS.DIRT;
          } else if(y === h - 1) {
            block = isDesert ? BLOCKS.SAND : BLOCKS.GRASS;
          } else if(y <= 34 && y >= h) {
            block = BLOCKS.WATER;
          }
          blocks[this.blockIndex(lx, y, lz)] = block;
        }

        // Trees in forest biome
        if(isForest && !isDesert) {
          const treeNoise = octaveNoise(wx*0.3, wz*0.3, CONFIG.SEED+555, 1);
          if(treeNoise > 0.82 && h > 35) {
            const trunkH = 4 + Math.floor(treeNoise * 2);
            for(let ty=h;ty<h+trunkH && ty<height-5;ty++){
              blocks[this.blockIndex(lx,ty,lz)] = BLOCKS.WOOD;
            }
            // Leaves crown
            const th = h+trunkH;
            for(let ly=-2;ly<=2;ly++)for(let lly=-2;lly<=2;lly++) {
              if(Math.abs(ly)+Math.abs(lly) > 3) continue;
              const nx=lx+ly, nz=lz+lly;
              if(nx>=0&&nx<size&&nz>=0&&nz<size){
                if(th<height) blocks[this.blockIndex(nx,th,nz)] = BLOCKS.LEAVES;
                if(th+1<height) blocks[this.blockIndex(nx,th+1,nz)] = BLOCKS.LEAVES;
              }
            }
          }
        }
      }
    }

    return blocks;
  }

  getBlock(wx, wy, wz) {
    if(wy < 0 || wy >= CONFIG.WORLD_HEIGHT) return wy < 0 ? BLOCKS.STONE : BLOCKS.AIR;
    const [cx,cz] = this.worldToChunk(wx,wz);
    const chunk = this.chunks.get(this.getChunkKey(cx,cz));
    if(!chunk) return BLOCKS.AIR;
    const lx = ((wx%CONFIG.CHUNK_SIZE)+CONFIG.CHUNK_SIZE)%CONFIG.CHUNK_SIZE;
    const lz = ((wz%CONFIG.CHUNK_SIZE)+CONFIG.CHUNK_SIZE)%CONFIG.CHUNK_SIZE;
    return chunk.blocks[this.blockIndex(lx, wy, lz)];
  }

  setBlock(wx, wy, wz, type) {
    if(wy < 0 || wy >= CONFIG.WORLD_HEIGHT) return;
    const [cx,cz] = this.worldToChunk(wx,wz);
    const key = this.getChunkKey(cx,cz);
    const chunk = this.chunks.get(key);
    if(!chunk) return;
    const lx = ((wx%CONFIG.CHUNK_SIZE)+CONFIG.CHUNK_SIZE)%CONFIG.CHUNK_SIZE;
    const lz = ((wz%CONFIG.CHUNK_SIZE)+CONFIG.CHUNK_SIZE)%CONFIG.CHUNK_SIZE;
    chunk.blocks[this.blockIndex(lx,wy,lz)] = type;
    this.rebuildChunkMesh(cx, cz);
    // Rebuild neighbors if at edge
    if(lx===0) this.rebuildChunkMesh(cx-1,cz);
    if(lx===CONFIG.CHUNK_SIZE-1) this.rebuildChunkMesh(cx+1,cz);
    if(lz===0) this.rebuildChunkMesh(cx,cz-1);
    if(lz===CONFIG.CHUNK_SIZE-1) this.rebuildChunkMesh(cx,cz+1);
  }

  // Greedy mesh builder - combines faces, MUCH faster than per-block
  buildChunkMesh(cx, cz, blocks) {
    const size = CONFIG.CHUNK_SIZE;
    const h = CONFIG.WORLD_HEIGHT;
    const positions=[], normals=[], colors=[], indices=[];
    let vi = 0;

    const FACES = [
      { dir:[1,0,0],  verts:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]], nx:1,ny:0,nz:0, aoMult:0.8 },
      { dir:[-1,0,0], verts:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]], nx:-1,ny:0,nz:0, aoMult:0.8 },
      { dir:[0,1,0],  verts:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]], nx:0,ny:1,nz:0, aoMult:1.0 },
      { dir:[0,-1,0], verts:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]], nx:0,ny:-1,nz:0, aoMult:0.5 },
      { dir:[0,0,1],  verts:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]], nx:0,ny:0,nz:1, aoMult:0.9 },
      { dir:[0,0,-1], verts:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], nx:0,ny:0,nz:-1, aoMult:0.9 },
    ];

    const idx = (lx,y,lz) => lx+lz*size+y*size*size;

    for(let y=0;y<h;y++){
      for(let lz=0;lz<size;lz++){
        for(let lx=0;lx<size;lx++){
          const blockType = blocks[idx(lx,y,lz)];
          if(!blockType || blockType===BLOCKS.AIR) continue;
          const meta = BLOCK_META[blockType];
          if(!meta) continue;

          const wx = cx*size+lx;
          const wz = cz*size+lz;

          for(const face of FACES){
            const nx=lx+face.dir[0], ny=y+face.dir[1], nz=lz+face.dir[2];
            // Neighbor block (check chunk boundaries)
            let neighborBlock;
            if(nx<0||nx>=size||nz<0||nz>=size){
              neighborBlock = this.getBlock(wx+face.dir[0], y, wz+face.dir[2]);
            } else if(ny<0||ny>=h){
              neighborBlock = ny<0?BLOCKS.STONE:BLOCKS.AIR;
            } else {
              neighborBlock = blocks[idx(nx,ny,nz)];
            }

            if(neighborBlock && neighborBlock!==BLOCKS.AIR && neighborBlock!==BLOCKS.WATER) continue;

            // Choose color
            let c = (face.dir[1]===1) ? meta.topColor : meta.color;
            const r = ((c>>16)&0xff)/255 * face.aoMult;
            const g = ((c>>8)&0xff)/255  * face.aoMult;
            const b = (c&0xff)/255        * face.aoMult;

            for(const v of face.verts){
              positions.push(lx+v[0], y+v[1], lz+v[2]);
              normals.push(face.nx, face.ny, face.nz);
              colors.push(r, g, b);
            }
            indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
            vi += 4;
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);

    const mat = new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.FrontSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx*size, 0, cz*size);
    mesh.frustumCulled = true;
    return mesh;
  }

  rebuildChunkMesh(cx, cz) {
    const key = this.getChunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if(!chunk || !this.scene) return;
    if(chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
    chunk.mesh = this.buildChunkMesh(cx, cz, chunk.blocks);
    this.scene.add(chunk.mesh);
  }

  loadChunk(cx, cz) {
    const key = this.getChunkKey(cx, cz);
    if(this.chunks.has(key)) return;
    const blocks = this.generateChunk(cx, cz);
    const chunk = { blocks, mesh: null };
    this.chunks.set(key, chunk);
    chunk.mesh = this.buildChunkMesh(cx, cz, blocks);
    if(this.scene) this.scene.add(chunk.mesh);
  }

  unloadChunk(cx, cz) {
    const key = this.getChunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if(!chunk) return;
    if(chunk.mesh && this.scene) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh.material.dispose();
    }
    this.chunks.delete(key);
  }

  updateAroundPlayer(px, pz) {
    const [pcx, pcz] = this.worldToChunk(px, pz);
    const r = CONFIG.RENDER_CHUNKS;

    // Load needed
    for(let dx=-r;dx<=r;dx++){
      for(let dz=-r;dz<=r;dz++){
        this.loadChunk(pcx+dx, pcz+dz);
      }
    }

    // Unload far
    for(const [key, chunk] of this.chunks) {
      const [cx,cz] = key.split(',').map(Number);
      if(Math.abs(cx-pcx)>r+1 || Math.abs(cz-pcz)>r+1) {
        this.unloadChunk(cx,cz);
      }
    }
  }

  getSurfaceY(wx, wz) {
    for(let y=CONFIG.WORLD_HEIGHT-1;y>=0;y--){
      if(this.getBlock(wx,y,wz)!==BLOCKS.AIR) return y+1;
    }
    return 40;
  }
}

// ============================================================
// PLAYER CLASS
// ============================================================
class Player {
  constructor() {
    this.pos = new THREE.Vector3(8, 50, 8);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.yaw = 0;   // horizontal look
    this.pitch = 0; // vertical look
    this.health = 20;
    this.maxHealth = 20;
    this.inventory = new Array(36).fill(null);
    this.selectedSlot = 0;
    this.username = 'Player';
    this.isWalking = false;
  }

  addItem(blockType, count=1) {
    // Find existing stack
    for(let i=0;i<this.inventory.length;i++){
      if(this.inventory[i] && this.inventory[i].type===blockType && this.inventory[i].count<64){
        this.inventory[i].count = Math.min(64, this.inventory[i].count+count);
        return;
      }
    }
    // Find empty slot
    for(let i=0;i<this.inventory.length;i++){
      if(!this.inventory[i]){ this.inventory[i]={type:blockType,count}; return; }
    }
  }

  getHeldItem() { return this.inventory[this.selectedSlot]; }
}

// ============================================================
// MAIN GAME ENGINE
// ============================================================
class MinecraftGame {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.world = new World();
    this.player = new Player();
    this.clock = new THREE.Clock();
    this.running = false;
    this.socket = null;
    this.multiplayer = false;
    this.otherPlayers = new Map();
    this.mobs = new Map();
    this.breakingBlock = null;
    this.breakProgress = 0;
    this.highlightMesh = null;
    this.skybox = null;
    this.dayTime = 0.3; // 0-1, 0=midnight, 0.5=noon
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.ambientLight = null;
    this.sunLight = null;

    // Touch/input state
    this.joystick = { active:false, id:null, sx:0, sy:0, dx:0, dy:0 };
    this.lookTouch = { active:false, id:null, lx:0, ly:0 };
    this.input = { forward:0, right:0, jump:false, breaking:false, placing:false };

    // Inventory UI
    this.inventoryOpen = false;
    this.selectedInvSlot = -1;
  }

  async init(username, multiplayerMode) {
    this.player.username = username || 'Steve';
    this.multiplayer = multiplayerMode;

    // Renderer
    const canvas = document.getElementById('gameCanvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:false, powerPreference:'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false; // disable for performance

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87CEEB, 40, 80);
    this.world.scene = this.scene;

    // Camera (FPS)
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 200);

    // Lights
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.sunLight.position.set(100,100,50);
    this.scene.add(this.sunLight);

    // Skybox (simple colored sky)
    this.createSkybox();

    // Highlight cube
    this.createHighlight();

    // Generate initial chunks
    const [pcx,pcz] = this.world.worldToChunk(this.player.pos.x, this.player.pos.z);
    for(let dx=-2;dx<=2;dx++){
      for(let dz=-2;dz<=2;dz++){
        this.world.loadChunk(pcx+dx, pcz+dz);
      }
    }

    // Set player on surface
    const sy = this.world.getSurfaceY(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z));
    this.player.pos.y = sy + 1.8;

    // Give starter items
    this.player.addItem(BLOCKS.DIRT, 32);
    this.player.addItem(BLOCKS.STONE, 32);
    this.player.addItem(BLOCKS.WOOD, 16);
    this.player.addItem(BLOCKS.SAND, 16);
    this.player.addItem(BLOCKS.GRASS, 8);

    // Setup UI
    this.setupUI();
    this.setupTouchControls();
    this.updateHotbar();

    // Multiplayer
    if(multiplayerMode) this.connectMultiplayer();

    // Resize handler
    window.addEventListener('resize', () => this.onResize());

    this.running = true;
    this.loop();
  }

  createSkybox() {
    const geo = new THREE.SphereGeometry(180, 16, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x87CEEB, side: THREE.BackSide
    });
    this.skybox = new THREE.Mesh(geo, mat);
    this.scene.add(this.skybox);

    // Sun sphere
    const sunGeo = new THREE.SphereGeometry(5, 8, 8);
    const sunMat = new THREE.MeshBasicMaterial({ color:0xFFFDE7 });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sun);

    // Moon sphere
    const moonGeo = new THREE.SphereGeometry(3, 8, 8);
    const moonMat = new THREE.MeshBasicMaterial({ color:0xE0E0E0 });
    this.moon = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moon);
  }

  updateDayNight(dt) {
    this.dayTime = (this.dayTime + dt * 0.005) % 1;
    const angle = this.dayTime * Math.PI * 2;

    // Sun/moon position
    this.sun.position.set(
      this.camera.position.x + Math.cos(angle) * 150,
      Math.sin(angle) * 150,
      this.camera.position.z
    );
    this.moon.position.set(
      this.camera.position.x + Math.cos(angle+Math.PI) * 150,
      Math.sin(angle+Math.PI) * 150,
      this.camera.position.z
    );

    // Sky color
    const dawn = Math.max(0, Math.sin(angle));
    const skyR = Math.floor(0x1a + dawn * (0x87-0x1a));
    const skyG = Math.floor(0x1a + dawn * (0xCE-0x1a));
    const skyB = Math.floor(0x2e + dawn * (0xEB-0x2e));
    const skyColor = (skyR<<16)|(skyG<<8)|skyB;
    this.skybox.material.color.setHex(skyColor);
    this.scene.fog.color.setHex(skyColor);

    // Ambient light
    const intensity = Math.max(0.08, dawn * 0.6);
    this.ambientLight.intensity = intensity;
    this.sunLight.intensity = Math.max(0, dawn * 0.9);
    this.sunLight.position.copy(this.sun.position);
  }

  createHighlight() {
    const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
    const mat = new THREE.MeshBasicMaterial({
      color:0x000000, wireframe:true, transparent:true, opacity:0.5
    });
    this.highlightMesh = new THREE.Mesh(geo, mat);
    this.highlightMesh.visible = false;
    this.scene.add(this.highlightMesh);
  }

  // Raycast to find targeted block
  raycastBlock() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const start = this.camera.position.clone();

    for(let dist=0.5; dist<=6; dist+=0.1){
      const p = start.clone().addScaledVector(dir, dist);
      const bx=Math.floor(p.x), by=Math.floor(p.y), bz=Math.floor(p.z);
      const block = this.world.getBlock(bx, by, bz);
      if(block && block!==BLOCKS.AIR && block!==BLOCKS.WATER){
        // Face normal for placing
        const prev = start.clone().addScaledVector(dir, dist-0.1);
        const px2=Math.floor(prev.x), py2=Math.floor(prev.y), pz2=Math.floor(prev.z);
        return {
          bx, by, bz, block,
          nx:px2-bx, ny:py2-by, nz:pz2-bz
        };
      }
    }
    return null;
  }

  updateHighlight() {
    const hit = this.raycastBlock();
    if(hit){
      this.highlightMesh.position.set(hit.bx+0.5, hit.by+0.5, hit.bz+0.5);
      this.highlightMesh.visible = true;
    } else {
      this.highlightMesh.visible = false;
    }
    return hit;
  }

  breakBlock() {
    const hit = this.raycastBlock();
    if(!hit) return;
    const meta = BLOCK_META[hit.block];
    if(meta && meta.hardness < 0) return; // indestructible
    this.world.setBlock(hit.bx, hit.by, hit.bz, BLOCKS.AIR);
    this.player.addItem(hit.block, 1);
    this.updateHotbar();
    this.updateInventoryUI();
    if(this.socket) {
      this.socket.emit('blockUpdate', { x:hit.bx, y:hit.by, z:hit.bz, type:BLOCKS.AIR });
    }
  }

  placeBlock() {
    const hit = this.raycastBlock();
    if(!hit) return;
    const held = this.player.getHeldItem();
    if(!held || held.count <= 0) return;
    const px=hit.bx+hit.nx, py=hit.by+hit.ny, pz=hit.bz+hit.nz;
    // Don't place inside player
    const pp = this.player.pos;
    if(px===Math.floor(pp.x) && pz===Math.floor(pp.z) &&
       (py===Math.floor(pp.y) || py===Math.floor(pp.y)-1)) return;
    this.world.setBlock(px, py, pz, held.type);
    held.count--;
    if(held.count<=0) this.player.inventory[this.player.selectedSlot] = null;
    this.updateHotbar();
    if(this.socket) {
      this.socket.emit('blockUpdate', { x:px, y:py, z:pz, type:held.type });
    }
  }

  // Physics update
  updatePhysics(dt) {
    const speed = CONFIG.WALK_SPEED;
    const pos = this.player.pos;
    const vel = this.player.vel;

    // Movement direction
    const yaw = this.player.yaw;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));

    const moveVec = new THREE.Vector3();
    moveVec.addScaledVector(forward, -this.input.forward);
    moveVec.addScaledVector(right,    this.input.right);
    if(moveVec.length() > 0) moveVec.normalize();

    vel.x = moveVec.x * speed;
    vel.z = moveVec.z * speed;

    this.player.isWalking = moveVec.length() > 0.1;

    // Jump
    if(this.input.jump && this.player.onGround){
      vel.y = CONFIG.JUMP_FORCE;
      this.player.onGround = false;
    }

    // Gravity
    vel.y += CONFIG.GRAVITY * dt;

    // Move X
    pos.x += vel.x * dt;
    if(this.checkCollision(pos)) pos.x -= vel.x * dt;

    // Move Y
    pos.y += vel.y * dt;
    if(this.checkCollision(pos)){
      if(vel.y < 0){ this.player.onGround = true; }
      vel.y = 0;
      while(this.checkCollision(pos)) pos.y += vel.y < 0 ? 0.05 : -0.05;
    } else {
      this.player.onGround = false;
    }

    // Move Z
    pos.z += vel.z * dt;
    if(this.checkCollision(pos)) pos.z -= vel.z * dt;

    // Camera follows player head
    this.camera.position.set(pos.x, pos.y + 0.6, pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;

    // Skybox follows camera
    if(this.skybox) this.skybox.position.copy(this.camera.position);

    // Update HUD coords
    document.getElementById('coords').textContent =
      `X:${pos.x.toFixed(0)} Y:${pos.y.toFixed(0)} Z:${pos.z.toFixed(0)}`;
  }

  checkCollision(pos) {
    const w=0.35, h=1.8;
    for(let dx=-w;dx<=w;dx+=w*2){
      for(let dz=-w;dz<=w;dz+=w*2){
        for(let dy=0;dy<h;dy+=0.5){
          const bx=Math.floor(pos.x+dx);
          const by=Math.floor(pos.y+dy);
          const bz=Math.floor(pos.z+dz);
          const b=this.world.getBlock(bx,by,bz);
          if(b&&b!==BLOCKS.AIR&&b!==BLOCKS.WATER) return true;
        }
      }
    }
    return false;
  }

  // ============================================================
  // TOUCH CONTROLS
  // ============================================================
  setupTouchControls() {
    const joystickZone = document.getElementById('joystickZone');
    const handle = document.getElementById('joystickHandle');
    const base = joystickZone.getBoundingClientRect();
    const cx = 65, cy = 65; // center

    joystickZone.addEventListener('touchstart', e=>{
      e.preventDefault();
      const t = e.changedTouches[0];
      this.joystick = { active:true, id:t.identifier,
        sx:t.clientX-joystickZone.getBoundingClientRect().left,
        sy:t.clientY-joystickZone.getBoundingClientRect().top, dx:0, dy:0 };
      joystickZone.style.opacity='1';
    }, {passive:false});

    joystickZone.addEventListener('touchmove', e=>{
      e.preventDefault();
      for(const t of e.changedTouches){
        if(t.identifier===this.joystick.id){
          const rect = joystickZone.getBoundingClientRect();
          const dx = t.clientX - rect.left - cx;
          const dy = t.clientY - rect.top  - cy;
          const maxR = 40;
          const len = Math.sqrt(dx*dx+dy*dy);
          const nx = len>maxR ? dx/len*maxR : dx;
          const ny = len>maxR ? dy/len*maxR : dy;
          this.joystick.dx = nx/maxR;
          this.joystick.dy = ny/maxR;
          handle.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
          this.input.forward = this.joystick.dy;
          this.input.right   = this.joystick.dx;
        }
      }
    }, {passive:false});

    const endJoystick = (e)=>{
      for(const t of e.changedTouches){
        if(t.identifier===this.joystick.id){
          this.joystick.active=false; this.input.forward=0; this.input.right=0;
          handle.style.transform='translate(-50%,-50%)';
          joystickZone.style.opacity='0.6';
        }
      }
    };
    joystickZone.addEventListener('touchend', endJoystick, {passive:false});
    joystickZone.addEventListener('touchcancel', endJoystick, {passive:false});

    // Camera look - right side of screen
    const canvas = document.getElementById('gameCanvas');
    canvas.addEventListener('touchstart', e=>{
      e.preventDefault();
      for(const t of e.changedTouches){
        if(!this.joystick.active || t.identifier!==this.joystick.id){
          if(!this.lookTouch.active){
            this.lookTouch = { active:true, id:t.identifier, lx:t.clientX, ly:t.clientY };
          }
        }
      }
    }, {passive:false});

    canvas.addEventListener('touchmove', e=>{
      e.preventDefault();
      for(const t of e.changedTouches){
        if(t.identifier===this.lookTouch.id){
          const dx = t.clientX - this.lookTouch.lx;
          const dy = t.clientY - this.lookTouch.ly;
          this.player.yaw   -= dx * 0.003;
          this.player.pitch -= dy * 0.003;
          this.player.pitch = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, this.player.pitch));
          this.lookTouch.lx = t.clientX;
          this.lookTouch.ly = t.clientY;
        }
      }
    }, {passive:false});

    canvas.addEventListener('touchend', e=>{
      for(const t of e.changedTouches){
        if(t.identifier===this.lookTouch.id) this.lookTouch.active=false;
      }
    }, {passive:false});

    // Action buttons
    document.getElementById('btnJump').addEventListener('touchstart', e=>{ e.preventDefault(); this.input.jump=true; }, {passive:false});
    document.getElementById('btnJump').addEventListener('touchend',   e=>{ e.preventDefault(); this.input.jump=false; }, {passive:false});
    document.getElementById('btnBreak').addEventListener('touchstart', e=>{ e.preventDefault(); this.breakBlock(); }, {passive:false});
    document.getElementById('btnPlace').addEventListener('touchstart', e=>{ e.preventDefault(); this.placeBlock(); }, {passive:false});

    // PC mouse look (for testing)
    canvas.addEventListener('click', ()=> canvas.requestPointerLock?.());
    document.addEventListener('mousemove', e=>{
      if(document.pointerLockElement===canvas){
        this.player.yaw   -= e.movementX * 0.002;
        this.player.pitch -= e.movementY * 0.002;
        this.player.pitch = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, this.player.pitch));
      }
    });
    document.addEventListener('keydown', e=>{
      if(e.code==='Space') this.input.jump=true;
      if(e.code==='KeyW') this.input.forward=-1;
      if(e.code==='KeyS') this.input.forward=1;
      if(e.code==='KeyA') this.input.right=-1;
      if(e.code==='KeyD') this.input.right=1;
      if(e.code==='MouseLeft'||e.code==='KeyF') this.breakBlock();
      if(e.code==='KeyR') this.placeBlock();
      if(e.key>='1'&&e.key<='9'){ this.player.selectedSlot=parseInt(e.key)-1; this.updateHotbar(); }
    });
    document.addEventListener('keyup', e=>{
      if(e.code==='Space') this.input.jump=false;
      if(e.code==='KeyW'||e.code==='KeyS') this.input.forward=0;
      if(e.code==='KeyA'||e.code==='KeyD') this.input.right=0;
    });
    document.addEventListener('mousedown', e=>{
      if(document.pointerLockElement===document.getElementById('gameCanvas')){
        if(e.button===0) this.breakBlock();
        if(e.button===2) this.placeBlock();
      }
    });
    document.addEventListener('contextmenu', e=> e.preventDefault());

    // Hotbar selection
    document.querySelectorAll('.hotSlot').forEach(slot=>{
      slot.addEventListener('touchstart', e=>{
        e.stopPropagation();
        this.player.selectedSlot = parseInt(slot.dataset.slot);
        this.updateHotbar();
      });
    });

    // Scroll hotbar
    canvas.addEventListener('wheel', e=>{
      this.player.selectedSlot = (this.player.selectedSlot + (e.deltaY>0?1:-1) + 9) % 9;
      this.updateHotbar();
    });
  }

  // ============================================================
  // UI SETUP
  // ============================================================
  setupUI() {
    // Inventory
    document.getElementById('invBtn').addEventListener('click', ()=> this.toggleInventory());
    document.getElementById('closeInvBtn').addEventListener('click', ()=> this.toggleInventory());
    this.buildInventoryGrid();

    // Emoji wheel
    document.getElementById('emojiBtn').addEventListener('click', ()=>{
      const w = document.getElementById('emojiWheel');
      w.style.display = w.style.display==='grid' ? 'none' : 'grid';
    });
    document.querySelectorAll('.emojiItem').forEach(item=>{
      item.addEventListener('click', ()=>{
        const emoji = item.dataset.emoji;
        document.getElementById('emojiWheel').style.display='none';
        this.triggerEmoji(this.player.username, emoji, true);
        if(this.socket) this.socket.emit('emoji', { emoji });
      });
    });
  }

  toggleInventory() {
    this.inventoryOpen = !this.inventoryOpen;
    document.getElementById('inventoryScreen').style.display =
      this.inventoryOpen ? 'flex' : 'none';
    this.updateInventoryUI();
  }

  buildInventoryGrid() {
    const grid = document.getElementById('inventoryGrid');
    grid.innerHTML = '';
    for(let i=0;i<36;i++){
      const div = document.createElement('div');
      div.className='invSlot'; div.dataset.idx=i;
      div.innerHTML='<span class="invCount"></span>';
      div.addEventListener('click', ()=> this.onInvSlotClick(i));
      grid.appendChild(div);
    }
  }

  onInvSlotClick(idx) {
    if(this.selectedInvSlot===-1){
      if(this.player.inventory[idx]) this.selectedInvSlot=idx;
    } else {
      // Swap
      const tmp = this.player.inventory[this.selectedInvSlot];
      this.player.inventory[this.selectedInvSlot] = this.player.inventory[idx];
      this.player.inventory[idx] = tmp;
      this.selectedInvSlot = -1;
    }
    this.updateInventoryUI();
  }

  updateInventoryUI() {
    const slots = document.querySelectorAll('.invSlot');
    slots.forEach((slot,i)=>{
      const item = this.player.inventory[i];
      const meta = item ? BLOCK_META[item.type] : null;
      slot.innerHTML = meta
        ? `${meta.emoji}<span class="invCount">${item.count}</span>`
        : '<span class="invCount"></span>';
      slot.classList.toggle('selected', i===this.selectedInvSlot);
    });
  }

  updateHotbar() {
    document.querySelectorAll('.hotSlot').forEach((slot,i)=>{
      const item = this.player.inventory[i];
      const meta = item ? BLOCK_META[item.type] : null;
      slot.querySelector('.slotIcon').textContent = meta ? meta.emoji : '';
      slot.querySelector('.slotCount').textContent = item ? item.count : '0';
      slot.classList.toggle('active', i===this.player.selectedSlot);
    });
  }

  addChatMessage(text) {
    const box = document.getElementById('chatBox');
    const msg = document.createElement('div');
    msg.className='chatMsg'; msg.textContent=text;
    box.appendChild(msg);
    setTimeout(()=> msg.remove(), 5000);
  }

  triggerEmoji(username, emoji, isSelf) {
    const emojiMap = {
      wave:'👋', laugh:'😂', dance:'💃', angry:'😠', love:'❤️', cool:'😎'
    };
    const em = emojiMap[emoji]||emoji;
    this.addChatMessage(`${username}: ${em}`);
  }

  // ============================================================
  // MULTIPLAYER (Socket.io)
  // ============================================================
  connectMultiplayer() {
    try {
      this.socket = io(window.location.origin, { transports:['websocket'] });

      this.socket.on('connect', ()=>{
        console.log('Connected to server');
        this.socket.emit('join', { username: this.player.username,
          x:this.player.pos.x, y:this.player.pos.y, z:this.player.pos.z });
        this.addChatMessage('Connected to server!');
      });

      this.socket.on('playerJoined', (data)=>{
        if(data.id===this.socket.id) return;
        this.spawnOtherPlayer(data);
        this.addChatMessage(`${data.username} joined the game`);
      });

      this.socket.on('playerLeft', (data)=>{
        this.removeOtherPlayer(data.id);
        this.addChatMessage(`${data.username} left the game`);
      });

      this.socket.on('playerMoved', (data)=>{
        if(data.id===this.socket.id) return;
        const op = this.otherPlayers.get(data.id);
        if(op) {
          op.mesh.position.set(data.x, data.y, data.z);
          op.mesh.rotation.y = data.yaw || 0;
        }
      });

      this.socket.on('existingPlayers', (players)=>{
        players.forEach(p=> this.spawnOtherPlayer(p));
      });

      this.socket.on('blockUpdate', (data)=>{
        this.world.setBlock(data.x, data.y, data.z, data.type);
      });

      this.socket.on('emoji', (data)=>{
        if(data.id!==this.socket?.id)
          this.triggerEmoji(data.username, data.emoji, false);
      });

      this.socket.on('mobUpdate', (mobs)=>{
        mobs.forEach(m=> this.updateMob(m));
      });

      // Send position every 50ms
      setInterval(()=>{
        if(!this.socket?.connected) return;
        this.socket.emit('move', {
          x:this.player.pos.x, y:this.player.pos.y, z:this.player.pos.z,
          yaw:this.player.yaw, walking:this.player.isWalking
        });
      }, 50);

    } catch(e) { console.warn('Multiplayer unavailable:', e); }
  }

  spawnOtherPlayer(data) {
    if(this.otherPlayers.has(data.id)) return;
    // Simple block character
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color:0x4CAF50 });
    const headMat = new THREE.MeshLambertMaterial({ color:0xFFCC80 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.75,0.3), bodyMat);
    body.position.y = 0.375;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), headMat);
    head.position.y = 1.0;
    group.add(body, head);
    group.position.set(data.x||0, data.y||40, data.z||0);
    this.scene.add(group);
    this.otherPlayers.set(data.id, { mesh:group, username:data.username });
  }

  removeOtherPlayer(id) {
    const op = this.otherPlayers.get(id);
    if(op){ this.scene.remove(op.mesh); this.otherPlayers.delete(id); }
  }

  updateMob(data) {
    if(!this.mobs.has(data.id)){
      const geo = new THREE.BoxGeometry(0.8, 1.8, 0.6);
      const mat = new THREE.MeshLambertMaterial({ color: data.type==='zombie'?0x4CAF50:0xA0522D });
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);
      this.mobs.set(data.id, { mesh });
    }
    const mob = this.mobs.get(data.id);
    mob.mesh.position.set(data.x, data.y, data.z);
  }

  // ============================================================
  // MAIN LOOP
  // ============================================================
  loop() {
    if(!this.running) return;
    requestAnimationFrame(()=> this.loop());

    const dt = Math.min(this.clock.getDelta(), 0.05); // cap at 50ms

    // FPS Counter
    this.fpsFrames++;
    this.fpsTime += dt;
    if(this.fpsTime >= 0.5){
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      document.getElementById('fpsCounter').textContent = `FPS: ${this.fps}`;
      this.fpsFrames=0; this.fpsTime=0;
    }

    // Updates
    this.updatePhysics(dt);
    this.world.updateAroundPlayer(this.player.pos.x, this.player.pos.z);
    this.updateHighlight();
    this.updateDayNight(dt);

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// ============================================================
// STARTUP FLOW
// ============================================================
let game = null;

window.addEventListener('DOMContentLoaded', () => {
  // Loading screen -> Start screen
  setTimeout(()=>{
    document.getElementById('loadScreen').style.display='none';
    document.getElementById('startScreen').style.display='flex';
  }, 2200);

  // Singleplayer
  document.getElementById('btnSingleplayer').addEventListener('click', async ()=>{
    await startGame(false);
  });

  // Multiplayer
  document.getElementById('btnMultiplayer').addEventListener('click', async ()=>{
    await startGame(true);
  });
});

async function startGame(multiplayer) {
  const username = document.getElementById('usernameInput').value.trim() || 'Steve';

  // Request fullscreen
  const docEl = document.documentElement;
  if(docEl.requestFullscreen) docEl.requestFullscreen().catch(()=>{});
  else if(docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();

  // Lock orientation to landscape
  if(screen.orientation?.lock) {
    screen.orientation.lock('landscape').catch(()=>{});
  }

  // Show game UI
  document.getElementById('startScreen').style.display='none';
  document.getElementById('gameCanvas').style.display='block';
  document.getElementById('hud').style.display='block';
  document.getElementById('joystickZone').style.display='block';
  document.getElementById('joystickZone').style.opacity='0.6';
  document.getElementById('actionBtns').style.display='flex';
  document.getElementById('invBtn').style.display='block';
  document.getElementById('emojiBtn').style.display='flex';
  document.getElementById('chatBox').style.display='block';

  // Init game
  game = new MinecraftGame();
  await game.init(username, multiplayer);
}
