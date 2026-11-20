import * as THREE from 'three';

export const CELL = 72;
export const NX = 16;
export const NZ = 12;
export const ROADW = 16;
export const SIDEW = 5;
export const LANE_OFF = 4;
export const CURB = 0.35;
export const DAY_LEN = 180;

export const RX = [];
for (let i = 0; i <= NX; i++) RX.push((i - NX / 2) * CELL);
export const RZ = [];
for (let j = 0; j <= NZ; j++) RZ.push((j - NZ / 2) * CELL);

export const EXT_X = NX * CELL + ROADW;
export const EXT_Z = NZ * CELL + ROADW;

// River sits in column i=12; bridged cleanly on 4 major avenues
export const RIVER_I = 12;
export const BRIDGE_JS = [1, 4, 7, 10];
export const RIV_X0 = RX[RIVER_I] + ROADW / 2 - 2;
export const RIV_X1 = RX[RIVER_I + 1] - ROADW / 2 + 2;
export const SEA_X = RX[NX] + 12;

// Offshore island in the sea
export const ISLAND = { x: SEA_X + 215, z: 18, r: 78 };

export const IS_MOBILE = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
export const CFG = { N_NPC: IS_MOBILE ? 18 : 28, N_PED: IS_MOBILE ? 24 : 42, N_BOAT: IS_MOBILE ? 3 : 5 };

export const VTYPES = {
  sedan:       { len: 4.4, wid: 1.92, h: 0.62, max: 42, acc: 26, turn: 2.7, r: 1.65, hp: 100, boat: false },
  sport:       { len: 4.5, wid: 1.98, h: 0.50, max: 54, acc: 35, turn: 3.0, r: 1.65, hp: 110, boat: false },
  supercar:    { len: 4.7, wid: 2.08, h: 0.44, max: 66, acc: 44, turn: 3.25, r: 1.70, hp: 120, boat: false },
  truck:       { len: 5.8, wid: 2.25, h: 1.15, max: 35, acc: 19, turn: 2.15, r: 1.90, hp: 180, boat: false },
  bike:        { len: 2.3, wid: 0.80, h: 0.58, max: 50, acc: 32, turn: 3.5, r: 0.95, hp: 65, boat: false },
  cop:         { len: 4.5, wid: 1.96, h: 0.62, max: 48, acc: 31, turn: 2.9, r: 1.65, hp: 120, boat: false },
  interceptor: { len: 4.6, wid: 2.02, h: 0.52, max: 60, acc: 39, turn: 3.1, r: 1.70, hp: 135, boat: false },
  swat:        { len: 5.9, wid: 2.34, h: 1.38, max: 42, acc: 24, turn: 2.35, r: 2.05, hp: 260, boat: false },
  boat:        { len: 6.2, wid: 2.35, h: 0.85, max: 46, acc: 28, turn: 2.3, r: 1.95, hp: 150, boat: true }
};

export const WEAPONS = [
  { id: 'fists',   name: 'UNARMED',  clip: 0,  res: 0,   rate: 0.35, dmg: 25,  range: 2.4,  spread: 0,     pellets: 1, auto: false, color: 0xffffff },
  { id: 'pistol',  name: 'PISTOL',   clip: 12, res: 72,  rate: 0.24, dmg: 34,  range: 85,   spread: 0.014, pellets: 1, auto: false, color: 0xfef08a },
  { id: 'smg',     name: 'SMG',      clip: 30, res: 150, rate: 0.085,dmg: 22,  range: 75,   spread: 0.036, pellets: 1, auto: true,  color: 0xfde047 },
  { id: 'shotgun', name: 'SHOTGUN',  clip: 8,  res: 40,  rate: 0.68, dmg: 24,  range: 46,   spread: 0.085, pellets: 6, auto: false, color: 0xfb923c },
  { id: 'grenade', name: 'GRENADE',  clip: 1,  res: 6,   rate: 0.85, dmg: 180, range: 28,   spread: 0,     pellets: 1, auto: false, color: 0x4ade80 }
];

export const SHOPS = [
  { name: 'AMMU-NATION',  kind: 'weapons', color: 0xef4444, x: RX[6] + ROADW / 2 + 3.6, z: RZ[6] + 24, ry: -Math.PI / 2 },
  { name: 'COFFEE HOUSE', kind: 'coffee',  color: 0xf59e0b, x: RX[6] - ROADW / 2 - 3.6, z: RZ[5] - 24, ry: Math.PI / 2 },
  { name: 'GARAGE & PAY-SPRAY', kind: 'garage', color: 0x0ea5e9, x: RX[8] - ROADW / 2 - 3.6, z: RZ[6] + 24, ry: Math.PI / 2 }
];

export const SHOP_ITEMS = {
  weapons: [
    { id: 'pistol',  nm: 'PISTOL + AMMO',   pr: 80,  ds: '12-rd sidearm + 48 ammo' },
    { id: 'smg',     nm: 'SMG + AMMO',      pr: 220, ds: 'Rapid fire + 120 ammo' },
    { id: 'shotgun', nm: 'COMBAT SHOTGUN',  pr: 320, ds: '6-pellet blast + 32 ammo' },
    { id: 'grenade', nm: 'GRENADES (x4)',   pr: 180, ds: 'Explosive area blast' },
    { id: 'ammo',    nm: 'AMMO REFILL',     pr: 60,  ds: 'Top up all owned guns' },
    { id: 'vest',    nm: 'KEVLAR ARMOR',    pr: 150, ds: 'Full 100 armor shield' },
    { id: 'nitro',   nm: 'NITRO SYSTEM',    pr: 240, ds: 'SHIFT = boost' },
    { id: 'ram',     nm: 'REINFORCED RAM',  pr: 280, ds: 'Heavy traffic impact' }
  ],
  coffee: [
    { id: 'coffee', nm: 'ESPRESSO',     pr: 10, ds: '+25 HP' },
    { id: 'donut',  nm: 'GLAZED DONUT', pr: 8,  ds: '+15 HP' },
    { id: 'cig',    nm: 'CIGARETTES',   pr: 5,  ds: 'Cools wanted stars' },
    { id: 'energy', nm: 'ENERGY DRINK', pr: 20, ds: 'Refill nitro' }
  ],
  garage: [
    { id: 'repair',   nm: 'FULL REPAIR',     pr: 80,  ds: 'Restore HP + undent' },
    { id: 'payspray', nm: 'PAY & SPRAY',     pr: 150, ds: 'Clear all wanted stars' },
    { id: 'nitro',    nm: 'NITRO UPGRADE',   pr: 240, ds: 'Install SHIFT boost' }
  ],
  store: [
    { id: 'coffee', nm: 'COLD SODA',     pr: 6,  ds: '+15 HP' },
    { id: 'donut',  nm: 'SNACK PACK',    pr: 8,  ds: '+20 HP' },
    { id: 'cig',    nm: 'CIGARETTES',    pr: 5,  ds: 'Cools wanted stars' },
    { id: 'energy', nm: 'ENERGY DRINK',  pr: 20, ds: 'Refill nitro' }
  ],
  office: [],
  apt: []
};

export const CAR_PAINTS = [0xdc2626, 0x2563eb, 0xf59e0b, 0xf8fafc, 0x111827, 0x10b981, 0x7c3aed, 0xec4899];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}
export const fmtTime = s => {
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rnd = mulberry32(8421);
export const R = (a, b) => a + rnd() * (b - a);
export const pick = a => a[(rnd() * a.length) | 0];
export const $ = id => document.getElementById(id);
export const show = el => el && el.classList.remove('hidden');
export const hide = el => el && el.classList.add('hidden');

// Pre-allocated scratch math helpers (zero GC inside render loop)
export const TP = new THREE.Vector3();
export const TQ = new THREE.Quaternion();
export const TE = new THREE.Euler();
export const TS = new THREE.Vector3();
export const TC = new THREE.Color();
export const TM = new THREE.Matrix4();

export const store = {
  load() { try { return JSON.parse(localStorage.getItem('mm3d_best') || '{}'); } catch (e) { return {}; } },
  save(o) { try { localStorage.setItem('mm3d_best', JSON.stringify(o)); } catch (e) {} }
};

export const game = {
  state: 'menu',
  simTime: 0,
  dayT: 0.28,
  runDist: 0,
  runTime: 0,
  health: 100,
  armor: 0,
  wanted: 0,
  wantedCooldown: 0,
  dmgCooldown: 0,
  menuAngle: 0,
  money: 250,
  onFoot: false,
  shopOpen: false,
  curShop: null,
  inInterior: null,
  firstPerson: false,
  viewYaw: 0,
  viewPitch: 0.14,
  flashOn: false,
  smokeT: 0,
  smokeTick: 0,
  phoneOpen: false,
  radioOn: false,
  nightF: 0,
  dayF: 1,
  shake: 0,
  best: Object.assign({ dist: 0, time: 0 }, store.load()),
  upgrades: { nitro: false, armor: false, ram: false },
  nosFuel: 0,
  weather: { rain: false, intensity: 0, nextBolt: 10, boltI: 0 }
};

export const player = {
  pos: new THREE.Vector3(RX[5] - 4, 0, RZ[6] - 20),
  vel: new THREE.Vector3(),
  heading: 0,
  steer: 0,
  baseY: 0,
  speed: 0,
  vF: 0,
  vL: 0,
  drifting: false,
  punchT: 0,
  kickT: 0,
  walkPh: 0,
  veh: null
};

export const keys = { gas: false, brake: false, left: false, right: false, hb: false, nos: false, fire: false };
export const touch = { gas: false, brake: false, left: false, right: false, hb: false, nos: false, fire: false };
export const input = {
  get gas() { return keys.gas || touch.gas; },
  get brake() { return keys.brake || touch.brake; },
  get left() { return keys.left || touch.left; },
  get right() { return keys.right || touch.right; },
  get hb() { return keys.hb || touch.hb; },
  get nos() { return keys.nos || touch.nos; },
  get fire() { return keys.fire || touch.fire; }
};

export const missions = {
  active: false,
  timer: 0,
  cooldown: 3.5,
  reward: 0,
  type: '',
  target: new THREE.Vector3(),
  pickups: [],
  got: 0,
  bountyVeh: null,
  bountyHp: 0
};

export function districtGridOf(i, j) {
  if (i === RIVER_I) return 'river';
  if (i <= 3) return 'suburbs';
  if (i >= 13) return i === NX - 1 ? 'beach' : 'seaport';
  if (i >= 9 && j <= 5) return 'industrial';
  if (i >= 9 && j >= 6) return 'seaport';
  return 'downtown';
}

export function districtAt(x, z) {
  if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r + 12) return 'ISLAND';
  if (x > SEA_X + 4) return 'PACIFIC SEA';
  if (x > RIV_X0 && x < RIV_X1) return 'METRO RIVER';
  const i = clamp(Math.floor((x - RX[0]) / CELL), 0, NX - 1);
  const j = clamp(Math.floor((z - RZ[0]) / CELL), 0, NZ - 1);
  const d = districtGridOf(i, j);
  if (d === 'suburbs') return 'WEST SUBURBS';
  if (d === 'downtown') return 'DOWNTOWN';
  if (d === 'industrial') return 'INDUSTRIAL';
  if (d === 'seaport' || d === 'beach') return 'SEAPORT BAY';
  return 'OUTSKIRTS';
}
