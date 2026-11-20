import * as THREE from 'three';
import { VTYPES } from './state.js';

export const vehicles = [];
export const headSpots = [
  new THREE.SpotLight(0xfff1c9, 0, 58, 0.55, 0.55, 1.1),
  new THREE.SpotLight(0xfff1c9, 0, 58, 0.55, 0.55, 1.1)
];

const CAR_BODY_GEO = new THREE.BoxGeometry(1, 1, 1);
export const coneMat = new THREE.MeshBasicMaterial({
  color: 0xfff2c0,
  transparent: true,
  opacity: 0,
  toneMapped: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending
});
const coneGeo = new THREE.ConeGeometry(1.75, 10, 12, 1, true);
coneGeo.rotateX(Math.PI / 2);

const tireMat = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.92, metalness: 0.05 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4dae3, roughness: 0.25, metalness: 0.88 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x101c2b, roughness: 0.08, metalness: 0.25, clearcoat: 1.0 });
const darkTrimMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.78, metalness: 0.2 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.18, metalness: 0.92 });
const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff4cc, toneMapped: false });

function buildWheel(wr, ww, withRim) {
  const grp = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(wr, wr, ww, 14);
  tireGeo.rotateZ(Math.PI / 2);
  grp.add(new THREE.Mesh(tireGeo, tireMat));
  if (withRim) {
    const rGeo = new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, ww + 0.02, 10);
    rGeo.rotateZ(Math.PI / 2);
    grp.add(new THREE.Mesh(rGeo, rimMat));
  }
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}

export function buildVehicleMesh(paint, type = 'sedan') {
  const T = VTYPES[type] || VTYPES.sedan;
  const g = new THREE.Group();
  const isBoat = !!T.boat;

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paint,
    roughness: type === 'swat' ? 0.58 : 0.24,
    metalness: type === 'swat' ? 0.35 : 0.62,
    clearcoat: type === 'swat' ? 0.15 : 1.0,
    clearcoatRoughness: 0.08
  });

  // Deformable primary body mesh
  const bodyGeo = CAR_BODY_GEO.clone();
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.userData.basePos = bodyGeo.attributes.position.array.slice(0);
  g.userData.paintMat = paintMat;
  g.userData.bodyMesh = body;
  g.userData.paint = paint;
  g.userData.type = type;
  g.userData.T = T;
  g.userData.wheels = [];
  g.userData.frontWheels = [];
  g.userData.tails = [];
  g.userData.cones = [];

  if (isBoat) {
    // Composite 7-part Speedboat / Cano
    body.scale.set(T.wid * 0.88, 0.55, T.len * 0.72);
    body.position.set(0, 0.42, -0.3);
    g.add(body);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(T.wid * 0.46, 2.0, 4), paintMat);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.scale.set(1.25, 0.62, 1);
    bow.position.set(0, 0.44, T.len * 0.36);
    g.add(bow);

    const hullBottom = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.82, 0.28, T.len * 0.82), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
    hullBottom.position.set(0, 0.14, 0);
    g.add(hullBottom);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.72, 0.12, T.len * 0.56), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.75 }));
    deck.position.set(0, 0.7, -0.35);
    g.add(deck);

    const shield = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.74, 0.42, 0.14), glassMat);
    shield.position.set(0, 0.96, 0.65);
    shield.rotation.x = -0.55;
    g.add(shield);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.6, 0.4, 0.55), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 }));
    seat.position.set(0, 0.82, -0.45);
    g.add(seat);

    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.75, 0.55), darkTrimMat);
    motor.position.set(0, 0.58, -T.len * 0.44);
    g.add(motor);

    const navLight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.18), hlMat);
    navLight.position.set(0, 0.75, T.len * 0.45);
    g.add(navLight);

    const tlOff = new THREE.MeshStandardMaterial({ color: 0x441111, roughness: 0.5 });
    const tlOn = new THREE.MeshBasicMaterial({ color: 0xff2222, toneMapped: false });
    g.userData.tailMats = { off: tlOff, on: tlOn };

    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // Ground vehicles
  body.scale.set(T.wid, T.h, T.len);
  body.position.y = 0.54 + T.h / 2;
  g.add(body);

  if (type === 'bike') {
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.75), paintMat);
    tank.position.set(0, 1.06, 0.25);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.07, 0.08), chromeMat);
    bar.position.set(0, 1.18, T.len / 2 - 0.34);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 8), chromeMat);
    fork.position.set(0, 0.75, T.len / 2 - 0.35);
    fork.rotation.x = -0.35;
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 8), chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.24, 0.45, -0.55);
    g.add(tank, bar, fork, exhaust);

    const rider = new THREE.Group();
    const rb = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 3, 8), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 }));
    rb.position.y = 1.18;
    const rh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0xe2e8f0, clearcoat: 1 }));
    rh.position.y = 1.74;
    rider.add(rb, rh);
    g.add(rider);
    g.userData.rider = rider;
  } else {
    // Cabin & Greenhouse
    const cabW = type === 'swat' ? T.wid * 0.94 : T.wid * 0.84;
    const cabH = type === 'supercar' ? 0.44 : type === 'swat' ? 0.75 : type === 'truck' ? 0.8 : 0.58;
    const cabL = type === 'swat' ? T.len * 0.78 : type === 'truck' ? T.len * 0.42 : T.len * 0.5;
    const cabZ = type === 'truck' ? T.len * 0.16 : type === 'swat' ? -T.len * 0.06 : -T.len * 0.05;

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabW, cabH, cabL), type === 'swat' ? paintMat : glassMat);
    cabin.position.set(0, 0.54 + T.h + cabH / 2 - 0.04, cabZ);
    g.add(cabin);

    // Roof cap & trim
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabW * 0.94, 0.09, cabL * 0.9), paintMat);
    roof.position.set(0, 0.54 + T.h + cabH - 0.02, cabZ);
    g.add(roof);

    // Front hood / bumper / grille
    const nose = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.95, 0.34, 0.85), paintMat);
    nose.position.set(0, 0.58, T.len / 2 + 0.06);
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 1.02, 0.22, 0.24), darkTrimMat);
    bumperF.position.set(0, 0.38, T.len / 2 + 0.12);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.52, 0.2, 0.08), chromeMat);
    grille.position.set(0, 0.56, T.len / 2 + 0.46);
    g.add(nose, bumperF, grille);

    // Rear bumper & dual exhaust pipes
    const bumperR = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 1.01, 0.22, 0.22), darkTrimMat);
    bumperR.position.set(0, 0.38, -T.len / 2 - 0.08);
    g.add(bumperR);
    for (const sx of [-0.48, 0.48]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, 0.32, -T.len / 2 - 0.16);
      g.add(pipe);
    }

    // Supercar aerodynamic wing + side intakes
    if (type === 'supercar' || type === 'sport' || type === 'interceptor') {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.92, 0.08, 0.34), darkTrimMat);
      wing.position.set(0, 0.54 + T.h + 0.24, -T.len / 2 + 0.18);
      const stL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.16), darkTrimMat);
      stL.position.set(-T.wid * 0.32, 0.54 + T.h + 0.11, -T.len / 2 + 0.2);
      const stR = stL.clone();
      stR.position.x = T.wid * 0.32;
      g.add(wing, stL, stR);
    }

    // Truck cargo bed
    if (type === 'truck') {
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.94, 1.05, T.len * 0.52), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78 }));
      cargo.position.set(0, 0.54 + T.h + 0.45, -T.len * 0.24);
      g.add(cargo);
    }

    // SWAT armored windshield slit + bullbar + side steps
    if (type === 'swat') {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.8, 0.24, 0.12), glassMat);
      visor.position.set(0, 0.54 + T.h + 0.42, T.len * 0.34);
      const bullbar = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.88, 0.55, 0.18), darkTrimMat);
      bullbar.position.set(0, 0.68, T.len / 2 + 0.24);
      g.add(visor, bullbar);
    }

    // Headlight cones
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(0.6 * s * (T.wid / 1.9), 0.75, T.len / 2 + 5.0);
      cone.visible = false;
      g.add(cone);
      g.userData.cones.push(cone);
    }
  }

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(T.wid * 0.9, 0.28, T.len * 0.94), darkTrimMat);
  skirt.position.y = 0.32;
  g.add(skirt);

  const tlOff = new THREE.MeshStandardMaterial({ color: 0x551111, roughness: 0.5 });
  const tlOn = new THREE.MeshBasicMaterial({ color: 0xff2222, toneMapped: false });
  g.userData.tailMats = { off: tlOff, on: tlOn };

  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.09), hlMat);
    hl.position.set(0.62 * s * (T.wid / 1.9), 0.72, T.len / 2 + 0.04);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.09), tlOff);
    tl.position.set(0.62 * s * (T.wid / 1.9), 0.78, -T.len / 2 - 0.04);
    g.add(hl, tl);
    g.userData.tails.push(tl);
  }

  // Wheels with rims
  const wr = type === 'bike' ? 0.34 : type === 'swat' || type === 'truck' ? 0.48 : 0.42;
  const ww = type === 'bike' ? 0.12 : 0.34;
  const wx = type === 'bike' ? 0 : T.wid / 2 + 0.02;
  const wz = T.len / 2 - 0.75;
  const wpos = type === 'bike' ? [[0, wz], [0, -wz]] : [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]];
  wpos.forEach((wp, i) => {
    const w = buildWheel(wr, ww, type !== 'bike');
    w.position.set(wp[0], wr, wp[1]);
    w.rotation.order = 'YXZ';
    g.add(w);
    g.userData.wheels.push(w);
    if (i < 2 && type !== 'bike') g.userData.frontWheels.push(w);
  });

  // Police / Interceptor / SWAT lightbar
  if (type === 'cop' || type === 'interceptor' || type === 'swat') {
    const barM = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 0.34), darkTrimMat);
    const lr = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222, toneMapped: false }));
    lr.position.x = -0.34;
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: 0x2266ff, toneMapped: false }));
    lb.position.x = 0.34;
    barM.add(base, lr, lb);
    const cabTopY = type === 'swat' ? 0.54 + T.h + 0.78 : 0.54 + T.h + 0.58;
    barM.position.set(0, cabTopY, type === 'swat' ? 0.8 : -0.15);
    g.add(barM);
    g.userData.lightbar = [lr, lb];
  }

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function dentVehicle(v, worldPoint, amount) {
  const body = v.group.userData.bodyMesh;
  if (!body || v.group.userData.type === 'swat') return;
  const local = body.worldToLocal(worldPoint.clone());
  const pos = body.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - local.x;
    const dy = pos.getY(i) - local.y;
    const dz = pos.getZ(i) - local.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1.25) {
      const f = (1 - d / 1.25) * amount;
      pos.setXYZ(
        i,
        pos.getX(i) - dx * 0.24 * f + (Math.random() - 0.5) * 0.06 * f,
        pos.getY(i) - dy * 0.24 * f + (Math.random() - 0.5) * 0.06 * f,
        pos.getZ(i) - dz * 0.24 * f + (Math.random() - 0.5) * 0.06 * f
      );
    }
  }
  pos.needsUpdate = true;
  body.geometry.computeVertexNormals();
}

export function undentVehicle(v) {
  const body = v.group.userData.bodyMesh;
  if (!body || !body.userData.basePos) return;
  body.geometry.attributes.position.array.set(body.userData.basePos);
  body.geometry.attributes.position.needsUpdate = true;
  body.geometry.computeVertexNormals();
}

export function repaintVehicle(v, hex) {
  if (!v || !v.group.userData.paintMat) return;
  v.group.userData.paintMat.color.setHex(hex);
  v.group.userData.paint = hex;
}

export function makeVehicle(scene, paint, type = 'sedan') {
  const g = buildVehicleMesh(paint, type);
  g.position.set(0, -60, 0);
  scene.add(g);
  const v = { group: g, parked: false, npc: null, hp: VTYPES[type].hp, maxHp: VTYPES[type].hp, wrecked: false };
  vehicles.push(v);
  return v;
}

export function attachLights(v) {
  const T = v.group.userData.T;
  const zFront = T.len / 2 - 0.1;
  for (let k = 0; k < 2; k++) {
    const sp = headSpots[k];
    const s = k === 0 ? -1 : 1;
    if (sp.parent) sp.parent.remove(sp);
    v.group.add(sp);
    sp.position.set(0.62 * s, 0.8, zFront);
    if (!sp.target) sp.target = new THREE.Object3D();
    if (sp.target.parent !== v.group) v.group.add(sp.target);
    sp.target.position.set(0.62 * s, 0.2, zFront + 24);
  }
}

export function buildPlayerFootMesh(scene) {
  const foot = new THREE.Group();
  const bm = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.78 });
  const dm = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.75 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.62, 4, 8), jacket);
  body.position.y = 0.94;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
  head.position.y = 1.54;
  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.12), darkTrimMat);
  shades.position.set(0, 1.56, 0.16);
  body.castShadow = head.castShadow = true;

  function mkLimb(mat, len, px, py) {
    const piv = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, len, 0.15), mat);
    m.position.y = -len / 2 + 0.06;
    piv.add(m);
    piv.position.set(px, py, 0);
    return piv;
  }

  const fArmL = mkLimb(bm, 0.62, -0.35, 1.42);
  const fArmR = mkLimb(bm, 0.62, 0.35, 1.42);
  const fLegL = mkLimb(dm, 0.52, -0.15, 0.80);
  const fLegR = mkLimb(dm, 0.52, 0.15, 0.80);

  // Held gun visual on right arm
  const gunGroup = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.42), darkTrimMat);
  gunBody.position.set(0, -0.54, 0.22);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6), chromeMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.52, 0.38);
  gunGroup.add(gunBody, barrel);
  gunGroup.visible = false;
  fArmR.add(gunGroup);

  foot.add(body, head, shades, fArmL, fArmR, fLegL, fLegR);
  foot.visible = false;
  scene.add(foot);
  return { foot, fArmL, fArmR, fLegL, fLegR, gunGroup };
}
