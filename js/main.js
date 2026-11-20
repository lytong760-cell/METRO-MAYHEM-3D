import * as THREE from 'three';
import {
  DAY_LEN, RX, RZ, VTYPES, CAR_PAINTS, SHOPS, IS_MOBILE,
  game, player, keys, touch, input, missions,
  clamp, lerp, lerpAngle, fmtTime, R, pick, $, show, hide, TP, TQ, TE, TS
} from './state.js';
import {
  initAudio, updateEngineAudio, horn, crashSound, setRadio
} from './audio.js';
import {
  isSoftwareGl, renderer, scene, worldFog, camera, hands, composer, bloomPass,
  groundYAt, inWaterAt, bridgeDeckY, doorDefs, shopInteriors, getInteriorFor,
  dockedBoats, resetDockedBoats, updateSky, collideSolidsAt, inter, tlIndicatorMesh, TL_COL, tlState
} from './world.js';
import {
  vehicles, makeVehicle, dentVehicle, attachLights, buildPlayerFootMesh
} from './vehicles.js';
import {
  registerActorHooks, spawnPuff, updateParticles, spawnDebris, updateDebris, updateRain,
  npcs, npcBoats, spawnNPC, updateTraffic, cops, updateCops, peds, updatePeds, updateVendors
} from './actors.js';
import {
  weaponState, resetWeapons, currentWeapon, switchWeapon, cycleWeapon,
  startReload, spawnEnemyTracer, fireWeapon, updateWeapons
} from './weapons.js';
import {
  checkBountyShot, damageBounty, missionUpdate, missionHUD
} from './missions.js';
import {
  flash, toast, updateStars, updateHUD, drawMinimap, drawBigMap,
  openShop, closeShop, togglePhone, refreshBestLine
} from './ui.js';

const { foot, fArmL, fArmR, fLegL, fLegR, gunGroup } = buildPlayerFootMesh(scene);

// WebGL context loss guard
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  toast('WebGL context lost — restoring...', 3000);
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  toast('Graphics restored', 1800);
});

const camDesired = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camNowLook = new THREE.Vector3();
const rayOrigTmp = new THREE.Vector3();
const rayDirTmp = new THREE.Vector3();
let minimapTick = 0;

function addWanted(x) {
  game.wanted = clamp(game.wanted + x, 0, 5);
  game.wantedCooldown = 18;
  updateStars();
}

function damage(a, bypassCd = false) {
  if (!bypassCd && game.dmgCooldown > 0) return;
  if (game.state !== 'playing') return;
  if (!bypassCd) game.dmgCooldown = 0.35;

  if (game.armor > 0) {
    const absorb = Math.min(game.armor, a * 0.75);
    game.armor -= absorb;
    a -= absorb;
  }
  game.health -= a;
  flash();
  if (game.health <= 0) gameOver(false);
}

function busted() {
  if (game.state !== 'playing') return;
  gameOver(true);
}

registerActorHooks({ damage, addWanted, flash, toast, busted });

// --- Interior & Vehicle Transitions ---
function enterInterior(rec) {
  game.inInterior = rec;
  game.onFoot = true;
  if (player.veh) player.veh.parked = true;
  player.pos.copy(rec.inPos);
  player.baseY = rec.inPos.y;
  player.heading = Math.PI;
  player.vel.set(0, 0, 0);
  player.speed = 0;
  scene.fog = null;
  foot.visible = !game.firstPerson;
  snapCamera();
  toast('Inside ' + (rec.def.name || rec.kind.toUpperCase()) + ' — [E] at door to exit');
}

function exitInterior() {
  const rec = game.inInterior;
  if (!rec) return;
  game.inInterior = null;
  const ex = rec.outPos.x + Math.sin(rec.outH) * 2.5;
  const ez = rec.outPos.z + Math.cos(rec.outH) * 2.5;
  player.pos.set(ex, 0, ez);
  player.baseY = groundYAt(ex, ez);
  player.heading = rec.outH;
  player.vel.set(0, 0, 0);
  scene.fog = worldFog;
  foot.visible = !game.firstPerson;
  snapCamera();
}

function enterVehicle(v) {
  if (!v || v.wrecked) return;
  if (v.npc) {
    v.npc.active = false;
    v.npc = null;
    addWanted(1.1);
  }
  for (const nb of npcBoats) {
    if (nb.veh === v) {
      nb.active = false;
      addWanted(0.8);
    }
  }
  v.parked = false;
  player.veh = v;
  game.onFoot = false;
  foot.visible = false;
  player.pos.set(v.group.position.x, 0, v.group.position.z);
  player.baseY = v.group.position.y;
  player.heading = v.group.rotation.y;
  player.vel.set(0, 0, 0);
  player.vF = 0;
  player.vL = 0;
  player.speed = 0;
  if (!v.group.userData.T.boat) attachLights(v);
  toast('Entered ' + v.group.userData.type.toUpperCase());
}

function exitVehicle() {
  if (!player.veh) return;
  const v = player.veh;
  v.parked = true;
  game.onFoot = true;
  const side = v.group.userData.T.boat ? 2.4 : 2.1;
  player.pos.x += Math.cos(player.heading) * side;
  player.pos.z -= Math.sin(player.heading) * side;
  player.baseY = groundYAt(player.pos.x, player.pos.z);
  player.vel.set(0, 0, 0);
  player.speed = 0;
  foot.visible = !game.firstPerson;
}

function findInteract() {
  if (game.inInterior) {
    const it = game.inInterior;
    const dDoor = Math.hypot(player.pos.x - it.doorInPos.x, player.pos.z - it.doorInPos.z);
    if (dDoor < 2.8) return { kind: 'exitInt', label: 'EXIT BUILDING' };
    if (it.vendor && Math.hypot(player.pos.x - it.counterPos.x, player.pos.z - it.counterPos.z) < 4.0) {
      return { kind: 'shop', rec: it, label: 'OPEN ' + (it.def.name || 'SHOP') };
    }
    return null;
  }

  if (game.onFoot) {
    for (let i = 0; i < SHOPS.length; i++) {
      const s = SHOPS[i];
      if (Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 5.4) {
        return { kind: 'enterShop', rec: shopInteriors[i], label: 'ENTER ' + s.name };
      }
    }
    for (const d of doorDefs) {
      if (Math.hypot(player.pos.x - d.x, player.pos.z - d.z) < 3.2) {
        return { kind: 'enterDoor', def: d, label: 'ENTER ' + d.kind.toUpperCase() };
      }
    }
    let bestV = null, bestD = 5.4;
    for (const v of vehicles) {
      if (!v.group.visible || v.wrecked) continue;
      if (v === missions.bountyVeh) continue;
      const d = Math.hypot(player.pos.x - v.group.position.x, player.pos.z - v.group.position.z);
      if (d < bestD) { bestD = d; bestV = v; }
    }
    if (bestV) {
      const lbl = bestV.group.userData.type === 'boat' ? 'BOARD BOAT' : (bestV.npc ? 'HIJACK VEHICLE' : 'ENTER VEHICLE');
      return { kind: 'car', v: bestV, label: lbl };
    }
    return null;
  }

  // While driving: check Garage Pay & Spray nearby
  const gShop = SHOPS[2];
  if (gShop && Math.hypot(player.pos.x - gShop.x, player.pos.z - gShop.z) < 9.5) {
    return { kind: 'driveGarage', def: gShop, label: 'GARAGE & PAY-SPRAY' };
  }
  return { kind: 'exitCar', label: player.veh && player.veh.group.userData.type === 'boat' ? 'LEAVE BOAT' : 'EXIT VEHICLE' };
}

function doInteract() {
  if (game.state !== 'playing') return;
  if (game.shopOpen) { closeShop(); return; }
  const act = findInteract();
  if (!act) return;
  if (act.kind === 'exitInt') exitInterior();
  else if (act.kind === 'shop') openShop(act.rec.def);
  else if (act.kind === 'enterShop') enterInterior(act.rec);
  else if (act.kind === 'enterDoor') enterInterior(getInteriorFor(act.def));
  else if (act.kind === 'driveGarage') openShop(act.def);
  else if (act.kind === 'car') enterVehicle(act.v);
  else if (act.kind === 'exitCar') exitVehicle();
}

function meleeHit(radius) {
  let hit = false;
  for (const pd of peds) {
    if (pd.hit) continue;
    const sx = pd.strip.axis === 'x' ? pd.t : pd.strip.c;
    const sz = pd.strip.axis === 'x' ? pd.strip.c : pd.t;
    if (Math.hypot(sx - player.pos.x, sz - player.pos.z) < radius) {
      pd.hit = true; pd.hitT = 2.5; pd.vy = 7;
      pd.vx = Math.sin(player.heading) * 6;
      pd.vz = Math.cos(player.heading) * 6;
      game.money += 12;
      addWanted(0.8);
      crashSound(0.45);
      hit = true;
    }
  }
  for (const c of cops) {
    if (!c.active) continue;
    if (Math.hypot(c.veh.group.position.x - player.pos.x, c.veh.group.position.z - player.pos.z) < radius + 1.5) {
      c.hp -= 22;
      crashSound(0.5);
      addWanted(0.5);
      hit = true;
    }
  }
  if (!hit) crashSound(0.15);
}

const weaponHooks = {
  addWanted,
  toast,
  meleeHit,
  checkBountyShot: (o, d, b) => checkBountyShot(o, d, b),
  damageBounty: (dmg, pos) => damageBounty(dmg, pos, toast)
};

// --- Camera ---
function clampCamInterior(v) {
  if (!game.inInterior) return;
  const it = game.inInterior;
  const mx = it.w / 2 - 0.45;
  const mz = it.d / 2 - 0.45;
  v.x = clamp(v.x, it.ox - mx, it.ox + mx);
  v.z = clamp(v.z, it.oz - mz, it.oz + mz);
  v.y = clamp(v.y, it.oy + 0.65, it.oy + it.H - 0.35);
}

function snapCamera() {
  const cy = player.baseY;
  if (game.firstPerson) {
    const yaw = player.heading + game.viewYaw;
    camera.position.set(player.pos.x, cy + (game.onFoot ? 1.65 : 1.15), player.pos.z);
    camLook.set(
      player.pos.x + Math.sin(yaw) * 14,
      camera.position.y - Math.sin(game.viewPitch) * 6,
      player.pos.z + Math.cos(yaw) * 14
    );
  } else {
    const yaw = player.heading + Math.PI + game.viewYaw;
    const isBoat = player.veh && player.veh.group.userData.type === 'boat' && !game.onFoot;
    const dist = game.inInterior ? 2.5 : game.onFoot ? 5.2 : isBoat ? 10.5 : 8.5;
    const h = game.inInterior ? 1.75 : game.onFoot ? 2.4 : isBoat ? 3.8 : 3.4;
    camera.position.set(
      player.pos.x + Math.sin(yaw) * dist,
      cy + h + Math.sin(game.viewPitch) * 3.0,
      player.pos.z + Math.cos(yaw) * dist
    );
    clampCamInterior(camera.position);
    camLook.set(player.pos.x, cy + (game.onFoot ? 1.2 : 1.0), player.pos.z);
  }
  camNowLook.copy(camLook);
  camera.lookAt(camNowLook);
}

function updateCamera(dt) {
  const cy = player.baseY;
  if (game.firstPerson) {
    const yaw = player.heading + game.viewYaw;
    camDesired.set(player.pos.x, cy + (game.onFoot ? 1.65 : 1.15), player.pos.z);
    camera.position.copy(camDesired);
    camLook.set(
      player.pos.x + Math.sin(yaw) * 18,
      camera.position.y - Math.sin(game.viewPitch) * 10,
      player.pos.z + Math.cos(yaw) * 18
    );
    camera.lookAt(camLook);
    hands.visible = game.state === 'playing' && !game.shopOpen && !game.phoneOpen;
    const fpGun = hands.getObjectByName('fpGun');
    const cig = hands.getObjectByName('cig');
    if (fpGun) fpGun.visible = weaponState.idx > 0;
    if (cig) cig.visible = game.smokeT > 0 && weaponState.idx === 0;
    if (game.onFoot && player.speed > 0.5) {
      hands.position.y = Math.sin(player.walkPh * 2) * 0.025;
    } else {
      hands.position.y = 0;
    }
  } else {
    hands.visible = false;
    const yaw = player.heading + Math.PI + game.viewYaw;
    const isBoat = player.veh && player.veh.group.userData.type === 'boat' && !game.onFoot;
    const dist = game.inInterior ? 2.5 : game.onFoot ? 5.2 : isBoat ? 10.5 : 8.5;
    const h = game.inInterior ? 1.75 : game.onFoot ? 2.4 : isBoat ? 3.8 : 3.4;
    camDesired.set(
      player.pos.x + Math.sin(yaw) * dist,
      cy + h + Math.sin(game.viewPitch) * 3.2,
      player.pos.z + Math.cos(yaw) * dist
    );
    clampCamInterior(camDesired);
    camera.position.lerp(camDesired, 1 - Math.exp(-9 * dt));
    clampCamInterior(camera.position);
    camLook.set(
      player.pos.x + Math.sin(player.heading) * (game.onFoot ? 1.5 : 3.0),
      cy + (game.onFoot ? 1.25 : 1.05),
      player.pos.z + Math.cos(player.heading) * (game.onFoot ? 1.5 : 3.0)
    );
    camNowLook.lerp(camLook, 1 - Math.exp(-12 * dt));
    camera.lookAt(camNowLook);
  }

  if (game.shake > 0.005) {
    camera.position.x += (Math.random() - 0.5) * game.shake;
    camera.position.y += (Math.random() - 0.5) * game.shake * 0.7;
    game.shake *= Math.exp(-10 * dt);
  } else {
    game.shake = 0;
  }
}

// --- Physics Step ---
function updatePlayer(dt) {
  if (game.shopOpen || game.phoneOpen) return;

  if (game.onFoot) {
    const T = { max: 9.2, turn: 3.4, r: 0.45 };
    const turnIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    player.heading += turnIn * T.turn * dt;

    let fwd = 0;
    if (input.gas) fwd += 1;
    if (input.brake) fwd -= 0.7;
    if (input.nos && fwd > 0) fwd *= 1.45; // Sprint with SHIFT on foot

    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    player.vel.x = lerp(player.vel.x, fx * fwd * T.max, 1 - Math.exp(-12 * dt));
    player.vel.z = lerp(player.vel.z, fz * fwd * T.max, 1 - Math.exp(-12 * dt));

    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    collideSolidsAt(player.pos, T.r);

    // Keep player out of deep water when on foot
    if (!game.inInterior && inWaterAt(player.pos.x, player.pos.z)) {
      player.vel.multiplyScalar(0.5);
    }

    player.baseY = groundYAt(player.pos.x, player.pos.z);
    player.speed = Math.hypot(player.vel.x, player.vel.z);
    player.vF = player.vel.x * fx + player.vel.z * fz;
    player.drifting = false;

    if (player.speed > 0.25) {
      player.walkPh += player.speed * dt * 1.4;
      game.runDist += player.speed * dt;
    }

    foot.visible = !game.firstPerson;
    foot.position.set(player.pos.x, player.baseY, player.pos.z);
    foot.rotation.y = player.heading;
    const sw = player.speed > 0.3 ? Math.sin(player.walkPh * 2) * 0.7 : 0;
    fLegL.rotation.x = sw;
    fLegR.rotation.x = -sw;
    fArmL.rotation.x = -sw * 0.75;
    if (player.punchT > 0) {
      player.punchT -= dt;
      fArmR.rotation.x = -1.6;
    } else if (weaponState.idx > 0) {
      fArmR.rotation.x = -1.35;
    } else {
      fArmR.rotation.x = sw * 0.75;
    }
    if (gunGroup) gunGroup.visible = weaponState.idx > 0;
    if (player.kickT > 0) {
      player.kickT -= dt;
      fLegR.rotation.x = -1.5;
    }
    return;
  }

  // Driving vehicle or Boat
  const v = player.veh;
  if (!v) return;
  const g = v.group;
  const T = g.userData.T;
  const isBoat = !!T.boat;

  const fx = Math.sin(player.heading);
  const fz = Math.cos(player.heading);
  const lx = Math.cos(player.heading);
  const lz = -Math.sin(player.heading);

  let vF = player.vel.x * fx + player.vel.z * fz;
  let vL = player.vel.x * lx + player.vel.z * lz;

  const nosOn = game.upgrades.nitro && input.nos && game.nosFuel > 0 && input.gas && !isBoat;
  if (nosOn) game.nosFuel = Math.max(0, game.nosFuel - 28 * dt);
  else if (game.upgrades.nitro) game.nosFuel = Math.min(100, game.nosFuel + 6 * dt);

  const acc = T.acc * (nosOn ? 1.75 : 1);
  const maxS = T.max * (nosOn ? 1.38 : 1);

  if (input.gas) vF += acc * dt;
  else if (input.brake) vF -= acc * (vF > 1 ? 1.6 : 0.7) * dt;
  else vF *= Math.exp((isBoat ? -0.9 : -1.5) * dt);

  vF = clamp(vF, -maxS * 0.35, maxS);

  const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  player.steer = lerp(player.steer, steerIn * 0.48, 1 - Math.exp(-10 * dt));
  const turnFactor = clamp(Math.abs(vF) / 7, 0, 1) * (vF >= -0.2 ? 1 : -1);
  const driftMul = input.hb && !isBoat ? 1.45 : 1.0;
  player.heading += steerIn * T.turn * turnFactor * driftMul * dt;

  const grip = isBoat ? 2.6 : (input.hb ? 2.2 : 9.5) * (1 - game.weather.intensity * 0.28);
  vL *= Math.exp(-grip * dt);

  const nfx = Math.sin(player.heading);
  const nfz = Math.cos(player.heading);
  const nlx = Math.cos(player.heading);
  const nlz = -Math.sin(player.heading);

  player.vel.x = nfx * vF + nlx * vL;
  player.vel.z = nfz * vF + nlz * vL;
  player.vF = vF;
  player.vL = vL;
  player.speed = Math.hypot(player.vel.x, player.vel.z);
  player.drifting = !isBoat && (input.hb || Math.abs(vL) > 5.5) && player.speed > 7;

  const nx = player.pos.x + player.vel.x * dt;
  const nz = player.pos.z + player.vel.z * dt;

  if (isBoat) {
    // Boats cruise swiftly on water & slow down on shore/island
    if (inWaterAt(nx, nz, true)) {
      player.pos.x = nx;
      player.pos.z = nz;
    } else {
      player.pos.x = lerp(player.pos.x, nx, 0.25);
      player.pos.z = lerp(player.pos.z, nz, 0.25);
      player.vel.multiplyScalar(0.5);
    }
    player.baseY = inWaterAt(player.pos.x, player.pos.z, true)
      ? -0.85 + Math.sin(game.simTime * 3.0) * 0.08
      : groundYAt(player.pos.x, player.pos.z);

    if (player.speed > 5 && Math.random() < 0.55) {
      spawnPuff(
        player.pos.x - nfx * 3.1, -0.45, player.pos.z - nfz * 3.1,
        R(-1.2, 1.2), 1.0, R(-1.2, 1.2), 3.4, 0.5, 0.85, 0.94, 1
      );
    }
  } else {
    player.pos.x = nx;
    player.pos.z = nz;
    collideSolidsAt(player.pos, T.r, (imp, cnx, cnz) => {
      if (imp > 7) {
        crashSound(clamp(imp / 28, 0.25, 1));
        dentVehicle(v, TP.set(player.pos.x - cnx, player.baseY + 0.8, player.pos.z - cnz), clamp(imp / 30, 0.2, 0.7));
        damage(Math.round(imp * (game.upgrades.ram ? 0.25 : 0.6)));
        game.shake = Math.max(game.shake, clamp(imp / 45, 0.1, 0.6));
      }
    });
    if (inWaterAt(player.pos.x, player.pos.z)) {
      // Water slows land vehicles heavily and deals water damage
      player.vel.multiplyScalar(0.88);
      if (player.speed > 4) spawnPuff(player.pos.x, 0.2, player.pos.z, R(-2, 2), 2.5, R(-2, 2), 4, 0.5, 0.85, 0.94, 1);
      damage(10 * dt, true);
    }
    player.baseY = groundYAt(player.pos.x, player.pos.z);
  }

  game.runDist += player.speed * dt;
  g.position.set(player.pos.x, player.baseY, player.pos.z);
  g.rotation.y = player.heading;
  g.rotation.z = isBoat ? -player.steer * 0.25 : -player.steer * clamp(player.speed / 45, 0, 0.08);
  g.rotation.x = isBoat ? clamp(-vF * 0.005, -0.14, 0.08) : 0;

  // Tail lights & Wheel animation
  const brk = input.brake || input.hb;
  const tm = brk ? g.userData.tailMats.on : g.userData.tailMats.off;
  for (const t of g.userData.tails) t.material = tm;
  for (const w of g.userData.wheels) w.rotation.x += (vF * dt) / 0.42;
  for (const w of g.userData.frontWheels) w.rotation.y = player.steer;

  if (nosOn && Math.random() < 0.75) {
    spawnPuff(player.pos.x - nfx * (T.len / 2), player.baseY + 0.4, player.pos.z - nfz * (T.len / 2), -nfx * 6, 0.8, -nfz * 6, 3.2, 0.25, 1.0, 0.55, 0.15);
  } else if (player.drifting && Math.random() < 0.65) {
    spawnPuff(player.pos.x - nfx * (T.len * 0.35), player.baseY + 0.25, player.pos.z - nfz * (T.len * 0.35), R(-1, 1), 0.8, R(-1, 1), 3.6, 0.55, 0.85, 0.85, 0.88);
  }

  // Player collisions vs NPC cars
  if (!isBoat) {
    for (const n of npcs) {
      if (!n.active) continue;
      const ng = n.veh.group;
      const dx = ng.position.x - player.pos.x;
      const dz = ng.position.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const minD = T.r + ng.userData.T.r;
      if (d > 0.01 && d < minD) {
        const rel = player.speed + n.speed;
        const nxx = dx / d, nzz = dz / d;
        const pen = minD - d;
        player.pos.x -= nxx * pen * 0.5;
        player.pos.z -= nzz * pen * 0.5;
        ng.position.x += nxx * pen * 0.5;
        ng.position.z += nzz * pen * 0.5;
        if (rel > 7) {
          crashSound(clamp(rel / 35, 0.2, 1));
          dentVehicle(v, TP.set(player.pos.x + nxx, player.baseY + 0.8, player.pos.z + nzz), clamp(rel / 40, 0.15, 0.5));
          dentVehicle(n.veh, TP.set(ng.position.x - nxx, ng.position.y + 0.8, ng.position.z - nzz), clamp(rel / 30, 0.2, 0.6));
          spawnDebris(player.pos.x + nxx, player.baseY + 1, player.pos.z + nzz, ng.userData.paint, 3);
          n.hitTimer = 1.6;
          addWanted(0.45);
          if (!game.upgrades.ram) {
            player.vel.multiplyScalar(0.55);
            damage(Math.round(rel * 0.32));
          } else {
            player.vel.multiplyScalar(0.85);
            n.veh.hp -= rel * 1.4;
          }
        }
      }
    }
  }
}

// --- Game Flow ---
function resetGame() {
  game.health = 100;
  game.armor = 0;
  game.wanted = 0;
  game.wantedCooldown = 0;
  game.money = 250;
  game.runDist = 0;
  game.runTime = 0;
  game.dayT = 0.28;
  game.onFoot = false;
  game.shopOpen = false;
  game.phoneOpen = false;
  game.inInterior = null;
  game.firstPerson = false;
  game.viewYaw = 0;
  game.viewPitch = 0.14;
  game.upgrades = { nitro: false, armor: false, ram: false };
  game.nosFuel = 0;
  scene.fog = worldFog;

  resetWeapons();
  resetDockedBoats();

  for (const c of cops) { c.active = false; c.veh.group.visible = false; }
  for (const n of npcs) spawnNPC(n);
  for (const b of npcBoats) { b.active = true; b.veh.group.visible = true; }

  // Spawn player's crisp red sport/supercar in Downtown
  if (!player.veh || player.veh.group.userData.type === 'boat') {
    player.veh = makeVehicle(scene, 0xdc2626, 'sport');
  }
  player.veh.group.visible = true;
  player.veh.hp = player.veh.maxHp;
  player.veh.wrecked = false;
  player.pos.set(RX[5] - 4, 0, RZ[6] - 20);
  player.baseY = 0;
  player.heading = 0;
  player.vel.set(0, 0, 0);
  player.speed = 0;
  player.vF = 0;
  player.vL = 0;
  player.veh.group.position.set(player.pos.x, 0, player.pos.z);
  player.veh.group.rotation.set(0, 0, 0);
  attachLights(player.veh);
  foot.visible = false;

  for (const k in keys) keys[k] = false;
  for (const k in touch) touch[k] = false;

  missions.active = false;
  missions.cooldown = 3.5;
  snapCamera();
  updateHUD();
}

function startGame() {
  initAudio();
  resetGame();
  game.state = 'playing';
  hide($('menu'));
  hide($('gameOver'));
  hide($('pauseOverlay'));
  $('hud').classList.add('on');
  if (IS_MOBILE) $('touchUI').classList.add('on');
  toast('4 Districts Open — Explore, Combat, Missions, Harbor Boats!');
}

function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  if (document.pointerLockElement) document.exitPointerLock();
  show($('pauseOverlay'));
}

function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  hide($('pauseOverlay'));
}

function gameOver(wasBusted) {
  game.state = 'gameover';
  if (document.pointerLockElement) document.exitPointerLock();
  $('hud').classList.remove('on');
  $('touchUI').classList.remove('on');
  closeShop();
  if (game.phoneOpen) togglePhone();

  const nb = game.runDist > game.best.dist || game.runTime > game.best.time;
  if (game.runDist > game.best.dist) game.best.dist = game.runDist;
  if (game.runTime > game.best.time) game.best.time = game.runTime;
  try { localStorage.setItem('mm3d_best', JSON.stringify(game.best)); } catch (e) {}

  $('goTitle').textContent = wasBusted ? 'BUSTED!' : 'WASTED!';
  $('goTitle').style.color = wasBusted ? '#38bdf8' : '#ef4444';
  $('goDist').textContent = Math.floor(game.runDist) + ' m';
  $('goTime').textContent = fmtTime(game.runTime);
  $('goCash').textContent = '$' + game.money;
  $('goBestD').textContent = Math.floor(game.best.dist) + ' m';
  $('goBestT').textContent = fmtTime(game.best.time);
  $('newBest').style.display = nb ? 'block' : 'none';
  show($('gameOver'));
  refreshBestLine();
}

// --- Input & UI Bindings ---
$('btnStart').onclick = startGame;
$('btnRestart').onclick = startGame;
$('btnRestartP').onclick = startGame;
$('btnResume').onclick = resumeGame;
$('btnControls').onclick = () => { hide($('menu')); show($('controlsPanel')); };
$('btnCtrlBack').onclick = () => { hide($('controlsPanel')); show($('menu')); };
$('btnCredits').onclick = () => { hide($('menu')); show($('creditsPanel')); };
$('btnCredBack').onclick = () => { hide($('creditsPanel')); show($('menu')); };
$('btnQuitP').onclick = () => { hide($('pauseOverlay')); $('hud').classList.remove('on'); $('touchUI').classList.remove('on'); game.state = 'menu'; show($('menu')); };
$('btnQuitO').onclick = () => { hide($('gameOver')); game.state = 'menu'; show($('menu')); };
$('btnShopClose').onclick = closeShop;
$('btnPhoneClose').onclick = togglePhone;

$('appWeather').onclick = () => {
  game.weather.rain = !game.weather.rain;
  $('weatherLabel').textContent = game.weather.rain ? 'Storm' : 'Clear';
  toast(game.weather.rain ? 'Storm Incoming' : 'Skies Clearing');
};
$('appRadio').onclick = () => setRadio(!game.radioOn);
$('appMap').onclick = () => {
  const w = $('mapBigWrap');
  w.style.display = w.style.display === 'block' ? 'none' : 'block';
  drawBigMap();
};
$('appMechanic').onclick = () => {
  if (game.inInterior) { toast('Step outside first!'); return; }
  if (game.money < 120) { toast('Need $120'); return; }
  game.money -= 120;
  const v = makeVehicle(scene, pick(CAR_PAINTS), 'supercar');
  const px = player.pos.x + Math.sin(player.heading) * 6;
  const pz = player.pos.z + Math.cos(player.heading) * 6;
  v.group.position.set(px, bridgeDeckY(px, pz), pz);
  v.group.rotation.y = player.heading;
  v.group.visible = true;
  v.parked = true;
  togglePhone();
  updateHUD();
  toast('Supercar Delivered Nearby!');
};

window.addEventListener('keydown', e => {
  const c = e.code;
  if (c === 'KeyW' || c === 'ArrowUp') keys.gas = true;
  if (c === 'KeyS' || c === 'ArrowDown') keys.brake = true;
  if (c === 'KeyA' || c === 'ArrowLeft') keys.left = true;
  if (c === 'KeyD' || c === 'ArrowRight') keys.right = true;
  if (c === 'Space') keys.hb = true;
  if (c === 'ShiftLeft' || c === 'ShiftRight') keys.nos = true;
  if (c === 'KeyQ') { if (!keys.fire) fireWeapon(weaponHooks); keys.fire = true; }
  if (c === 'KeyH') horn();
  if (c === 'KeyE') doInteract();
  if (c === 'KeyF') { player.punchT = 0.35; meleeHit(2.1); }
  if (c === 'KeyG') { player.kickT = 0.35; meleeHit(2.3); }
  if (c === 'KeyR') startReload(toast);
  if (c === 'KeyP') togglePhone();
  if (c === 'KeyV') { game.firstPerson = !game.firstPerson; foot.visible = game.onFoot && !game.firstPerson; snapCamera(); }
  if (c === 'KeyL') { game.flashOn = !game.flashOn; toast(game.flashOn ? 'Flashlight ON' : 'Flashlight OFF'); }
  if (c === 'Digit1') switchWeapon(0);
  if (c === 'Digit2') switchWeapon(1);
  if (c === 'Digit3') switchWeapon(2);
  if (c === 'Digit4') switchWeapon(3);
  if (c === 'Digit5') switchWeapon(4);
  if (c === 'Escape') {
    if (game.shopOpen) closeShop();
    else if (game.phoneOpen) togglePhone();
    else if (game.state === 'playing') pauseGame();
    else if (game.state === 'paused') resumeGame();
  }
});

window.addEventListener('keyup', e => {
  const c = e.code;
  if (c === 'KeyW' || c === 'ArrowUp') keys.gas = false;
  if (c === 'KeyS' || c === 'ArrowDown') keys.brake = false;
  if (c === 'KeyA' || c === 'ArrowLeft') keys.left = false;
  if (c === 'KeyD' || c === 'ArrowRight') keys.right = false;
  if (c === 'Space') keys.hb = false;
  if (c === 'ShiftLeft' || c === 'ShiftRight') keys.nos = false;
  if (c === 'KeyQ') keys.fire = false;
});

renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0 || game.state !== 'playing' || game.shopOpen || game.phoneOpen) return;
  if (document.pointerLockElement !== renderer.domElement) {
    try {
      const pr = renderer.domElement.requestPointerLock();
      if (pr && pr.catch) pr.catch(() => {});
    } catch (err) {}
  }
  keys.fire = true;
  fireWeapon(weaponHooks);
});
window.addEventListener('mouseup', e => { if (e.button === 0) keys.fire = false; });
window.addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement && game.state === 'playing') {
    game.viewYaw -= e.movementX * 0.0024;
    game.viewPitch = clamp(game.viewPitch + e.movementY * 0.002, -0.5, 0.75);
  }
});
window.addEventListener('wheel', e => {
  if (game.state === 'playing' && !game.shopOpen && !game.phoneOpen) {
    cycleWeapon(e.deltaY > 0 ? 1 : -1);
  }
}, { passive: true });

// Touch controls
function bindHold(id, key, onDown) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('touchstart', e => { e.preventDefault(); touch[key] = true; if (onDown) onDown(); }, { passive: false });
  el.addEventListener('touchend', () => { touch[key] = false; });
  el.addEventListener('touchcancel', () => { touch[key] = false; });
}
bindHold('tLeft', 'left');
bindHold('tRight', 'right');
bindHold('tGas', 'gas');
bindHold('tBrake', 'brake');
bindHold('tDrift', 'hb');
bindHold('tNitro', 'nos');
bindHold('tFire', 'fire', () => fireWeapon(weaponHooks));
$('tHorn')?.addEventListener('touchstart', e => { e.preventDefault(); horn(); }, { passive: false });
$('tEnter')?.addEventListener('touchstart', e => { e.preventDefault(); doInteract(); }, { passive: false });
$('tPunch')?.addEventListener('touchstart', e => { e.preventDefault(); player.punchT = 0.35; meleeHit(2.1); }, { passive: false });
$('tKick')?.addEventListener('touchstart', e => { e.preventDefault(); player.kickT = 0.35; meleeHit(2.3); }, { passive: false });
$('tWeap')?.addEventListener('touchstart', e => { e.preventDefault(); cycleWeapon(1); }, { passive: false });
$('tPhone')?.addEventListener('touchstart', e => { e.preventDefault(); togglePhone(); }, { passive: false });
$('tView')?.addEventListener('touchstart', e => { e.preventDefault(); game.firstPerson = !game.firstPerson; snapCamera(); }, { passive: false });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
});

// Software WebGL frame pacing helper
const glCtx = isSoftwareGl ? renderer.getContext() : null;
function afterDraw(fn) {
  if (!glCtx || typeof glCtx.fenceSync !== 'function') {
    setTimeout(fn, 16);
    return;
  }
  const sync = glCtx.fenceSync(glCtx.SYNC_GPU_COMMANDS_COMPLETE, 0);
  glCtx.flush();
  const start = performance.now();
  function poll() {
    const res = glCtx.clientWaitSync(sync, 0, 0);
    if (res !== glCtx.TIMEOUT_EXPIRED || performance.now() - start > 80) {
      glCtx.deleteSync(sync);
      requestAnimationFrame(fn);
    } else {
      setTimeout(poll, 4);
    }
  }
  poll();
}

// --- Main Loop ---
let lastT = performance.now();
refreshBestLine();
resetDockedBoats();
for (const n of npcs) spawnNPC(n);

function tick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (game.state === 'menu') {
    game.simTime += dt;
    game.menuAngle += dt * 0.12;
    camera.position.set(Math.sin(game.menuAngle) * 195, 78, Math.cos(game.menuAngle) * 195);
    camera.lookAt(0, 6, 0);
    updateSky(dt);
    updateTraffic(dt, tlState);
    updatePeds(dt);
  } else if (game.state === 'playing') {
    game.simTime += dt;
    game.dayT = (game.dayT + dt / DAY_LEN) % 1;
    game.runTime += dt;
    game.dmgCooldown = Math.max(0, game.dmgCooldown - dt);
    if (game.smokeT > 0) game.smokeT -= dt;

    if (game.wanted > 0) {
      game.wantedCooldown -= dt;
      if (game.wantedCooldown <= 0) game.wanted = Math.max(0, game.wanted - dt * 0.14);
    }

    updateSky(dt);
    updateRain(dt, camera);
    updateTraffic(dt, tlState);
    updatePeds(dt);
    updateVendors();
    updateCops(dt, (origin, dmg) => spawnEnemyTracer(origin, dmg, d => damage(d, true)));
    updateWeapons(dt, groundYAt, toast);
    if (input.fire && currentWeapon().auto) fireWeapon(weaponHooks);
    updatePlayer(dt);
    updateParticles(dt);
    updateDebris(dt);
    missionUpdate(dt, toast);
    updateCamera(dt);
    updateEngineAudio();

    // Update traffic lights
    for (const r of inter) {
      const st = tlState(game.simTime, r.parity);
      for (const it of r.idx) tlIndicatorMesh.setColorAt(it.i, TL_COL[it.ns ? st[0] : st[1]]);
    }
    if (tlIndicatorMesh.instanceColor) tlIndicatorMesh.instanceColor.needsUpdate = true;

    // Prompt banner
    const act = findInteract();
    const pr = $('prompt');
    if (pr) {
      if (act && !game.shopOpen && !game.phoneOpen && (act.kind !== 'exitCar' || player.speed < 2)) {
        pr.innerHTML = 'Press <b>[E]</b> ' + act.label;
        pr.classList.add('on');
      } else {
        pr.classList.remove('on');
      }
    }

    updateHUD();
    missionHUD();
    if (++minimapTick % 3 === 0) {
      drawMinimap();
      if (game.phoneOpen) drawBigMap();
    }
  } else {
    updateEngineAudio();
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);

  if (isSoftwareGl) afterDraw(tick);
  else requestAnimationFrame(tick);
}

if (isSoftwareGl) afterDraw(tick);
else requestAnimationFrame(tick);
