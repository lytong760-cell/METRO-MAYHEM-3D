import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CELL, NX, NZ, ROADW, SIDEW, CURB, RX, RZ, EXT_X, EXT_Z,
  RIVER_I, BRIDGE_JS, RIV_X0, RIV_X1, SEA_X, ISLAND,
  SHOPS, IS_MOBILE, game, player, clamp, lerp, mulberry32, rnd, R, pick,
  TP, TQ, TE, TS, TC, TM, districtGridOf
} from './state.js';
import {
  setMaxAnisotropy, glowTex, asphaltTex, concreteTex, buildingTexture, waterRippleTex
} from './textures.js';
import { vehicles, makeVehicle, headSpots, coneMat } from './vehicles.js';

export const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch (e) {
    return true;
  }
})();

const canvas = document.getElementById('game');
export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isSoftwareGl,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !isSoftwareGl;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8bc8f8);
export const worldFog = new THREE.Fog(0x8bc8f8, 85, 820);
scene.fog = worldFog;

// Studio PBR environment reflections via RoomEnvironment
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

export const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3400);
scene.add(camera);
camera.position.set(0, 150, 260);

// Balanced 3-light outdoor rig
export const hemi = new THREE.HemisphereLight(0xcbe6ff, 0x3b443b, 0.82);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff8eb, 1.25);
sun.castShadow = !isSoftwareGl;
sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -165, right: 165, top: 165, bottom: -165, near: 20, far: 1000 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

export const moon = new THREE.DirectionalLight(0x8aa2ff, 0);
scene.add(moon);
export const boltLight = new THREE.DirectionalLight(0xe0ecff, 0);
scene.add(boltLight);

// Stars
let starMat;
{
  const n = 900;
  const p = new Float32Array(n * 3);
  const g = new THREE.BufferGeometry();
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.85);
    p[i * 3] = Math.sin(ph) * Math.cos(th) * 1500;
    p[i * 3 + 1] = Math.cos(ph) * 1500 + 40;
    p[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 1500;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  starMat = new THREE.PointsMaterial({ color: 0xdbe6ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  scene.add(new THREE.Points(g, starMat));
}

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,224,132,1)'), toneMapped: false, depthWrite: false }));
sunSprite.scale.set(180, 180, 1);
scene.add(sunSprite);
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(210,224,255,1)'), toneMapped: false, depthWrite: false, transparent: true, opacity: 0 }));
moonSprite.scale.set(95, 95, 1);
scene.add(moonSprite);

const clouds = [];
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
{
  const cg = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 18; i++) {
    const c = new THREE.Mesh(cg, cloudMat);
    c.scale.set(R(20, 42), R(5, 9), R(14, 26));
    c.position.set(R(-1000, 1000), R(135, 200), R(-800, 800));
    c.userData.v = R(1.4, 3.8);
    scene.add(c);
    clouds.push(c);
  }
}

export const flashLight = new THREE.SpotLight(0xfff3d8, 0, 40, 0.55, 0.5, 1.1);
camera.add(flashLight);
flashLight.position.set(0.25, -0.25, 0.1);
const flashTgt = new THREE.Object3D();
flashTgt.position.set(0, -0.4, -14);
camera.add(flashTgt);
flashLight.target = flashTgt;

// First-person hands + gun
export const hands = new THREE.Group();
{
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.8 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.48), sleeve);
  hl.position.set(-0.44, -0.5, -0.78);
  hl.rotation.y = 0.18;
  const hr = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.48), skin);
  hr.position.set(0.42, -0.48, -0.78);
  hr.rotation.y = -0.18;
  const cig = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.2), new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }));
  cig.position.set(0.44, -0.4, -0.98);
  cig.name = 'cig';
  const fpGun = new THREE.Group();
  fpGun.name = 'fpGun';
  const gb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.48), new THREE.MeshStandardMaterial({ color: 0x1e242c, roughness: 0.4, metalness: 0.7 }));
  gb.position.set(0.32, -0.34, -0.82);
  const gbr = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.9 }));
  gbr.rotation.x = Math.PI / 2;
  gbr.position.set(0.32, -0.31, -1.04);
  fpGun.add(gb, gbr);
  fpGun.visible = false;
  hands.add(hl, hr, cig, fpGun);
}
hands.visible = false;
camera.add(hands);

// Postprocessing on GPU; direct render on software WebGL
export let composer = null;
export let bloomPass = null;
if (!isSoftwareGl) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.55, 0.72);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

export function bridgeDeckY(x, z) {
  if (x < RIV_X0 - 24 || x > RIV_X1 + 24) return 0;
  for (const bj of BRIDGE_JS) {
    if (Math.abs(z - RZ[bj]) < ROADW / 2 + 1) {
      if (x >= RIV_X0 && x <= RIV_X1) return 2.8;
      if (x < RIV_X0) return lerp(0, 2.8, clamp((x - (RIV_X0 - 24)) / 24, 0, 1));
      return lerp(2.8, 0, clamp((x - RIV_X1) / 24, 0, 1));
    }
  }
  return 0;
}

export function onBridge(z) {
  for (const bj of BRIDGE_JS) {
    if (Math.abs(z - RZ[bj]) < ROADW / 2 + 1.5) return true;
  }
  return false;
}

export function terrainH(x, z) {
  // Island in sea
  const dIsl = Math.hypot(x - ISLAND.x, z - ISLAND.z);
  if (dIsl < ISLAND.r + 14) {
    const t = clamp(1 - dIsl / (ISLAND.r + 14), 0, 1);
    return -3.2 + t * 14.5 + Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.9 * t;
  }
  if (x > RIV_X0 - 6 && x < RIV_X1 + 6 && Math.abs(z) < EXT_Z / 2 + 320) return -3.2;
  if (x > SEA_X) return -3.4;
  const inCity = Math.abs(x) < EXT_X / 2 + 24 && Math.abs(z) < EXT_Z / 2 + 24;
  if (inCity) return -0.12;
  const d = Math.max(Math.abs(x), Math.abs(z));
  const edge = Math.max(EXT_X, EXT_Z) / 2 + 45;
  const t = Math.max(0, d - edge);
  const mask = clamp(t / 70, 0, 1);
  const hills = (Math.sin(x * 0.013) + Math.cos(z * 0.011)) * 3.8 + Math.sin(x * 0.031 + z * 0.017) * 2.4;
  const mount = Math.pow(clamp(t / 300, 0, 1), 1.55) * 120 * (0.65 + 0.35 * Math.sin(x * 0.008 + z * 0.006));
  return hills * mask * clamp(t / 150, 0, 1) + mount - 0.12;
}

export function inWaterAt(x, z, ignoreBridges = false) {
  if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r - 4) return false;
  if (x > RIV_X0 + 1.5 && x < RIV_X1 - 1.5) {
    if (ignoreBridges) return true;
    return !onBridge(z);
  }
  if (x > SEA_X + 5) return true;
  return false;
}

export function groundYAt(x, z) {
  if (game.inInterior) return game.inInterior.oy;
  const isBoat = player.veh && player.veh.group.userData.type === 'boat' && !game.onFoot;
  if (isBoat && inWaterAt(x, z, true)) return -0.85;
  if (x > RIV_X0 - 24 && x < RIV_X1 + 24 && onBridge(z)) {
    return bridgeDeckY(x, z);
  }
  if (inWaterAt(x, z)) return -0.55;
  if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r) {
    return Math.max(-0.5, terrainH(x, z));
  }
  if (Math.abs(x) < EXT_X / 2 && Math.abs(z) < EXT_Z / 2) {
    for (const b of blocks) {
      if (b.type !== 'water' && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return CURB;
    }
    return 0;
  }
  return Math.max(-0.5, terrainH(x, z));
}

// Animated PBR Water shader extension
const waterTex = waterRippleTex();
const waterUniforms = { uTime: { value: 0 } };
const waterMat = new THREE.MeshStandardMaterial({
  map: waterTex,
  roughness: 0.14,
  metalness: 0.35,
  color: 0x38bdf8,
  envMapIntensity: 1.25
});
waterMat.onBeforeCompile = shader => {
  shader.uniforms.uTime = waterUniforms.uTime;
  shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     transformed.z += sin(transformed.x * 0.07 + uTime * 1.8) * 0.16 + cos(transformed.y * 0.06 + uTime * 1.4) * 0.12;`
  );
};

// Terrain Mesh
{
  const g = new THREE.PlaneGeometry(3600, 2800, IS_MOBILE ? 120 : 190, IS_MOBILE ? 95 : 155);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainH(x, z);
    pos.setY(i, h);
    const dIsl = Math.hypot(x - ISLAND.x, z - ISLAND.z);
    if (dIsl < ISLAND.r + 8 && h >= -1.0 && h < 1.3) {
      c.set(0xe7d49e); // sandy island shore
    } else if (h < -1) {
      c.set(0x2d4f43);
    } else if (h < 2.2) {
      c.setHSL(0.30, 0.45, 0.28);
    } else if (h < 28) {
      c.setHSL(0.28, 0.38, 0.29).lerp(new THREE.Color(0x6b7268), clamp((h - 2) / 26, 0, 1));
    } else {
      c.setHSL(0, 0, clamp(0.58 + (h - 28) / 60, 0.58, 0.94));
    }
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const terr = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  terr.receiveShadow = true;
  scene.add(terr);
}

const riverWater = new THREE.Mesh(new THREE.PlaneGeometry(RIV_X1 - RIV_X0, 2800, 12, 64), waterMat);
riverWater.rotation.x = -Math.PI / 2;
riverWater.position.set((RIV_X0 + RIV_X1) / 2, -0.85, 0);
scene.add(riverWater);

const seaWater = new THREE.Mesh(new THREE.PlaneGeometry(1400, 2800, 48, 72), waterMat);
seaWater.rotation.x = -Math.PI / 2;
seaWater.position.set(SEA_X + 700, -0.9, 0);
scene.add(seaWater);

function makeInstanced(geo, mat, items, shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  im.count = items.length;
  items.forEach((it, i) => {
    TP.set(it.p[0], it.p[1], it.p[2]);
    TE.set(0, it.ry || 0, 0);
    TS.set(it.s ? it.s[0] : 1, it.s ? it.s[1] : 1, it.s ? it.s[2] : 1);
    TM.compose(TP, TQ.setFromEuler(TE), TS);
    im.setMatrixAt(i, TM);
    if (it.c) im.setColorAt(i, TC.set(it.c));
  });
  im.castShadow = shadow;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  scene.add(im);
  return im;
}

// Surrounding mountain forest
{
  const trunks = [];
  const crowns = [];
  for (let i = 0; i < 1050; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(EXT_X, EXT_Z) / 2 + 55 + Math.random() * 750;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.8;
    const h = terrainH(x, z);
    if (h < 0.3 || h > 44) continue;
    if (Math.sin(x * 0.02) + Math.cos(z * 0.023) < -0.5) continue;
    const s = R(0.85, 1.95);
    const pine = Math.random() < 0.55;
    trunks.push({ p: [x, h + 0.8 * s, z], s: [s, s, s] });
    crowns.push({
      p: [x, h + (pine ? 2.6 : 2.4) * s, z],
      s: [s * (pine ? 0.9 : 1.5), s * (pine ? 2.2 : 1.5), s * (pine ? 0.9 : 1.5)],
      c: new THREE.Color().setHSL(pine ? R(0.33, 0.4) : R(0.24, 0.34), R(0.45, 0.7), R(0.24, 0.4)).getHex()
    });
  }
  makeInstanced(new THREE.CylinderGeometry(0.16, 0.24, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0x5d4126, roughness: 1 }), trunks);
  makeInstanced(new THREE.IcosahedronGeometry(1.15, 0), new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), crowns);
}

export const world = new THREE.Group();
scene.add(world);
export const blocks = [];
export const solids = [];
export const parks = [];
export const doorDefs = [];
export const bldSideMats = [];
export let roadMatV;

// Roads with procedural asphalt texture
roadMatV = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.88, metalness: 0.06 });
for (const rx of RX) {
  if (rx > RIV_X0 && rx < RIV_X1) continue;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ROADW, EXT_Z + 40), roadMatV);
  m.rotation.x = -Math.PI / 2;
  m.position.set(rx, 0, 0);
  m.receiveShadow = true;
  world.add(m);
}
for (let j = 0; j < RZ.length; j++) {
  const rz = RZ[j];
  const isBr = BRIDGE_JS.includes(j);
  if (isBr) {
    // West & East flat segments + raised river bridge
    const wLen = RIV_X0 - 24 - (-EXT_X / 2 - 15);
    const mW = new THREE.Mesh(new THREE.PlaneGeometry(wLen, ROADW), roadMatV);
    mW.rotation.x = -Math.PI / 2;
    mW.position.set((-EXT_X / 2 - 15 + RIV_X0 - 24) / 2, 0.012, rz);
    mW.receiveShadow = true;
    world.add(mW);

    const eEnd = EXT_X / 2 + 15;
    const eLen = eEnd - (RIV_X1 + 24);
    const mE = new THREE.Mesh(new THREE.PlaneGeometry(eLen, ROADW), roadMatV);
    mE.rotation.x = -Math.PI / 2;
    mE.position.set((RIV_X1 + 24 + eEnd) / 2, 0.012, rz);
    mE.receiveShadow = true;
    world.add(mE);

    // Bridge deck & ramps
    const span = RIV_X1 - RIV_X0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.45, ROADW), roadMatV);
    deck.position.set((RIV_X0 + RIV_X1) / 2, 2.58, rz);
    deck.castShadow = deck.receiveShadow = true;
    world.add(deck);

    const rampLen = Math.hypot(24, 2.8);
    const rampAng = Math.atan2(2.8, 24);
    const rW = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.4, ROADW), roadMatV);
    rW.position.set(RIV_X0 - 12, 1.22, rz);
    rW.rotation.z = rampAng;
    const rE = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.4, ROADW), roadMatV);
    rE.position.set(RIV_X1 + 12, 1.22, rz);
    rE.rotation.z = -rampAng;
    rW.receiveShadow = rE.receiveShadow = true;
    world.add(rW, rE);
  } else {
    // Non-bridge street stops cleanly at riverbanks
    const wStart = -EXT_X / 2 - 15;
    const wLen = RIV_X0 - wStart;
    const mW = new THREE.Mesh(new THREE.PlaneGeometry(wLen, ROADW), roadMatV);
    mW.rotation.x = -Math.PI / 2;
    mW.position.set((wStart + RIV_X0) / 2, 0.012, rz);
    mW.receiveShadow = true;
    world.add(mW);

    const eEnd = EXT_X / 2 + 15;
    const eLen = eEnd - RIV_X1;
    const mE = new THREE.Mesh(new THREE.PlaneGeometry(eLen, ROADW), roadMatV);
    mE.rotation.x = -Math.PI / 2;
    mE.position.set((RIV_X1 + eEnd) / 2, 0.012, rz);
    mE.receiveShadow = true;
    world.add(mE);
  }
}

// Bridge railings & underwater support pylons
{
  const rails = [];
  for (const bj of BRIDGE_JS) {
    const rz = RZ[bj];
    for (const s of [-1, 1]) {
      for (let x = RIV_X0; x <= RIV_X1; x += 5) {
        rails.push({ p: [x, 3.25, rz + s * (ROADW / 2 - 0.35)], s: [4.8, 0.75, 0.3] });
      }
    }
    for (let x = RIV_X0 + 8; x <= RIV_X1 - 8; x += 22) {
      rails.push({ p: [x, 0.4, rz + ROADW / 2 - 1.2], s: [1.4, 4.4, 1.4] });
      rails.push({ p: [x, 0.4, rz - ROADW / 2 + 1.2], s: [1.4, 4.4, 1.4] });
    }
  }
  makeInstanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.55, metalness: 0.3 }), rails);
}

// District block allocation
for (let i = 0; i < NX; i++) {
  for (let j = 0; j < NZ; j++) {
    const minX = RX[i] + ROADW / 2;
    const maxX = RX[i + 1] - ROADW / 2;
    const minZ = RZ[j] + ROADW / 2;
    const maxZ = RZ[j + 1] - ROADW / 2;
    const dist = districtGridOf(i, j);
    let type = 'city';
    if (dist === 'river') {
      type = 'water';
    } else if (dist === 'beach') {
      type = 'beach';
    } else if (dist === 'suburbs') {
      type = rnd() < 0.16 ? 'park' : 'suburbs';
    } else if (dist === 'industrial') {
      type = rnd() < 0.08 ? 'plaza' : 'industrial';
    } else if (dist === 'seaport') {
      type = rnd() < 0.1 ? 'plaza' : 'seaport';
    } else {
      // Downtown
      if (i === 6 && j === 5) type = 'plaza';
      else type = rnd() < 0.12 ? 'park' : (rnd() < 0.22 ? 'plaza' : 'downtown');
    }

    const b = { type, dist, i, j, minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
    blocks.push(b);
    if (type === 'park' || type === 'beach') parks.push(b);
    if (type !== 'water' && type !== 'park' && type !== 'plaza' && type !== 'beach') {
      solids.push({
        minX: minX + SIDEW, maxX: maxX - SIDEW,
        minZ: minZ + SIDEW, maxZ: maxZ - SIDEW,
        cx: b.cx, cz: b.cz,
        hw: (maxX - minX) / 2 - SIDEW, hd: (maxZ - minZ) / 2 - SIDEW
      });
    }
  }
}

// Sidewalks & district curbs
{
  const list = blocks.filter(b => b.type !== 'water');
  const conc = concreteTex();
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: conc, roughness: 0.92 }), list.length);
  im.count = list.length;
  list.forEach((b, i) => {
    TP.set(b.cx, CURB / 2, b.cz);
    TS.set(b.maxX - b.minX, CURB, b.maxZ - b.minZ);
    TM.compose(TP, TQ.identity(), TS);
    im.setMatrixAt(i, TM);
    const col = b.type === 'park' ? 0x4ca652
      : b.type === 'plaza' ? 0xd2d6dc
      : b.type === 'beach' ? 0xe5d399
      : b.type === 'industrial' ? 0x8d9299
      : b.type === 'seaport' ? 0x9aa3ad
      : b.type === 'suburbs' ? 0x769f62
      : 0xb6bbc3;
    TC.set(col);
    im.setColorAt(i, TC);
  });
  im.receiveShadow = true;
  im.castShadow = true;
  im.computeBoundingSphere();
  world.add(im);
}

// Buildings per district
const BLD_VARS = [
  { base: '#3b4e66', win: '#122236', lit: 0.55, style: 'glass' },      // 0: Downtown glass
  { base: '#6b7785', win: '#1d2836', lit: 0.48, style: 'glass' },      // 1: Modern steel tower
  { base: '#a36449', win: '#2a1d17', lit: 0.45, style: 'city' },       // 2: Brick midrise
  { base: '#d9d3c7', win: '#334155', lit: 0.50, style: 'suburb' },     // 3: Suburb house light
  { base: '#b89f82', win: '#293548', lit: 0.45, style: 'suburb' },     // 4: Suburb house warm
  { base: '#59636e', win: '#1e293b', lit: 0.32, style: 'industrial' }  // 5: Industrial warehouse
];
const roofMat = new THREE.MeshStandardMaterial({ color: 0x333942, roughness: 0.92 });
const suburbRoofMat = new THREE.MeshStandardMaterial({ color: 0x7c3f2c, roughness: 0.85 });
const bldLists = BLD_VARS.map(() => []);
const suburbRoofs = [];
const indStacks = [];
const indTanks = [];
const rooftopProps = [];
const harborContainers = [];

for (const b of blocks) {
  if (b.type === 'water' || b.type === 'park' || b.type === 'plaza' || b.type === 'beach') continue;
  const zx = b.minX + SIDEW;
  const zw = b.minZ + SIDEW;
  const ZW = b.maxX - b.minX - 2 * SIDEW;
  const ZD = b.maxZ - b.minZ - 2 * SIDEW;
  const lots = [];
  const rr = rnd();

  if (b.type === 'suburbs') {
    const w = (ZW - 5) / 2;
    const d = (ZD - 5) / 2;
    lots.push([zx + 1.5, zw + 1.5, w, d], [zx + 3.5 + w, zw + 1.5, w, d], [zx + 1.5, zw + 3.5 + d, w, d], [zx + 3.5 + w, zw + 3.5 + d, w, d]);
  } else if (b.type === 'industrial' || b.type === 'seaport') {
    if (rr < 0.55) lots.push([zx + 1.5, zw + 1.5, ZW - 3, ZD - 3]);
    else {
      const w = (ZW - 4) / 2;
      lots.push([zx + 1, zw + 1.5, w, ZD - 3], [zx + 3 + w, zw + 1.5, w, ZD - 3]);
    }
  } else {
    if (rr < 0.28) lots.push([zx + 1, zw + 1, ZW - 2, ZD - 2]);
    else if (rr < 0.62) {
      const w = (ZW - 3) / 2;
      lots.push([zx + 1, zw + 1, w, ZD - 2], [zx + 2 + w, zw + 1, w, ZD - 2]);
    } else {
      const w = (ZW - 3) / 2;
      const d = (ZD - 3) / 2;
      lots.push([zx + 1, zw + 1, w, d], [zx + 2 + w, zw + 1, w, d], [zx + 1, zw + 2 + d, w, d], [zx + 2 + w, zw + 2 + d, w, d]);
    }
  }

  for (let li = 0; li < lots.length; li++) {
    const [lx, lz, lw, ld] = lots[li];
    if (b.type === 'seaport' && li === 0 && rnd() < 0.45) {
      // Shipping container yard instead of tall building
      const contCols = [0xdc2626, 0x2563eb, 0xf59e0b, 0x16a34a, 0x0ea5e9];
      for (let cx = 0; cx < 3; cx++) {
        for (let cz = 0; cz < 2; cz++) {
          const st = 1 + ((rnd() * 3) | 0);
          const col = pick(contCols);
          for (let k = 0; k < st; k++) {
            harborContainers.push({
              p: [lx + 4 + cx * 7.5, CURB + 1.5 + k * 3.0, lz + 6 + cz * 14],
              s: [6.0, 2.9, 12.0],
              c: col
            });
          }
        }
      }
      continue;
    }

    let h;
    let varIdx = 0;
    if (b.type === 'suburbs') {
      h = R(5.4, 8.2);
      varIdx = rnd() < 0.5 ? 3 : 4;
    } else if (b.type === 'industrial' || b.type === 'seaport') {
      h = R(7.5, 13.5);
      varIdx = 5;
    } else {
      const dC = Math.hypot(b.cx - (-72), b.cz) / (EXT_X * 0.25);
      const boost = Math.exp(-dC * dC * 1.4);
      h = (4 + Math.floor(R(1, 6) + boost * R(6, 18))) * 3.2;
      varIdx = rnd() < 0.45 ? 0 : rnd() < 0.78 ? 1 : 2;
    }

    const bw = Math.max(9.5, lw - R(0.6, 2.4));
    const bd = Math.max(9.5, ld - R(0.6, 2.4));
    const bl = { x: lx + lw / 2, z: lz + ld / 2, w: bw, d: bd, h };
    bldLists[varIdx].push(bl);

    if (b.type === 'suburbs') {
      suburbRoofs.push({ p: [bl.x, CURB + h + 1.4, bl.z], s: [bw * 0.78, 2.8, bd * 0.78], ry: Math.PI / 4 });
    } else if (b.type === 'industrial') {
      if (rnd() < 0.65) indStacks.push({ p: [bl.x + bw * 0.28, CURB + h + 5, bl.z - bd * 0.22], s: [1.3, 10, 1.3] });
      if (rnd() < 0.5) indTanks.push({ p: [bl.x - bw * 0.25, CURB + 3.2, bl.z + bd * 0.2], s: [3.2, 6.4, 3.2] });
    } else if (h > 22) {
      rooftopProps.push({ p: [bl.x, CURB + h + 1.1, bl.z], s: [bw * 0.35, 2.2, bd * 0.35] });
      if (h > 42) rooftopProps.push({ p: [bl.x, CURB + h + 7, bl.z], s: [0.35, 11, 0.35] });
    }

    // Enterable doors facing perimeter sidewalk
    if (bl.w >= 10 && doorDefs.length < 180) {
      const nD = bl.z - bl.d / 2 - b.minZ;
      const sD = b.maxZ - (bl.z + bl.d / 2);
      const wD = bl.x - bl.w / 2 - b.minX;
      const eD = b.maxX - (bl.x + bl.w / 2);
      const m = Math.min(nD, sD, wD, eD);
      let dx = bl.x, dz = bl.z, ry = 0;
      if (m === nD) { dz = bl.z - bl.d / 2 - 0.9; ry = Math.PI; }
      else if (m === sD) { dz = bl.z + bl.d / 2 + 0.9; ry = 0; }
      else if (m === wD) { dx = bl.x - bl.w / 2 - 0.9; ry = Math.PI / 2; }
      else { dx = bl.x + bl.w / 2 + 0.9; ry = -Math.PI / 2; }
      const kind = b.type === 'suburbs' ? 'apt' : h < 16 ? 'store' : h < 32 ? 'office' : 'apt';
      doorDefs.push({ x: dx, z: dz, ry, w: bl.w, d: bl.d, h, seed: (doorDefs.length * 7919 + 13) | 0, kind });
    }
  }
}

BLD_VARS.forEach((v, vi) => {
  const tex = buildingTexture(v);
  const side = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: v.style === 'glass' ? 0.25 : 0.85,
    metalness: v.style === 'glass' ? 0.55 : 0.08
  });
  bldSideMats.push(side);
  const list = bldLists[vi];
  const im = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    [side, side, roofMat, roofMat, side, side],
    Math.max(1, list.length)
  );
  im.count = list.length;
  list.forEach((bl, i) => {
    TP.set(bl.x, CURB + bl.h / 2, bl.z);
    TS.set(bl.w, bl.h, bl.d);
    TM.compose(TP, TQ.identity(), TS);
    im.setMatrixAt(i, TM);
    TC.setHSL(R(0, 1), R(0.03, 0.16), R(0.76, 0.96));
    im.setColorAt(i, TC);
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  world.add(im);
});

makeInstanced(new THREE.ConeGeometry(0.92, 1, 4), suburbRoofMat, suburbRoofs);
makeInstanced(new THREE.CylinderGeometry(0.55, 0.85, 1, 10), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.4 }), indStacks);
makeInstanced(new THREE.CylinderGeometry(1, 1, 1, 14), new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.35, metalness: 0.75 }), indTanks);
makeInstanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.45 }), rooftopProps);
makeInstanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.35 }), harborContainers);

// Door frames on enterable buildings
{
  const fr = [];
  for (const d of doorDefs) fr.push({ p: [d.x, 1.5, d.z], ry: d.ry });
  makeInstanced(new THREE.BoxGeometry(1.9, 2.7, 0.3), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.45 }), fr);
}

// Road markings & crosswalks
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.75 });
{
  const dashes = [];
  const skipX = v => RX.some(r => Math.abs(v - r) < ROADW / 2 + 2);
  const skipZ = v => RZ.some(r => Math.abs(v - r) < ROADW / 2 + 2);
  for (const rx of RX) {
    if (rx > RIV_X0 && rx < RIV_X1) continue;
    for (let z = -EXT_Z / 2 + 3; z < EXT_Z / 2 - 3; z += 5) if (!skipZ(z)) dashes.push([rx, z, 0]);
  }
  for (let j = 0; j < RZ.length; j++) {
    const rz = RZ[j];
    for (let x = -EXT_X / 2 + 3; x < EXT_X / 2 - 3; x += 5) {
      if (x > RIV_X0 - 4 && x < RIV_X1 + 4) continue;
      if (!skipX(x)) dashes.push([x, rz, 1]);
    }
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.02, 2.6), stripeMat, dashes.length);
  dashes.forEach((d, i) => {
    TP.set(d[0], 0.03, d[1]);
    TE.set(0, d[2] ? Math.PI / 2 : 0, 0);
    TM.compose(TP, TQ.setFromEuler(TE), TS.set(1, 1, 1));
    im.setMatrixAt(i, TM);
  });
  im.computeBoundingSphere();
  world.add(im);
}

// Streetlights + neon signs
export let lampMat;
export const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
{
  const poles = [], heads = [];
  for (const ix of RX) {
    if (ix > RIV_X0 && ix < RIV_X1) continue;
    for (const iz of RZ) {
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          const x = ix + cx * (ROADW / 2 + 1.6);
          const z = iz + cz * (ROADW / 2 + 1.6);
          poles.push({ p: [x, 2.7, z] });
          heads.push({ p: [x - cx * 1.1, 5.35, z - cz * 1.1] });
        }
      }
    }
  }
  makeInstanced(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.7 }), poles);
  lampMat = new THREE.MeshBasicMaterial({ color: 0x332a1a, toneMapped: false });
  makeInstanced(new THREE.BoxGeometry(0.55, 0.22, 0.85), lampMat, heads);

  const signs = [];
  const PAL = [0xf59e0b, 0x0ea5e9, 0xef4444, 0x10b981, 0xf8fafc];
  for (const b of blocks) {
    if (b.type !== 'downtown') continue;
    const edges = [
      [b.cx, b.minZ + SIDEW - 0.1, 0],
      [b.cx, b.maxZ - SIDEW + 0.1, Math.PI],
      [b.minX + SIDEW - 0.1, b.cz, Math.PI / 2],
      [b.maxX - SIDEW + 0.1, b.cz, -Math.PI / 2]
    ];
    for (const ed of edges) {
      if (rnd() < 0.5) continue;
      const off = R(-14, 14);
      const px = Math.abs(ed[2]) === Math.PI / 2 ? ed[0] : ed[0] + off;
      const pz = Math.abs(ed[2]) === Math.PI / 2 ? ed[1] + off : ed[1];
      signs.push({ p: [px, R(5, 14), pz], ry: ed[2], c: pick(PAL), s: [R(0.9, 1.7), R(0.8, 1.5), 1] });
    }
  }
  makeInstanced(new THREE.PlaneGeometry(3.8, 1.4), neonMat, signs, false);
}

// Urban trees, parks, beach palms & Island palms
{
  const trunks = [], crowns = [];
  const addTree = (x, z, sc, palm, yBase = CURB) => {
    trunks.push({ p: [x, yBase + 0.85 * sc, z], s: [sc, sc, sc] });
    crowns.push({
      p: [x, yBase + (palm ? 2.5 : 2.7) * sc, z],
      s: [sc * (palm ? 1.85 : 1.55), sc * (palm ? 0.7 : 1.55), sc * (palm ? 1.85 : 1.55)],
      c: new THREE.Color().setHSL(palm ? 0.33 : R(0.24, 0.35), R(0.45, 0.7), R(0.28, 0.45)).getHex()
    });
  };
  for (const p of parks) {
    const n = (p.type === 'park' ? 8 : 6) + ((rnd() * 5) | 0);
    for (let k = 0; k < n; k++) addTree(R(p.minX + 4, p.maxX - 4), R(p.minZ + 4, p.maxZ - 4), R(0.8, 1.4), p.type === 'beach');
  }
  for (const b of blocks) {
    if (b.type === 'water' || b.type === 'industrial' || b.type === 'park' || b.type === 'beach') continue;
    for (let e = 0; e < 4; e++) {
      if (rnd() < 0.58) continue;
      const t = 2.2;
      let x, z;
      if (e === 0) { x = R(b.minX + 5, b.maxX - 5); z = b.minZ + t; }
      else if (e === 1) { x = R(b.minX + 5, b.maxX - 5); z = b.maxZ - t; }
      else if (e === 2) { x = b.minX + t; z = R(b.minZ + 5, b.maxZ - 5); }
      else { x = b.maxX - t; z = R(b.minZ + 5, b.maxZ - 5); }
      addTree(x, z, R(0.7, 1.1), false);
    }
  }
  // Island palm grove
  for (let k = 0; k < 28; k++) {
    const a = R(0, Math.PI * 2);
    const rr = R(18, ISLAND.r - 12);
    const ix = ISLAND.x + Math.cos(a) * rr;
    const iz = ISLAND.z + Math.sin(a) * rr;
    addTree(ix, iz, R(0.9, 1.5), true, terrainH(ix, iz));
  }
  makeInstanced(new THREE.CylinderGeometry(0.16, 0.22, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0x6d4a2f, roughness: 1 }), trunks);
  makeInstanced(new THREE.IcosahedronGeometry(1.15, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), crowns);
}

// Downtown Central Fountain Plaza (at i=6, j=5)
{
  const pl = blocks.find(b => b.i === 6 && b.j === 5);
  if (pl) {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8.2, 1.1, 20), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.5 }));
    basin.position.set(pl.cx, CURB + 0.55, pl.cz);
    const waterDisc = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 0.85, 20), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.3 }));
    waterDisc.position.set(pl.cx, CURB + 0.65, pl.cz);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 5.2, 12), new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.7 }));
    spire.position.set(pl.cx, CURB + 2.8, pl.cz);
    world.add(basin, waterDisc, spire);
  }
}

// Seaport Piers & Offshore Island Lighthouse
export let lighthouseBeam = null;
{
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x7c5836, roughness: 0.88 });
  const concMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
  // Harbor piers jutting into Sea (near RZ[6], RZ[8]) and River (RZ[6])
  const piers = [
    [SEA_X + 12, 0.2, RZ[6], 26, 7],
    [SEA_X + 12, 0.2, RZ[8], 26, 7],
    [RIV_X0 + 8, 0.2, RZ[6], 18, 6],
    [ISLAND.x - ISLAND.r + 2, 0.2, ISLAND.z, 24, 6]
  ];
  for (const [px, py, pz, pw, pd] of piers) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.5, pd), pierMat);
    deck.position.set(px, py, pz);
    deck.castShadow = deck.receiveShadow = true;
    world.add(deck);
    for (const sx of [-pw * 0.38, 0, pw * 0.38]) {
      for (const sz of [-pd * 0.38, pd * 0.38]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.2, 8), concMat);
        pil.position.set(px + sx, -1.2, pz + sz);
        world.add(pil);
      }
    }
  }

  // Island Lighthouse
  const lhY = terrainH(ISLAND.x, ISLAND.z);
  const lhGroup = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 14, 14), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }));
  base.position.y = 7;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.78, 3.05, 4.2, 14), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 }));
  stripe.position.y = 7;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xfef08a, toneMapped: false }));
  lantern.position.y = 15.2;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 }));
  cap.position.y = 17.5;
  lighthouseBeam = new THREE.Group();
  lighthouseBeam.position.y = 15.2;
  const bCone = new THREE.Mesh(
    new THREE.ConeGeometry(6, 55, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  bCone.rotation.z = Math.PI / 2;
  bCone.position.x = 27.5;
  lighthouseBeam.add(bCone);
  lhGroup.add(base, stripe, lantern, cap, lighthouseBeam);
  lhGroup.position.set(ISLAND.x, lhY, ISLAND.z);
  world.add(lhGroup);
}

// Traffic lights
export const TL_PERIOD = 17;
export const TL_COL = { g: new THREE.Color(0x22ff66), y: new THREE.Color(0xffcc22), r: new THREE.Color(0xff3344) };
export const inter = [];
export let tlIndicatorMesh;
{
  const poles = [], hous = [], inds = [];
  for (let ai = 0; ai < RX.length; ai++) {
    if (RX[ai] > RIV_X0 && RX[ai] < RIV_X1) continue;
    for (let aj = 0; aj < RZ.length; aj++) {
      const ix = RX[ai], iz = RZ[aj];
      const rec = { parity: (ai + aj) % 2, idx: [] };
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          const x = ix + cx * (ROADW / 2 + 1.2);
          const z = iz + cz * (ROADW / 2 + 1.2);
          const ry = Math.atan2(ix - x, iz - z);
          poles.push({ p: [x, 2.6, z] });
          hous.push({ p: [x, 4.9, z], ry });
          inds.push({ p: [x + Math.sin(ry) * 0.33, 4.9, z + Math.cos(ry) * 0.33], ry });
          rec.idx.push({ i: inds.length - 1, ns: cx !== cz });
        }
      }
      inter.push(rec);
    }
  }
  makeInstanced(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6), new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.7 }), poles);
  makeInstanced(new THREE.BoxGeometry(0.45, 1.3, 0.45), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 }), hous);
  tlIndicatorMesh = makeInstanced(new THREE.BoxGeometry(0.3, 0.85, 0.08), new THREE.MeshBasicMaterial({ toneMapped: false }), inds, false);
  for (let i = 0; i < inds.length; i++) tlIndicatorMesh.setColorAt(i, TL_COL.g);
  if (tlIndicatorMesh.instanceColor) tlIndicatorMesh.instanceColor.needsUpdate = true;
}

export function tlState(t, parity) {
  const m = (t + parity * (TL_PERIOD / 2)) % TL_PERIOD;
  if (m < 7) return ['g', 'r'];
  if (m < 8.5) return ['y', 'r'];
  if (m < 15.5) return ['r', 'g'];
  return ['r', 'y'];
}

// 3D Shop storefronts + Garage Pay & Spray glowing bay
for (const s of SHOPS) {
  const g = new THREE.Group();
  const wallM = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color).multiplyScalar(0.38), roughness: 0.72 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(9.2, 4.2, 7.2), wallM);
  body.position.y = 2.1;
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 2.5, 0.2),
    new THREE.MeshPhysicalMaterial({ color: 0xbae6fd, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55 })
  );
  glass.position.set(0, 1.5, 3.62);
  const c = document.createElement('canvas');
  c.width = 320; c.height = 64;
  const gg = c.getContext('2d');
  gg.fillStyle = '#090d16'; gg.fillRect(0, 0, 320, 64);
  gg.strokeStyle = '#' + s.color.toString(16).padStart(6, '0');
  gg.lineWidth = 6; gg.strokeRect(3, 3, 314, 58);
  gg.fillStyle = gg.strokeStyle;
  gg.font = 'bold 24px Orbitron,sans-serif';
  gg.textAlign = 'center'; gg.textBaseline = 'middle';
  gg.fillText(s.name, 160, 34);
  const signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 1.9), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
  sign.position.set(0, 4.85, 3.65);

  // Entrance marker ring outside storefront
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.5, 24),
    new THREE.MeshBasicMaterial({ color: s.color, toneMapped: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.38, 4.8);
  g.add(body, glass, sign, ring);
  g.position.set(s.x, 0, s.z);
  g.rotation.y = s.ry;
  g.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
  world.add(g);
}

// Enterable Interiors (with INT_Y = -400 alignment)
export const interiorCache = new Map();
let interiorSlot = 0;
let curG = null;
const INT_Y = -400;

function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  curG.add(m);
  return m;
}

function buildInterior(def, kindOverride) {
  const seed = def.seed !== undefined ? def.seed : 7;
  const rr = mulberry32(seed);
  const kind = kindOverride || def.kind;
  const g = new THREE.Group();
  curG = g;
  const w = clamp((def.w || 12) - 2, 10, 18);
  const d = clamp((def.d || 12) - 2, 10, 18);
  const H = 3.5;
  const schemes = [[0x645b4b, 0xcbd5e1], [0x5b4231, 0xe2d5be], [0x334155, 0x94a3b8], [0x3f2e21, 0xeadbc4]];
  const sch = schemes[(rr() * schemes.length) | 0];
  const fm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: sch[0], roughness: 0.88 }));
  fm.rotation.x = -Math.PI / 2;
  g.add(fm);
  const cm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 }));
  cm.rotation.x = Math.PI / 2;
  cm.position.y = H;
  g.add(cm);

  const wallM = new THREE.MeshStandardMaterial({ color: sch[1], roughness: 0.92 });
  box(w, H, 0.3, 0, H / 2, -d / 2, wallM);
  box(w, H, 0.3, 0, H / 2, d / 2, wallM);
  box(0.3, H, d, -w / 2, H / 2, 0, wallM);
  box(0.3, H, d, w / 2, H / 2, 0, wallM);

  const light = new THREE.PointLight(0xfff2dd, 55, 32, 1.3);
  light.position.set(0, H - 0.4, 0);
  g.add(light);

  const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, 0.2), new THREE.MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false }));
  doorGlow.position.set(0, 1.3, d / 2 - 0.2);
  g.add(doorGlow);

  const woodM = new THREE.MeshStandardMaterial({ color: 0x7c4f2c, roughness: 0.78 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 });
  const fabM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rr(), 0.45, 0.42), roughness: 0.9 });

  if (kind === 'apt') {
    box(2.2, 0.55, 3.4, -w / 2 + 2.2, 0.28, -d / 2 + 2.4, fabM);
    box(2.6, 0.8, 1.1, 0, 0.4, d / 2 - 1.4, fabM);
    box(1.6, 0.72, 0.9, w / 2 - 2.2, 0.36, 0, woodM);
    box(0.5, 1.8, 1.2, w / 2 - 1.1, 0.9, -d / 2 + 1.2, woodM);
  } else if (kind === 'office') {
    for (let k = 0; k < 3; k++) box(2, 0.75, 1, -w / 2 + 2.2 + k * 3, 0.38, -d / 2 + 1.6, darkM);
    box(0.5, 1.6, 2.4, w / 2 - 1.1, 0.8, 0, darkM);
    box(1.4, 0.9, 0.7, 0, 0.45, d / 2 - 1.5, fabM);
  } else {
    box(5.2, 1.1, 1.0, 0, 0.55, -d / 2 + 2.2, darkM);
    for (let k = 0; k < 3; k++) {
      box(0.6, 2, 3, -w / 2 + 1.3 + k * 1.6, 1, 0, woodM);
      for (let q = 0; q < 4; q++) {
        box(0.4, 0.3, 0.4, -w / 2 + 1.3 + k * 1.6, 0.5 + q * 0.48, R(-1, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rr(), 0.65, 0.5) }));
      }
    }
    if (kind === 'weapons') {
      for (let q = 0; q < 3; q++) box(0.25, 1.6, 2.4, w / 2 - 1.2, 1.2, -d / 2 + 1.6 + q * 2.5, darkM);
    }
    if (kind === 'garage') {
      box(0.4, 2.6, 0.4, -2, 1.3, 0, darkM);
      box(0.4, 2.6, 0.4, 2, 1.3, 0, darkM);
      box(3.6, 0.8, 1.8, 0, 1.4, 0, fabM);
    }
    const vendor = new THREE.Group();
    const vb = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 3, 8), new THREE.MeshStandardMaterial({ color: def.color || 0x0ea5e9, roughness: 0.85 }));
    vb.position.y = 1.0;
    const vh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf1c9a5 }));
    vh.position.y = 1.75;
    vendor.add(vb, vh);
    vendor.position.set(0, 0, -d / 2 + 3.4);
    g.add(vendor);
    g.userData.vendor = vendor;
  }
  curG = null;
  return { group: g, w, d, H, kind };
}

export function getInteriorFor(def, kindOverride) {
  const key = (kindOverride || '') + '_' + def.seed;
  if (interiorCache.has(key)) return interiorCache.get(key);
  const built = buildInterior(def, kindOverride);
  const ox = -260, oy = INT_Y, oz = interiorSlot * 60 - 100;
  interiorSlot++;
  built.group.position.set(ox, oy, oz);
  scene.add(built.group);
  const D = built.d;
  const rec = {
    def,
    group: built.group,
    kind: built.kind,
    vendor: built.group.userData.vendor,
    ox, oy, oz, w: built.w, d: D, H: built.H,
    outPos: new THREE.Vector3(def.x || 0, 0, def.z || 0),
    outH: def.ry !== undefined ? def.ry : 0,
    inPos: new THREE.Vector3(ox, oy, oz + D / 2 - 2.0),
    counterPos: new THREE.Vector3(ox, oy, oz - D / 2 + 3.5),
    doorInPos: new THREE.Vector3(ox, oy, oz + D / 2 - 1.0)
  };
  interiorCache.set(key, rec);
  return rec;
}

export const shopInteriors = SHOPS.map(s => {
  const rec = getInteriorFor({ seed: s.name.length * 977 + 31, w: 12, d: 12 }, s.kind);
  rec.def = s;
  rec.outPos.set(s.x, 0, s.z);
  rec.outH = s.ry;
  return rec;
});

// Docked Speedboats at Harbor Piers & Island Pier
export const dockedBoats = [];
export function resetDockedBoats() {
  const spots = [
    { x: SEA_X + 26, z: RZ[6] - 5, ry: 0.4 },
    { x: SEA_X + 26, z: RZ[8] + 5, ry: -0.3 },
    { x: RIV_X0 + 18, z: RZ[6] - 5, ry: 0.1 },
    { x: ISLAND.x - ISLAND.r - 12, z: ISLAND.z + 6, ry: Math.PI / 2 }
  ];
  spots.forEach((sp, idx) => {
    let v = dockedBoats[idx];
    if (!v) {
      v = makeVehicle(scene, pick([0xf8fafc, 0x0ea5e9, 0xef4444, 0xf59e0b]), 'boat');
      dockedBoats.push(v);
    }
    v.group.visible = true;
    v.group.position.set(sp.x, -0.85, sp.z);
    v.group.rotation.set(0, sp.ry, 0);
    v.parked = true;
    v.wrecked = false;
    v.hp = v.maxHp;
  });
}

// Sky & Atmosphere update
const SKY_DAY = new THREE.Color(0x8bc8f8);
const SKY_NIGHT = new THREE.Color(0x070b14);
const SKY_DAWN = new THREE.Color(0xf59e56);
const SKY_RAIN = new THREE.Color(0x525d6b);
const sunCol = new THREE.Color();
const skyTmp = new THREE.Color();

export function updateSky(dt) {
  waterUniforms.uTime.value = game.simTime;
  waterTex.offset.x += dt * 0.024;
  waterTex.offset.y += dt * 0.015;

  const th = game.dayT * Math.PI * 2;
  const elev = Math.sin(th);
  game.dayF = clamp(elev * 1.6, 0, 1);
  game.nightF = clamp(-elev * 1.8, 0, 1);
  const dusk = clamp(1 - Math.abs(elev) * 3.2, 0, 1);
  skyTmp.copy(SKY_NIGHT).lerp(SKY_DAY, game.dayF).lerp(SKY_DAWN, dusk * 0.72).lerp(SKY_RAIN, game.weather.intensity * 0.7);
  scene.background.copy(skyTmp);
  worldFog.color.copy(skyTmp);
  worldFog.near = 85;
  worldFog.far = 820 - game.weather.intensity * 280 - game.nightF * 150;

  sun.position.set(player.pos.x + Math.cos(th) * 300, Math.sin(th) * 320 + 18, player.pos.z + 150);
  sun.target.position.copy(player.pos);
  sunSprite.position.set(player.pos.x + Math.cos(th) * 1150, Math.sin(th) * 1150 + 40, player.pos.z + 550);
  moonSprite.position.set(player.pos.x - Math.cos(th) * 1150, -Math.sin(th) * 1150 + 60, player.pos.z - 550);
  moonSprite.opacity = game.nightF * (1 - game.weather.intensity * 0.8);

  sun.intensity = game.dayF * 1.25 * (1 - game.weather.intensity * 0.55);
  sunCol.set(0xfff8eb).lerp(SKY_DAWN, dusk);
  sun.color.copy(sunCol);
  sun.visible = sun.intensity > 0.02;

  const flick = 0.94 + 0.06 * Math.sin(game.simTime * 11 + Math.sin(game.simTime * 7) * 2);
  moon.intensity = game.nightF * 0.18;
  moon.position.set(player.pos.x - 140, 180, player.pos.z - 90);
  hemi.intensity = 0.2 + game.dayF * 0.62 - game.weather.intensity * 0.12;
  starMat.opacity = game.nightF * 0.9 * (1 - game.weather.intensity);

  for (const m of bldSideMats) m.emissiveIntensity = game.nightF * 0.85 * flick;
  lampMat.color.setRGB((0.18 + game.nightF * 1.05) * flick, (0.15 + game.nightF * 0.85) * flick, (0.10 + game.nightF * 0.45) * flick);
  neonMat.color.setScalar(0.4 + game.nightF * 1.0 + Math.sin(game.simTime * 7) * 0.04 * game.nightF);
  for (const sp of headSpots) sp.intensity = 0.25 + game.nightF * 2.8;
  coneMat.opacity = game.nightF * 0.09;

  for (const v of vehicles) {
    if (v.group.userData.cones && v.group.userData.cones.length) {
      const on = (v === player.veh) || (v.npc && v.npc.active && Math.hypot(v.group.position.x - player.pos.x, v.group.position.z - player.pos.z) < 95);
      for (const c of v.group.userData.cones) c.visible = on && game.nightF > 0.15;
    }
  }

  flashLight.intensity = game.flashOn ? (2.2 + game.nightF * 2.2) : 0;
  if (bloomPass) bloomPass.strength = 0.10 + game.nightF * 0.36;
  cloudMat.color.set(0xffffff).lerp(new THREE.Color(0x78808a), game.weather.intensity);
  for (const c of clouds) {
    c.position.x += c.userData.v * dt * 2.5;
    if (c.position.x > 1200) c.position.x = -1200;
  }
  if (lighthouseBeam) lighthouseBeam.rotation.y += dt * 1.1;

  // Wet asphalt sheen in rain
  roadMatV.roughness = lerp(0.88, 0.22, game.weather.intensity);
  roadMatV.metalness = lerp(0.06, 0.38, game.weather.intensity);
}

export function collideSolidsAt(pos, radius, onImpact) {
  if (game.inInterior && pos === player.pos) {
    const it = game.inInterior;
    const mx = it.w / 2 - 0.35 - radius;
    const mz = it.d / 2 - 0.35 - radius;
    pos.x = clamp(pos.x, it.ox - mx, it.ox + mx);
    pos.z = clamp(pos.z, it.oz - mz, it.oz + mz);
    return;
  }
  for (const s of solids) {
    if (Math.abs(pos.x - s.cx) > s.hw + radius + 8 || Math.abs(pos.z - s.cz) > s.hd + radius + 8) continue;
    const cx = clamp(pos.x, s.minX, s.maxX);
    const cz = clamp(pos.z, s.minZ, s.maxZ);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      let nx, nz, pen;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; pen = radius - d;
      } else {
        const pL = pos.x - s.minX, pR = s.maxX - pos.x, pT = pos.z - s.minZ, pB = s.maxZ - pos.z;
        const m = Math.min(pL, pR, pT, pB);
        if (m === pL) { nx = -1; nz = 0; pen = radius + pL; }
        else if (m === pR) { nx = 1; nz = 0; pen = radius + pR; }
        else if (m === pT) { nx = 0; nz = -1; pen = radius + pT; }
        else { nx = 0; nz = 1; pen = radius + pB; }
      }
      pos.x += nx * pen;
      pos.z += nz * pen;
      if (pos === player.pos) {
        const vn = player.vel.x * nx + player.vel.z * nz;
        if (vn < 0) {
          player.vel.x -= nx * vn * 1.45;
          player.vel.z -= nz * vn * 1.45;
          if (onImpact) onImpact(-vn, nx, nz);
        }
      } else if (onImpact) {
        onImpact(5, nx, nz);
      }
    }
  }
  if (Math.abs(pos.x) > 1650) { pos.x = Math.sign(pos.x) * 1650; if (pos === player.pos) player.vel.x *= -0.4; }
  if (Math.abs(pos.z) > 1300) { pos.z = Math.sign(pos.z) * 1300; if (pos === player.pos) player.vel.z *= -0.4; }
}
