import * as THREE from 'three';
import {
  RX, RZ, RIV_X0, RIV_X1, SEA_X, ISLAND, game, player, missions, pick, R, $
} from './state.js';
import { scene, bridgeDeckY } from './world.js';
import { roadPoint, spawnPuff, spawnExplosion } from './actors.js';
import { makeVehicle, dentVehicle } from './vehicles.js';

const beacon = new THREE.Group();
{
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.7, 16, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.34, toneMapped: false, side: THREE.DoubleSide, depthWrite: false })
  );
  cyl.position.y = 8;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 2.8, 24),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, toneMapped: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  beacon.add(cyl, ring);
  beacon.visible = false;
  scene.add(beacon);
}

function waterPoint() {
  const spots = [
    new THREE.Vector3((RIV_X0 + RIV_X1) / 2, -0.8, R(-260, 260)),
    new THREE.Vector3(SEA_X + 95, -0.8, R(-220, 220)),
    new THREE.Vector3(ISLAND.x - ISLAND.r - 22, -0.8, ISLAND.z + R(-40, 40)),
    new THREE.Vector3(SEA_X + 130, -0.8, R(-160, 160))
  ];
  return pick(spots);
}

export function startMission(toast) {
  const isBoatNow = player.veh && player.veh.group.userData.type === 'boat' && !game.onFoot;
  const pool = isBoatNow
    ? ['boat', 'boat', 'delivery']
    : ['delivery', 'collect', 'race', 'bounty', 'getaway', 'boat'];
  const type = pick(pool);
  missions.type = type;
  missions.got = 0;
  missions.active = true;

  for (const p of missions.pickups) scene.remove(p);
  missions.pickups = [];
  if (missions.bountyVeh) {
    missions.bountyVeh.group.visible = false;
    missions.bountyVeh = null;
  }

  if (type === 'delivery') {
    missions.target.copy(roadPoint(110));
    missions.timer = 22 + player.pos.distanceTo(missions.target) / 11;
    missions.reward = 140 + Math.floor(player.pos.distanceTo(missions.target) * 0.4);
  } else if (type === 'collect') {
    missions.timer = 68;
    missions.reward = 240;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.2, 1.2),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.85 })
      );
      const p = roadPoint(55);
      m.position.set(p.x, 1.2, p.z);
      scene.add(m);
      missions.pickups.push(m);
    }
    missions.target.copy(missions.pickups[0].position);
  } else if (type === 'race') {
    missions.timer = 75;
    missions.reward = 320;
    missions.target.copy(roadPoint(90));
  } else if (type === 'bounty') {
    missions.timer = 85;
    missions.reward = 420;
    const p = roadPoint(70, 140);
    const bv = makeVehicle(scene, 0xdc2626, 'supercar');
    bv.group.position.set(p.x, bridgeDeckY(p.x, p.z), p.z);
    bv.group.visible = true;
    missions.bountyVeh = bv;
    missions.bountyHp = 180;
    missions.target.copy(p);
  } else if (type === 'boat') {
    missions.timer = 85;
    missions.reward = 360;
    missions.target.copy(waterPoint());
  } else {
    // Getaway heat
    missions.timer = 38;
    missions.reward = 380;
    game.wanted = Math.max(game.wanted, 2.2);
    missions.target.copy(player.pos);
  }

  beacon.position.set(missions.target.x, Math.max(0, missions.target.y), missions.target.z);
  beacon.visible = type !== 'getaway';

  const names = {
    delivery: 'EXPRESS DELIVERY',
    collect: 'COLLECT 3 CARGO CRATES',
    race: 'STREET RACE (4 CHECKPOINTS)',
    bounty: 'BOUNTY TAKEDOWN (WRECK TARGET CAR)',
    boat: 'HARBOR BOAT RUN (3 BUOYS)',
    getaway: 'GETAWAY HEAT (SURVIVE PURSUIT)'
  };
  if (toast) toast('MISSION: ' + names[type] + ' ($' + missions.reward + ')', 4200);
}

export function checkBountyShot(rayOrig, dir, bestDist) {
  if (!missions.active || missions.type !== 'bounty' || !missions.bountyVeh) return null;
  const g = missions.bountyVeh.group;
  const dx = g.position.x - rayOrig.x;
  const dy = g.position.y + 0.8 - rayOrig.y;
  const dz = g.position.z - rayOrig.z;
  const proj = dx * dir.x + dy * dir.y + dz * dir.z;
  if (proj > 0 && proj < bestDist) {
    const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
    if (perpSq < 4.5) return { dist: proj, veh: missions.bountyVeh };
  }
  return null;
}

export function damageBounty(dmg, pos, toast) {
  if (!missions.active || missions.type !== 'bounty' || !missions.bountyVeh) return;
  missions.bountyHp -= dmg;
  if (pos) dentVehicle(missions.bountyVeh, pos, 0.3);
  if (missions.bountyHp <= 0) {
    const g = missions.bountyVeh.group;
    spawnExplosion(g.position.x, g.position.y, g.position.z, 10, 50);
    g.visible = false;
    missions.bountyVeh = null;
    completeMission(toast);
  }
}

export function completeMission(toast) {
  game.money += missions.reward;
  if (toast) toast('MISSION COMPLETE +$' + missions.reward);
  missions.active = false;
  beacon.visible = false;
  missions.cooldown = 8;
  for (const p of missions.pickups) scene.remove(p);
  missions.pickups = [];
  if (missions.bountyVeh) { missions.bountyVeh.group.visible = false; missions.bountyVeh = null; }
  const mb = $('missionBox');
  if (mb) mb.classList.remove('on');
}

export function missionUpdate(dt, toast) {
  if (game.inInterior || game.shopOpen || game.phoneOpen) return;
  missions.cooldown -= dt;
  if (!missions.active) {
    if (missions.cooldown <= 0) startMission(toast);
    return;
  }
  missions.timer -= dt;
  beacon.children[1].rotation.z += dt * 2.2;
  for (const m of missions.pickups) m.rotation.y += dt * 3;

  if (missions.type === 'bounty' && missions.bountyVeh) {
    // Move bounty target along avenues away from player
    const bv = missions.bountyVeh;
    const g = bv.group;
    const dx = g.position.x - player.pos.x;
    const dz = g.position.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const ang = Math.atan2(dx, dz) + Math.sin(game.simTime * 0.7) * 0.45;
    g.position.x += Math.sin(ang) * 18 * dt;
    g.position.z += Math.cos(ang) * 18 * dt;
    g.position.x = THREE.MathUtils.clamp(g.position.x, RX[1], RX[11]);
    g.position.z = THREE.MathUtils.clamp(g.position.z, RZ[1], RZ[11]);
    g.position.y = bridgeDeckY(g.position.x, g.position.z);
    g.rotation.y = ang;
    missions.target.copy(g.position);
    beacon.position.set(g.position.x, g.position.y, g.position.z);
    if (!game.onFoot && d < 3.6 && player.speed > 10) {
      damageBounty(player.speed * 2.4, g.position, toast);
    }
  } else if (missions.type === 'getaway') {
    if (missions.timer <= 0) return completeMission(toast);
  } else {
    const d = Math.hypot(player.pos.x - missions.target.x, player.pos.z - missions.target.z);
    if (missions.type === 'collect') {
      for (const m of missions.pickups) {
        if (!m.visible) continue;
        if (Math.hypot(player.pos.x - m.position.x, player.pos.z - m.position.z) < 3.5) {
          m.visible = false;
          missions.got++;
          game.money += 25;
          spawnPuff(m.position.x, 1.5, m.position.z, 0, 2, 0, 6, 0.8, 1, 0.85, 0.2);
          const next = missions.pickups.find(q => q.visible);
          if (next) {
            missions.target.copy(next.position);
            beacon.position.set(next.position.x, 0, next.position.z);
          }
        }
      }
      if (missions.got >= 3) return completeMission(toast);
    } else if (d < 5.2) {
      if (missions.type === 'race') {
        missions.got++;
        if (missions.got >= 4) return completeMission(toast);
        missions.target.copy(roadPoint(75));
        missions.timer += 15;
        beacon.position.set(missions.target.x, 0, missions.target.z);
        if (toast) toast('CHECKPOINT ' + missions.got + '/4');
      } else if (missions.type === 'boat') {
        missions.got++;
        if (missions.got >= 3) return completeMission(toast);
        missions.target.copy(waterPoint());
        missions.timer += 18;
        beacon.position.set(missions.target.x, 0, missions.target.z);
        if (toast) toast('BUOY ' + missions.got + '/3');
      } else {
        return completeMission(toast);
      }
    }
  }

  if (missions.timer <= 0 && missions.type !== 'getaway') {
    missions.active = false;
    beacon.visible = false;
    missions.cooldown = 7;
    if (missions.bountyVeh) { missions.bountyVeh.group.visible = false; missions.bountyVeh = null; }
    if (toast) toast('MISSION FAILED');
    const mb = $('missionBox');
    if (mb) mb.classList.remove('on');
  }
}

export function missionHUD() {
  const mb = $('missionBox');
  if (!mb) return;
  if (missions.active) {
    mb.classList.add('on');
    const lbl = {
      delivery: 'DELIVERY',
      collect: 'CRATES ' + missions.got + '/3',
      race: 'RACE ' + missions.got + '/4',
      bounty: 'BOUNTY HP ' + Math.max(0, Math.ceil(missions.bountyHp)),
      boat: 'HARBOR BUOY ' + missions.got + '/3',
      getaway: 'SURVIVE HEAT'
    }[missions.type];
    mb.textContent = lbl + ' · ' + Math.ceil(missions.timer) + 's · $' + missions.reward;
  } else {
    mb.classList.remove('on');
  }
}
