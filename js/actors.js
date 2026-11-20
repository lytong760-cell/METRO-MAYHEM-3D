import * as THREE from 'three';
import {
  CELL, RX, RZ, ROADW, LANE_OFF, RIVER_I, SEA_X, RIV_X0, RIV_X1, BRIDGE_JS,
  IS_MOBILE, CFG, VTYPES, game, player, clamp, lerpAngle, R, pick, TP, TQ, TE, TS, TM, $
} from './state.js';
import { crashSound, explosionSound, horn } from './audio.js';
import {
  scene, blocks, boltLight, groundYAt, inWaterAt, collideSolidsAt, interiorCache, bridgeDeckY
} from './world.js';
import { makeVehicle, dentVehicle } from './vehicles.js';

// Callbacks registered by main.js to break circular imports cleanly
const hooks = {
  damage: () => {},
  addWanted: () => {},
  flash: () => {},
  toast: () => {},
  busted: () => {}
};
export function registerActorHooks(h) { Object.assign(hooks, h); }

// --- Particles ---
const PMAX = 260;
const pPos = new Float32Array(PMAX * 3);
const pVel = new Float32Array(PMAX * 3);
export const pLife = new Float32Array(PMAX);
const pMax = new Float32Array(PMAX);
const pSize = new Float32Array(PMAX);
export const pAlpha = new Float32Array(PMAX);
const pCol = new Float32Array(PMAX * 3);
let pCursor = 0;

const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
const pPoints = new THREE.Points(
  pGeo,
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `attribute float aAlpha;attribute float aSize;attribute vec3 aColor;varying float vA;varying vec3 vC;
      void main(){vA=aAlpha;vC=aColor;vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=aSize*(220.0/max(1.0,-mv.z));gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying float vA;varying vec3 vC;
      void main(){if(vA<0.01)discard;float d=length(gl_PointCoord-0.5);
      gl_FragColor=vec4(vC,smoothstep(0.5,0.12,d)*vA*0.6);}`
  })
);
pPoints.frustumCulled = false;
scene.add(pPoints);

export function spawnPuff(x, y, z, vx, vy, vz, size, life, r, g, b) {
  const i = pCursor;
  pCursor = (pCursor + 1) % PMAX;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pLife[i] = pMax[i] = Math.max(0.05, life);
  pSize[i] = size;
  pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b;
}

export function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
    pLife[i] -= dt;
    const k = i * 3;
    pPos[k] += pVel[k] * dt;
    pPos[k + 1] += pVel[k + 1] * dt;
    pPos[k + 2] += pVel[k + 2] * dt;
    pVel[k + 1] += (pCol[k + 1] > 0.5 ? -8 : 1.1) * dt;
    pAlpha[i] = Math.max(0, pLife[i] / pMax[i]);
    pSize[i] += dt * (pCol[k + 1] > 0.5 ? 0 : 2.4);
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.aAlpha.needsUpdate = true;
  pGeo.attributes.aSize.needsUpdate = true;
  pGeo.attributes.aColor.needsUpdate = true;
}

// --- Debris ---
const DEB = 42;
export const debData = [];
for (let i = 0; i < DEB; i++) {
  debData.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), s: 1 });
}
const debMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.16, 0.32), new THREE.MeshStandardMaterial({ roughness: 0.55 }), DEB);
debMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debMesh.frustumCulled = false;
{
  const M0 = new THREE.Matrix4().makeScale(0, 0, 0);
  const C0 = new THREE.Color(0x888888);
  for (let i = 0; i < DEB; i++) { debMesh.setMatrixAt(i, M0); debMesh.setColorAt(i, C0); }
}
scene.add(debMesh);
const debColors = new THREE.Color();

export function spawnDebris(x, y, z, color, n) {
  let s = 0;
  for (let i = 0; i < DEB && s < n; i++) {
    const dd = debData[i];
    if (dd.life > 0) continue;
    s++;
    dd.life = R(1.2, 2.2);
    dd.p.set(x, y, z);
    dd.v.set(R(-8, 8), R(4, 11), R(-8, 8));
    dd.rv.set(R(-9, 9), R(-9, 9), R(-9, 9));
    dd.s = R(0.6, 1.7);
    debMesh.setColorAt(i, debColors.set(Math.random() < 0.35 ? 0x9fd8ff : color));
  }
  if (debMesh.instanceColor) debMesh.instanceColor.needsUpdate = true;
}

export function updateDebris(dt) {
  for (let i = 0; i < DEB; i++) {
    const dd = debData[i];
    if (dd.life <= 0) {
      TM.makeScale(0, 0, 0);
      TM.setPosition(0, -60, 0);
      debMesh.setMatrixAt(i, TM);
      continue;
    }
    dd.life -= dt;
    dd.v.y -= 22 * dt;
    dd.p.addScaledVector(dd.v, dt);
    const gy = groundYAt(dd.p.x, dd.p.z) + 0.1;
    if (dd.p.y < gy) { dd.p.y = gy; dd.v.y *= -0.35; dd.v.x *= 0.7; dd.v.z *= 0.7; }
    dd.r.x += dd.rv.x * dt; dd.r.y += dd.rv.y * dt; dd.r.z += dd.rv.z * dt;
    const sc = dd.s * Math.min(1, dd.life);
    TQ.setFromEuler(dd.r);
    TS.set(sc, sc, sc);
    TM.compose(dd.p, TQ, TS);
    debMesh.setMatrixAt(i, TM);
  }
  debMesh.instanceMatrix.needsUpdate = true;
}

// --- Rain ---
const RAIN_N = IS_MOBILE ? 700 : 1400;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainPos[i * 3] = R(-75, 75); rainPos[i * 3 + 1] = R(0, 48); rainPos[i * 3 + 2] = R(-75, 75); }
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainPts = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x9fc8e8, size: 0.13, transparent: true, opacity: 0.55, depthWrite: false }));
rainPts.visible = false;
scene.add(rainPts);

export function updateRain(dt, camera) {
  game.weather.intensity = THREE.MathUtils.lerp(game.weather.intensity, game.weather.rain ? 1 : 0, 1 - Math.exp(-1.5 * dt));
  rainPts.visible = game.weather.intensity > 0.03 && !game.inInterior;
  if (!rainPts.visible) {
    game.weather.boltI *= Math.exp(-6 * dt);
    boltLight.intensity = game.weather.boltI;
    return;
  }
  rainPts.position.set(camera.position.x, 0, camera.position.z);
  const p = rainGeo.attributes.position.array;
  for (let i = 0; i < RAIN_N; i++) {
    p[i * 3 + 1] -= 40 * dt;
    if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 48;
  }
  rainGeo.attributes.position.needsUpdate = true;
  if (game.simTime > game.weather.nextBolt) {
    game.weather.nextBolt = game.simTime + R(6, 15);
    const bf = $('boltFlash');
    if (bf) { bf.style.opacity = 0.85; setTimeout(() => { bf.style.opacity = 0; }, 120); }
    game.weather.boltI = 9;
    boltLight.position.set(camera.position.x + R(-80, 80), 120, camera.position.z + R(-80, 80));
    setTimeout(() => crashSound(1.6), R(200, 900));
  }
  game.weather.boltI *= Math.exp(-5 * dt);
  boltLight.intensity = game.weather.boltI;
}

// --- Traffic & Boats ---
export const npcs = [];
{
  const colors = [0x2563eb, 0xf59e0b, 0x16a34a, 0xdc2626, 0x7c3aed, 0x0ea5e9, 0xf1f5f9, 0x334155, 0xea580c];
  const types = ['sedan', 'sedan', 'sport', 'supercar', 'truck', 'bike', 'sedan'];
  for (let i = 0; i < CFG.N_NPC; i++) {
    const v = makeVehicle(scene, colors[i % colors.length], types[i % types.length]);
    const n = { veh: v, axis: 'z', dir: 1, lane: 0, own: 0, ownIdx: 0, along: 0, speed: 0, cruise: R(11, 17), nextR: 0, yaw: 0, hitTimer: 0, blocked: 0, active: false };
    v.npc = n;
    npcs.push(n);
  }
}

export const npcBoats = [];
for (let i = 0; i < CFG.N_BOAT; i++) {
  const v = makeVehicle(scene, pick([0xf8fafc, 0x0ea5e9, 0xf59e0b, 0xdc2626]), 'boat');
  npcBoats.push({
    veh: v,
    x: i < 2 ? (RIV_X0 + RIV_X1) / 2 + (i === 0 ? -6 : 6) : SEA_X + 75 + i * 35,
    z: R(-260, 260),
    dir: i % 2 === 0 ? 1 : -1,
    speed: R(10, 15),
    active: true
  });
}

const idxOfX = v => clamp(Math.round((v - RX[0]) / CELL), 0, RX.length - 1);
const idxOfZ = v => clamp(Math.round((v - RZ[0]) / CELL), 0, RZ.length - 1);
const laneOffset = (axis, dir) => (axis === 'z' ? (dir > 0 ? -LANE_OFF : LANE_OFF) : (dir > 0 ? LANE_OFF : -LANE_OFF));
const yawOf = (axis, dir) => (axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2));

function validXIdx(i) { return i !== RIVER_I && i !== RIVER_I + 1 && RX[i] < SEA_X - 10; }

function nextLineAfter(arr, v, dir, axis) {
  let i = Math.round((v - arr[0]) / CELL) + dir;
  if (i < 0 || i >= arr.length) return null;
  if (axis === 'x' && arr[i] > RIV_X0 - 4 && arr[i] < RIV_X1 + 4) i += dir;
  if (i < 0 || i >= arr.length) return null;
  return arr[i];
}

function wrapNPC(n) {
  const arr = n.axis === 'z' ? RZ : RX;
  n.along = n.dir > 0 ? arr[0] - 25 : arr[arr.length - 1] + 25;
  n.nextR = n.dir > 0 ? arr[0] : arr[arr.length - 1];
}

export function spawnNPC(n) {
  n.axis = Math.random() < 0.5 ? 'z' : 'x';
  n.dir = Math.random() < 0.5 ? 1 : -1;
  if (n.axis === 'z') {
    let idx = (Math.random() * RX.length) | 0;
    if (!validXIdx(idx)) idx = 6;
    n.ownIdx = idx;
    n.own = RX[idx];
  } else {
    n.ownIdx = BRIDGE_JS[(Math.random() * BRIDGE_JS.length) | 0];
    n.own = RZ[n.ownIdx];
  }
  n.lane = n.own + laneOffset(n.axis, n.dir);
  const arr = n.axis === 'z' ? RZ : RX;
  n.along = R(arr[0] + 14, arr[arr.length - 1] - 14);
  if (n.axis === 'x' && n.along > RIV_X0 && n.along < RIV_X1 && !BRIDGE_JS.includes(n.ownIdx)) n.along = RX[5];
  n.nextR = nextLineAfter(arr, n.along, n.dir, n.axis);
  if (n.nextR === null) wrapNPC(n);
  n.speed = n.cruise * 0.5;
  n.yaw = yawOf(n.axis, n.dir);
  n.hitTimer = 0;
  n.blocked = 0;
  n.active = true;
  n.veh.hp = n.veh.maxHp;
  n.veh.wrecked = false;
  n.veh.group.visible = true;
  syncNPC(n, 0);
}

function npcTurn(n, r) {
  const oldOwn = n.own;
  const f = n.axis === 'z' ? { x: 0, z: n.dir } : { x: n.dir, z: 0 };
  const opts = [{ x: f.z, z: -f.x }, { x: -f.z, z: f.x }];
  if (Math.random() < 0.5) opts.reverse();
  for (const c of opts) {
    const nAxis = Math.abs(c.x) > 0.5 ? 'x' : 'z';
    const nDir = nAxis === 'x' ? Math.sign(c.x) : Math.sign(c.z);
    if (nAxis === 'z' && !validXIdx(idxOfX(r))) continue;
    if (nAxis === 'x' && r > RIV_X0 - 4 && r < RIV_X1 + 4) continue;
    const nr = nextLineAfter(nAxis === 'x' ? RX : RZ, oldOwn, nDir, nAxis);
    if (nr === null) continue;
    n.axis = nAxis; n.dir = nDir; n.own = r;
    n.ownIdx = nAxis === 'x' ? idxOfX(r) : idxOfZ(r);
    n.lane = r + laneOffset(nAxis, nDir);
    n.along = oldOwn; n.nextR = nr; n.speed *= 0.55;
    return true;
  }
  return false;
}

function syncNPC(n, dt) {
  const g = n.veh.group;
  const wx = n.axis === 'z' ? n.lane : n.along;
  const wz = n.axis === 'z' ? n.along : n.lane;
  const wy = bridgeDeckY(wx, wz);
  g.position.set(wx, wy, wz);
  n.yaw = lerpAngle(n.yaw, yawOf(n.axis, n.dir), 1 - Math.exp(-8 * Math.max(dt, 0.001)));
  g.rotation.y = n.yaw;
  const m = n.speed < 1 ? g.userData.tailMats.on : g.userData.tailMats.off;
  for (const t of g.userData.tails) t.material = m;
  for (const w of g.userData.wheels) w.rotation.x += (n.speed * dt) / 0.42;
  if (g.userData.rider) g.userData.rider.visible = true;
}

export function updateTraffic(dt, tlState) {
  for (const n of npcs) {
    if (!n.active) continue;
    if (n.veh.wrecked) { n.speed = 0; continue; }
    if (n.hitTimer > 0) { n.hitTimer -= dt; n.speed = 0; syncNPC(n, dt); continue; }
    let vT = n.cruise;
    const parity = (n.axis === 'z' ? (n.ownIdx + idxOfZ(n.nextR)) : (idxOfX(n.nextR) + n.ownIdx)) % 2;
    const st = tlState(game.simTime, parity);
    const mine = n.axis === 'z' ? st[0] : st[1];
    const dL = (n.nextR - n.dir * (ROADW / 2 + 2.3) - n.along) * n.dir;
    if (dL > 0 && dL < 44 && (mine === 'r' || (mine === 'y' && dL > 10))) {
      vT = Math.min(vT, Math.sqrt(2 * 14 * Math.max(dL - 1.4, 0)));
    }
    let gap = 99, lead = 0;
    for (const o of npcs) {
      if (o === n || !o.active || o.axis !== n.axis || o.dir !== n.dir) continue;
      if (Math.abs(o.lane - n.lane) > 1.5) continue;
      const d = (o.along - n.along) * n.dir;
      if (d > 0 && d < gap) { gap = d; lead = o.speed; }
    }
    if (gap < 26) vT = Math.min(vT, Math.max(0, lead * 0.85 + (gap - 5) * 1.4));
    if (!game.inInterior) {
      const lat = n.axis === 'z' ? player.pos.x - n.lane : player.pos.z - n.lane;
      const lng = (n.axis === 'z' ? player.pos.z - n.along : player.pos.x - n.along) * n.dir;
      if (Math.abs(lat) < 2.4 && lng > 0 && lng < 18) {
        vT = Math.min(vT, Math.max(0, (lng - 5) * 1.4));
        n.blocked += dt;
        if (n.blocked > 2.5 && lng < 9) { n.blocked = -6; horn(660); }
      } else n.blocked = 0;
    }
    n.speed += clamp(vT - n.speed, -30 * dt, 8 * dt);
    if (n.speed < 0) n.speed = 0;
    n.along += n.dir * n.speed * dt;
    if ((n.along - n.nextR) * n.dir >= 0) {
      const r = n.nextR;
      const turned = Math.random() < 0.32 && npcTurn(n, r);
      if (!turned) {
        const arr = n.axis === 'z' ? RZ : RX;
        const nx = nextLineAfter(arr, r, n.dir, n.axis);
        if (nx === null) wrapNPC(n);
        else n.nextR = nx;
      }
    }
    syncNPC(n, dt);
  }

  // Update patrolling boats on River & Sea
  for (const b of npcBoats) {
    if (!b.active || b.veh === player.veh) continue;
    b.z += b.dir * b.speed * dt;
    if (b.z > 390) b.dir = -1;
    if (b.z < -390) b.dir = 1;
    b.veh.group.position.set(b.x, -0.85 + Math.sin(game.simTime * 2.5 + b.x) * 0.08, b.z);
    b.veh.group.rotation.y = b.dir > 0 ? 0 : Math.PI;
    if (Math.random() < 0.35) {
      spawnPuff(b.x, -0.5, b.z - b.dir * 3.1, R(-0.6, 0.6), 0.7, R(-0.6, 0.6), 2.8, 0.5, 0.85, 0.94, 1);
    }
  }
}

// --- Police / Interceptor / SWAT (5-Star Escalation) ---
export const cops = [];
for (let i = 0; i < 7; i++) {
  const kind = i >= 5 ? 'swat' : i >= 3 ? 'interceptor' : 'cop';
  const color = kind === 'swat' ? 0x111827 : kind === 'interceptor' ? 0x0f172a : 0xf4f6f8;
  const v = makeVehicle(scene, color, kind);
  v.group.visible = false;
  cops.push({ veh: v, kind, active: false, heading: 0, speed: 0, bust: 0, fireCd: R(0.6, 1.8), hp: VTYPES[kind].hp });
}
const copMatR = new THREE.MeshBasicMaterial({ color: 0xff2222, toneMapped: false });
const copMatB = new THREE.MeshBasicMaterial({ color: 0x2266ff, toneMapped: false });

export function roadPoint(minD, maxD) {
  for (let k = 0; k < 30; k++) {
    let x, z;
    if (Math.random() < 0.5) {
      let ix = pick(RX);
      if (ix > RIV_X0 - 4 && ix < RIV_X1 + 4) ix = RX[6];
      x = ix + (Math.random() < 0.5 ? LANE_OFF : -LANE_OFF);
      z = R(-400, 400);
    } else {
      z = RZ[BRIDGE_JS[(Math.random() * BRIDGE_JS.length) | 0]];
      x = R(-480, 480);
    }
    if (inWaterAt(x, z)) continue;
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d > (minD || 0) && d < (maxD || 1e9)) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(RX[6], 0, RZ[5]);
}

export function spawnExplosion(x, y, z, radius = 12, dmg = 160) {
  explosionSound();
  game.shake = Math.max(game.shake, 0.9);
  for (let i = 0; i < 26; i++) {
    const isFire = i < 14;
    spawnPuff(
      x + R(-1.5, 1.5), y + R(0.2, 2.0), z + R(-1.5, 1.5),
      R(-7, 7), R(3, 12), R(-7, 7),
      R(5, 11), R(0.4, 0.95),
      isFire ? 1 : 0.35, isFire ? R(0.3, 0.65) : 0.35, isFire ? 0.1 : 0.38
    );
  }
  spawnDebris(x, y + 1, z, 0x334155, 10);

  for (const c of cops) {
    if (!c.active) continue;
    const d = Math.hypot(c.veh.group.position.x - x, c.veh.group.position.z - z);
    if (d < radius) {
      const f = 1 - d / radius;
      c.hp -= dmg * f;
      dentVehicle(c.veh, TP.set(x, 1, z), 0.7);
      if (c.hp <= 0) {
        c.active = false;
        c.veh.group.visible = false;
        game.money += 120;
        hooks.addWanted(1.0);
        hooks.toast('COP UNIT DESTROYED +$120');
      }
    }
  }
  for (const n of npcs) {
    if (!n.active) continue;
    const g = n.veh.group;
    const d = Math.hypot(g.position.x - x, g.position.z - z);
    if (d < radius) {
      n.hitTimer = 4;
      n.veh.wrecked = true;
      dentVehicle(n.veh, TP.set(x, 1, z), 0.9);
      hooks.addWanted(0.6);
    }
  }
  for (const p of peds) {
    if (p.hit) continue;
    const sx = p.strip.axis === 'x' ? p.t : p.strip.c;
    const sz = p.strip.axis === 'x' ? p.strip.c : p.t;
    if (Math.hypot(sx - x, sz - z) < radius) {
      p.hit = true; p.hitT = 2.6; p.vy = 9;
      p.vx = (sx - x) * 1.5; p.vz = (sz - z) * 1.5;
      hooks.addWanted(0.8);
    }
  }
  const dp = Math.hypot(player.pos.x - x, player.pos.z - z);
  if (dp < radius) {
    hooks.damage(Math.round((1 - dp / radius) * 55));
  }
}

export function updateCops(dt, onCopShoot) {
  const w = Math.floor(game.wanted);
  const wantNormal = (w >= 1 && !game.inInterior) ? Math.min(1 + w, 3) : 0;
  const wantInt = (w >= 3 && !game.inInterior) ? Math.min(w - 2, 2) : 0;
  const wantSwat = (w >= 4 && !game.inInterior) ? Math.min(w - 3, 2) : 0;

  const managePool = (kind, desired) => {
    const pool = cops.filter(c => c.kind === kind);
    let act = pool.filter(c => c.active).length;
    if (act < desired) {
      const c = pool.find(u => !u.active);
      if (c) {
        c.active = true;
        c.veh.group.visible = true;
        c.hp = VTYPES[kind].hp;
        const p = roadPoint(75, 165);
        c.heading = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
        c.veh.group.position.set(p.x, bridgeDeckY(p.x, p.z), p.z);
        c.speed = 12;
        c.bust = 0;
      }
    } else if (act > desired) {
      const c = pool.filter(u => u.active).pop();
      if (c) { c.active = false; c.veh.group.visible = false; }
    }
  };
  managePool('cop', wantNormal);
  managePool('interceptor', wantInt);
  managePool('swat', wantSwat);

  if (game.inInterior) return;
  const flash = Math.floor(game.simTime * 7) % 2;

  for (const c of cops) {
    if (!c.active) continue;
    const g = c.veh.group;
    const T = VTYPES[c.kind];
    const dx = player.pos.x - g.position.x;
    const dz = player.pos.z - g.position.z;
    const dist = Math.hypot(dx, dz) || 0.01;
    const des = Math.atan2(dx, dz);
    const diff = ((des - c.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    c.heading += clamp(diff, -1, 1) * T.turn * dt * (0.45 + Math.min(1, c.speed / 12));

    const maxChase = T.max * (0.45 + w * 0.09);
    const targetSpd = dist > 16 ? maxChase : (dist > 6 ? 9 : 2);
    c.speed += clamp(targetSpd - c.speed, -26 * dt, 16 * dt);
    g.position.x += Math.sin(c.heading) * c.speed * dt;
    g.position.z += Math.cos(c.heading) * c.speed * dt;
    if (inWaterAt(g.position.x, g.position.z)) c.speed *= 0.45;
    collideSolidsAt(g.position, T.r, () => { c.speed *= 0.4; });
    g.position.y = Math.max(0, bridgeDeckY(g.position.x, g.position.z));
    g.rotation.y = c.heading;

    for (const wh of g.userData.wheels) wh.rotation.x += (c.speed * dt) / 0.42;
    if (g.userData.lightbar) {
      g.userData.lightbar[0].material = flash ? copMatR : copMatB;
      g.userData.lightbar[1].material = flash ? copMatB : copMatR;
    }

    // Cops open fire from ★2+ when within 42m
    if (w >= 2 && dist < 44) {
      c.fireCd -= dt;
      if (c.fireCd <= 0) {
        c.fireCd = c.kind === 'swat' ? R(0.35, 0.65) : R(0.9, 1.7);
        if (onCopShoot) onCopShoot(g.position, c.kind === 'swat' ? 12 : 7);
      }
    }

    const pd = game.onFoot ? 1.5 : (player.veh ? VTYPES[player.veh.group.userData.type].r + T.r : 3);
    if (dist < pd + 0.5) {
      const nx = dx / dist, nz = dz / dist;
      player.pos.x += nx * 0.45; player.pos.z += nz * 0.45;
      player.vel.x += nx * 6; player.vel.z += nz * 6;
      hooks.damage(c.kind === 'swat' ? 8 : 5);
      crashSound(0.65);
      spawnDebris(g.position.x + nx, 1, g.position.z + nz, 0xf4f6f8, 2);
    }
    if (dist < 5.5 && player.speed < 2.8 && !game.onFoot) c.bust += dt;
    else c.bust = Math.max(0, c.bust - dt * 2);
    if (c.bust > 2.8) { hooks.busted(); c.bust = 0; }
  }
}

// --- Pedestrians ---
const pedStrips = [];
for (const b of blocks) {
  if (b.type === 'water') continue;
  const t = 2.4;
  pedStrips.push({ axis: 'x', c: b.minZ + t, a: b.minX + 3, b2: b.maxX - 3 });
  pedStrips.push({ axis: 'x', c: b.maxZ - t, a: b.minX + 3, b2: b.maxX - 3 });
  pedStrips.push({ axis: 'z', c: b.minX + t, a: b.minZ + 3, b2: b.maxZ - 3 });
  pedStrips.push({ axis: 'z', c: b.maxX - t, a: b.minZ + 3, b2: b.maxZ - 3 });
}

const NP = CFG.N_PED;
const legGeo = new THREE.BoxGeometry(0.17, 0.5, 0.17); legGeo.translate(0, -0.19, 0);
const armGeo = new THREE.BoxGeometry(0.14, 0.62, 0.14); armGeo.translate(0, -0.25, 0);
const limbMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
const pedBodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.27, 0.62, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), NP);
const pedHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.21, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), NP);
const pedLegL = new THREE.InstancedMesh(legGeo, limbMat, NP);
const pedLegR = new THREE.InstancedMesh(legGeo, limbMat, NP);
const pedArmL = new THREE.InstancedMesh(armGeo, limbMat, NP);
const pedArmR = new THREE.InstancedMesh(armGeo, limbMat, NP);
pedBodies.castShadow = true;
[pedBodies, pedHeads, pedLegL, pedLegR, pedArmL, pedArmR].forEach(m => { m.frustumCulled = false; });
scene.add(pedBodies, pedHeads, pedLegL, pedLegR, pedArmL, pedArmR);

export const peds = [];
const SHIRTS = [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981, 0x8b5cf6, 0xf97316, 0xe2e8f0, 0xec4899];
const SKINS = [0xf1c9a5, 0xd9a066, 0x8d5524, 0xffdbac];

export function assignPed(p) {
  const s = pedStrips[(Math.random() * pedStrips.length) | 0];
  p.strip = s; p.t = R(s.a, s.b2); p.dir = Math.random() < 0.5 ? 1 : -1;
  p.spd = R(1.1, 2.2); p.phase = Math.random() * 9;
  p.hit = false; p.hitT = 0; p.vy = 0; p.vx = 0; p.vz = 0; p.y = 0; p.walk = 0;
}

{
  const C = new THREE.Color();
  for (let i = 0; i < NP; i++) {
    const p = {};
    assignPed(p);
    peds.push(p);
    pedBodies.setColorAt(i, C.set(SHIRTS[i % SHIRTS.length]));
    pedHeads.setColorAt(i, C.set(SKINS[i % SKINS.length]));
    pedLegL.setColorAt(i, C.set(0x1e293b));
    pedLegR.setColorAt(i, C.set(0x1e293b));
    pedArmL.setColorAt(i, C.set(SHIRTS[i % SHIRTS.length]));
    pedArmR.setColorAt(i, C.set(SHIRTS[i % SHIRTS.length]));
  }
  [pedBodies, pedHeads, pedLegL, pedLegR, pedArmL, pedArmR].forEach(m => {
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
}

const pedM = new THREE.Matrix4(), pedQ = new THREE.Quaternion(), pedP = new THREE.Vector3(), pedE = new THREE.Euler(), pedS = new THREE.Vector3(1, 1, 1);
function setLimb(mesh, i, x, y, z, swing) {
  pedE.set(swing, 0, 0);
  pedQ.setFromEuler(pedE);
  pedM.compose(pedP.set(x, y, z), pedQ, pedS);
  mesh.setMatrixAt(i, pedM);
}

export function updatePeds(dt) {
  const px = player.pos.x, pz = player.pos.z;
  const pSpd = game.onFoot ? 0 : Math.hypot(player.vel.x, player.vel.z);
  for (let i = 0; i < NP; i++) {
    const p = peds[i];
    let x, z;
    if (p.hit) {
      p.hitT -= dt; p.vy -= 22 * dt; p.y += p.vy * dt; p.t += p.vx * dt;
      x = p.strip.axis === 'x' ? p.t : p.strip.c;
      z = p.strip.axis === 'x' ? p.strip.c : p.t;
      if (p.hitT <= 0) assignPed(p);
    } else {
      let spd = p.spd;
      const sx = p.strip.axis === 'x' ? p.t : p.strip.c;
      const sz = p.strip.axis === 'x' ? p.strip.c : p.t;
      const d2 = (sx - px) * (sx - px) + (sz - pz) * (sz - pz);
      if (d2 < 45 && (pSpd > 9 || game.wanted >= 1)) spd *= 2.8;
      p.t += spd * dt * p.dir;
      p.walk += spd * dt * 4;
      if (p.t < p.strip.a) { p.t = p.strip.a; p.dir = 1; }
      if (p.t > p.strip.b2) { p.t = p.strip.b2; p.dir = -1; }
      x = p.strip.axis === 'x' ? p.t : p.strip.c;
      z = p.strip.axis === 'x' ? p.strip.c : p.t;
      p.y = 0;
      if (pSpd > 5 && game.state === 'playing' && !game.onFoot && !game.inInterior) {
        if ((x - px) * (x - px) + (z - pz) * (z - pz) < 2.9) {
          p.hit = true; p.hitT = 2.4; p.vy = 7;
          p.vx = player.vel.x * 0.5 + R(-2, 2);
          p.vz = player.vel.z * 0.5 + R(-2, 2);
          game.money += 12;
          hooks.addWanted(1.2);
          crashSound(0.5);
          hooks.flash();
        }
      }
    }
    const bob = p.hit ? 0 : Math.abs(Math.sin(p.walk * 2 + p.phase)) * 0.05;
    const yaw = p.strip.axis === 'x' ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
    const sw = p.hit ? 0 : Math.sin(p.walk * 2) * 0.6;
    pedE.set(p.hit ? p.hitT * 6 : 0, yaw, p.hit ? p.hitT * 4 : 0);
    pedQ.setFromEuler(pedE);
    pedM.compose(pedP.set(x, 0.93 + bob + p.y, z), pedQ, pedS); pedBodies.setMatrixAt(i, pedM);
    pedM.compose(pedP.set(x, 1.52 + bob + p.y, z), pedQ, pedS); pedHeads.setMatrixAt(i, pedM);
    setLimb(pedLegL, i, x - 0.15, 0.80 + p.y, z, sw);
    setLimb(pedLegR, i, x + 0.15, 0.80 + p.y, z, -sw);
    setLimb(pedArmL, i, x - 0.34, 1.42 + p.y, z, -sw * 0.8);
    setLimb(pedArmR, i, x + 0.34, 1.42 + p.y, z, sw * 0.8);
  }
  [pedBodies, pedHeads, pedLegL, pedLegR, pedArmL, pedArmR].forEach(m => { m.instanceMatrix.needsUpdate = true; });
}

export function updateVendors() {
  for (const rec of interiorCache.values()) {
    if (rec.vendor) {
      rec.vendor.position.y = Math.abs(Math.sin(game.simTime * 2)) * 0.05;
      rec.vendor.rotation.y = Math.sin(game.simTime * 0.7) * 0.4;
    }
  }
}
