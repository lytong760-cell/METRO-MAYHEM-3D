import * as THREE from 'three';
import { WEAPONS, game, player, R, TP } from './state.js';
import { gunSound, reloadSound, crashSound } from './audio.js';
import { scene, camera } from './world.js';
import { vehicles, dentVehicle } from './vehicles.js';
import { npcs, cops, peds, spawnPuff, spawnDebris, spawnExplosion } from './actors.js';

export const weaponState = {
  idx: 1, // start with Pistol ready
  owned: [true, true, false, false, false], // fists, pistol unlocked; smg, shotgun, grenade purchasable
  clip: [0, 12, 30, 8, 1],
  reserve: [0, 36, 0, 0, 0],
  fireCd: 0,
  reloadT: 0
};

export function resetWeapons() {
  weaponState.idx = 1;
  weaponState.owned = [true, true, false, false, false];
  weaponState.clip = [0, 12, 30, 8, 1];
  weaponState.reserve = [0, 36, 0, 0, 0];
  weaponState.fireCd = 0;
  weaponState.reloadT = 0;
}

export function currentWeapon() {
  return WEAPONS[weaponState.idx];
}

export function switchWeapon(idx) {
  if (idx < 0 || idx >= WEAPONS.length) return;
  if (!weaponState.owned[idx]) return;
  weaponState.idx = idx;
  weaponState.reloadT = 0;
}

export function cycleWeapon(dir = 1) {
  let n = weaponState.idx;
  for (let k = 0; k < WEAPONS.length; k++) {
    n = (n + dir + WEAPONS.length) % WEAPONS.length;
    if (weaponState.owned[n]) {
      weaponState.idx = n;
      weaponState.reloadT = 0;
      return;
    }
  }
}

export function startReload(toast) {
  const w = currentWeapon();
  if (w.clip <= 0 || weaponState.reloadT > 0) return;
  if (weaponState.clip[weaponState.idx] >= w.clip || weaponState.reserve[weaponState.idx] <= 0) return;
  weaponState.reloadT = 1.05;
  reloadSound();
  if (toast) toast('Reloading ' + w.name + '...', 1100);
}

// Visible bullet tracer lines & muzzle flash
const tracers = [];
const tracerGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
tracerGeo.rotateX(Math.PI / 2);
const muzzleLight = new THREE.PointLight(0xfde047, 0, 12, 1.5);
scene.add(muzzleLight);
let muzzleT = 0;

function spawnTracer(from, to, colHex) {
  const dist = from.distanceTo(to);
  if (dist < 0.2) return;
  const m = new THREE.Mesh(
    tracerGeo,
    new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.9, toneMapped: false })
  );
  m.position.copy(from).lerp(to, 0.5);
  m.lookAt(to);
  m.scale.set(1, 1, dist);
  scene.add(m);
  tracers.push({ mesh: m, life: 0.09 });
}

// Active thrown grenades
const grenades = [];
const grenGeo = new THREE.SphereGeometry(0.18, 8, 6);
const grenMat = new THREE.MeshStandardMaterial({ color: 0x365314, roughness: 0.6, metalness: 0.4 });

const rayDir = new THREE.Vector3();
const rayOrig = new THREE.Vector3();
const aimTmp = new THREE.Vector3();

export function spawnEnemyTracer(originPos, dmg, onHitPlayer) {
  const dest = TP.set(player.pos.x + R(-0.6, 0.6), player.baseY + 1.1 + R(-0.3, 0.4), player.pos.z + R(-0.6, 0.6));
  const start = new THREE.Vector3(originPos.x, originPos.y + 1.4, originPos.z);
  spawnTracer(start, dest, 0xef4444);
  gunSound('pistol');
  if (Math.random() < 0.45 && onHitPlayer) onHitPlayer(dmg);
}

export function fireWeapon(hooks) {
  if (game.state !== 'playing' || game.shopOpen || game.phoneOpen) return;
  if (weaponState.fireCd > 0 || weaponState.reloadT > 0) return;

  const idx = weaponState.idx;
  const w = WEAPONS[idx];

  if (w.id === 'fists') {
    if (game.onFoot) {
      player.punchT = 0.35;
      if (hooks.meleeHit) hooks.meleeHit(2.1);
    }
    weaponState.fireCd = w.rate;
    return;
  }

  // Require on foot (or allow pistol drive-by if desired — let's allow drive-by pistol/SMG too!)
  if (weaponState.clip[idx] <= 0) {
    if (weaponState.reserve[idx] > 0) startReload(hooks.toast);
    else if (hooks.toast) hooks.toast('Out of ammo! Visit Ammu-Nation', 1500);
    weaponState.fireCd = 0.25;
    return;
  }

  weaponState.clip[idx]--;
  weaponState.fireCd = w.rate;

  if (w.id === 'grenade') {
    // Throw grenade in camera forward direction
    camera.getWorldDirection(rayDir);
    const start = new THREE.Vector3(player.pos.x, player.baseY + 1.5, player.pos.z);
    const vel = rayDir.clone().multiplyScalar(22);
    vel.y += 6.5;
    const mesh = new THREE.Mesh(grenGeo, grenMat);
    mesh.position.copy(start);
    scene.add(mesh);
    grenades.push({ mesh, pos: start, vel, fuse: 1.45 });
    if (weaponState.reserve[idx] > 0) {
      weaponState.reserve[idx]--;
      weaponState.clip[idx] = 1;
    }
    return;
  }

  gunSound(w.id);
  game.shake = Math.max(game.shake, w.id === 'shotgun' ? 0.22 : 0.08);
  muzzleT = 0.05;
  muzzleLight.intensity = 18;
  muzzleLight.position.set(player.pos.x, player.baseY + 1.4, player.pos.z);

  camera.getWorldDirection(rayDir);
  if (game.firstPerson) {
    rayOrig.copy(camera.position);
  } else {
    rayOrig.set(player.pos.x, player.baseY + 1.38, player.pos.z);
  }

  for (let p = 0; p < w.pellets; p++) {
    const dir = rayDir.clone();
    if (w.spread > 0) {
      dir.x += R(-w.spread, w.spread);
      dir.y += R(-w.spread * 0.5, w.spread * 0.5);
      dir.z += R(-w.spread, w.spread);
      dir.normalize();
    }

    let bestDist = w.range;
    let hitType = null;
    let hitObj = null;

    // Check Cops / SWAT
    for (const c of cops) {
      if (!c.active) continue;
      const g = c.veh.group;
      aimTmp.set(g.position.x - rayOrig.x, g.position.y + 1.0 - rayOrig.y, g.position.z - rayOrig.z);
      const proj = aimTmp.dot(dir);
      if (proj > 0 && proj < bestDist) {
        const perpSq = aimTmp.lengthSq() - proj * proj;
        if (perpSq < 4.5) {
          bestDist = proj;
          hitType = 'cop';
          hitObj = c;
        }
      }
    }

    // Check NPC cars
    for (const n of npcs) {
      if (!n.active) continue;
      const g = n.veh.group;
      aimTmp.set(g.position.x - rayOrig.x, g.position.y + 0.9 - rayOrig.y, g.position.z - rayOrig.z);
      const proj = aimTmp.dot(dir);
      if (proj > 0 && proj < bestDist) {
        const perpSq = aimTmp.lengthSq() - proj * proj;
        if (perpSq < 4.0) {
          bestDist = proj;
          hitType = 'npc';
          hitObj = n;
        }
      }
    }

    // Check Bounty mission target vehicle if any
    if (hooks.checkBountyShot) {
      const bh = hooks.checkBountyShot(rayOrig, dir, bestDist);
      if (bh) {
        bestDist = bh.dist;
        hitType = 'bounty';
        hitObj = bh.veh;
      }
    }

    // Check Peds
    for (const pd of peds) {
      if (pd.hit) continue;
      const px = pd.strip.axis === 'x' ? pd.t : pd.strip.c;
      const pz = pd.strip.axis === 'x' ? pd.strip.c : pd.t;
      aimTmp.set(px - rayOrig.x, 1.0 - rayOrig.y, pz - rayOrig.z);
      const proj = aimTmp.dot(dir);
      if (proj > 0 && proj < bestDist) {
        const perpSq = aimTmp.lengthSq() - proj * proj;
        if (perpSq < 1.1) {
          bestDist = proj;
          hitType = 'ped';
          hitObj = pd;
        }
      }
    }

    const endPos = rayOrig.clone().addScaledVector(dir, bestDist);
    const startVisual = new THREE.Vector3(player.pos.x + Math.sin(player.heading) * 0.6, player.baseY + 1.32, player.pos.z + Math.cos(player.heading) * 0.6);
    spawnTracer(startVisual, endPos, w.color);

    if (hitType === 'cop') {
      hitObj.hp -= w.dmg;
      dentVehicle(hitObj.veh, endPos, 0.25);
      spawnDebris(endPos.x, endPos.y, endPos.z, 0x94a3b8, 2);
      hooks.addWanted(0.7);
      if (hitObj.hp <= 0) {
        spawnExplosion(hitObj.veh.group.position.x, hitObj.veh.group.position.y, hitObj.veh.group.position.z, 10, 60);
      }
    } else if (hitType === 'npc') {
      hitObj.veh.hp -= w.dmg;
      hitObj.hitTimer = 1.6;
      dentVehicle(hitObj.veh, endPos, 0.22);
      spawnDebris(endPos.x, endPos.y, endPos.z, hitObj.veh.group.userData.paint, 2);
      hooks.addWanted(0.4);
      if (hitObj.veh.hp <= 0 && !hitObj.veh.wrecked) {
        hitObj.veh.wrecked = true;
        spawnExplosion(hitObj.veh.group.position.x, hitObj.veh.group.position.y, hitObj.veh.group.position.z, 9, 40);
      }
    } else if (hitType === 'bounty' && hooks.damageBounty) {
      hooks.damageBounty(w.dmg, endPos);
    } else if (hitType === 'ped') {
      hitObj.hit = true; hitObj.hitT = 2.6; hitObj.vy = 6.5;
      hitObj.vx = dir.x * 6; hitObj.vz = dir.z * 6;
      game.money += 15;
      hooks.addWanted(0.9);
      crashSound(0.4);
    } else if (bestDist < w.range) {
      spawnPuff(endPos.x, endPos.y, endPos.z, 0, 1.5, 0, 2.2, 0.3, 0.9, 0.85, 0.6);
    }
  }

  if (weaponState.clip[idx] === 0 && weaponState.reserve[idx] > 0) {
    startReload(hooks.toast);
  }
}

export function updateWeapons(dt, groundYAt, toast) {
  weaponState.fireCd = Math.max(0, weaponState.fireCd - dt);
  if (weaponState.reloadT > 0) {
    weaponState.reloadT -= dt;
    if (weaponState.reloadT <= 0) {
      const idx = weaponState.idx;
      const w = WEAPONS[idx];
      const need = w.clip - weaponState.clip[idx];
      const take = Math.min(need, weaponState.reserve[idx]);
      weaponState.clip[idx] += take;
      weaponState.reserve[idx] -= take;
      if (toast) toast(w.name + ' reloaded', 1000);
    }
  }

  if (muzzleT > 0) {
    muzzleT -= dt;
    if (muzzleT <= 0) muzzleLight.intensity = 0;
  }

  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    if (t.life <= 0) {
      scene.remove(t.mesh);
      t.mesh.material.dispose();
      tracers.splice(i, 1);
    }
  }

  for (let i = grenades.length - 1; i >= 0; i--) {
    const gr = grenades[i];
    gr.fuse -= dt;
    gr.vel.y -= 20 * dt;
    gr.pos.addScaledVector(gr.vel, dt);
    const gy = groundYAt(gr.pos.x, gr.pos.z) + 0.2;
    if (gr.pos.y < gy) {
      gr.pos.y = gy;
      gr.vel.y *= -0.45;
      gr.vel.x *= 0.65;
      gr.vel.z *= 0.65;
    }
    gr.mesh.position.copy(gr.pos);
    if (gr.fuse <= 0) {
      scene.remove(gr.mesh);
      spawnExplosion(gr.pos.x, gr.pos.y, gr.pos.z, 14, 180);
      grenades.splice(i, 1);
    }
  }
}
