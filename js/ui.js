import {
  RX, RZ, ROADW, RIV_X0, RIV_X1, SEA_X, ISLAND, BRIDGE_JS,
  SHOPS, SHOP_ITEMS, WEAPONS, CAR_PAINTS,
  game, player, missions, fmtTime, clamp, pick, $, show, hide, districtAt
} from './state.js';
import {
  blocks, dockedBoats, shopInteriors, groundYAt
} from './world.js';
import { npcs, cops } from './actors.js';
import { undentVehicle, repaintVehicle } from './vehicles.js';
import { weaponState, currentWeapon } from './weapons.js';
import { horn } from './audio.js';

let toastT = null;
export function flash() {
  const f = $('flash');
  if (!f) return;
  f.style.opacity = 1;
  setTimeout(() => { f.style.opacity = 0; }, 130);
}

export function toast(msg, dur = 2600) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.style.opacity = 0; }, dur);
}

export function updateStars() {
  const n = Math.floor(game.wanted);
  let h = '';
  for (let i = 0; i < 5; i++) {
    h += `<span class="${i < n ? '' : 'off'}">★</span>`;
  }
  const el = $('stars');
  if (el) el.innerHTML = h;
}

export function updateHUD() {
  const hb = $('healthBar');
  if (hb) {
    hb.style.width = clamp(game.health, 0, 100) + '%';
    hb.style.background = game.health > 35
      ? 'linear-gradient(90deg,#22c55e,#84cc16)'
      : 'linear-gradient(90deg,#ef4444,#f59e0b)';
  }

  const aw = $('armorWrap');
  const ab = $('armorBar');
  if (aw && ab) {
    if (game.armor > 0) {
      aw.classList.add('on');
      ab.style.width = clamp(game.armor, 0, 100) + '%';
    } else {
      aw.classList.remove('on');
    }
  }

  const mb = $('moneyBox');
  if (mb) mb.textContent = '$' + game.money;

  const dv = $('distVal');
  if (dv) dv.textContent = Math.floor(game.runDist);

  const tv = $('timeVal');
  if (tv) tv.textContent = fmtTime(game.runTime);

  const dc = $('districtClock');
  if (dc) {
    const mins = Math.floor(game.dayT * 24 * 60);
    const clk = String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
    const distName = game.inInterior ? 'INTERIOR' : districtAt(player.pos.x, player.pos.z);
    dc.textContent = distName + ' · ' + clk;
  }

  // Weapon HUD
  const wn = $('weapName');
  const wa = $('weapAmmo');
  const ws = $('weapSlots');
  if (wn && wa && ws) {
    const w = currentWeapon();
    wn.textContent = w.name;
    if (w.clip <= 0) {
      wa.textContent = 'MELEE';
    } else if (weaponState.reloadT > 0) {
      wa.textContent = 'RELOADING...';
    } else if (w.id === 'grenade') {
      wa.textContent = 'x' + weaponState.reserve[weaponState.idx];
    } else {
      wa.textContent = weaponState.clip[weaponState.idx] + ' / ' + weaponState.reserve[weaponState.idx];
    }
    const slotLabels = WEAPONS.map((wp, i) => {
      if (!weaponState.owned[i]) return '·';
      return i === weaponState.idx ? `[${i + 1}]` : String(i + 1);
    });
    ws.textContent = slotLabels.join(' ') + ' · R RELOAD';
  }

  // Speedometer & Nitro
  const isBoat = player.veh && player.veh.group.userData.type === 'boat' && !game.onFoot;
  const kmh = Math.round(Math.abs(player.speed) * (isBoat ? 1.94 : 3.6));
  const sv = $('speedVal');
  const su = $('speedUnit');
  const gb = $('gearBox');
  if (sv) sv.textContent = kmh;
  if (su) su.textContent = isBoat ? 'KTS' : 'KM/H';
  if (gb) {
    if (game.onFoot) gb.textContent = 'ON FOOT';
    else if (isBoat) gb.textContent = player.vF > 0.5 ? 'MARINE' : player.vF < -0.5 ? 'REV' : 'IDLE';
    else gb.textContent = player.vF < -0.5 ? 'R' : kmh < 2 ? 'N' : 'D' + Math.min(6, Math.floor(kmh / 32) + 1);
  }

  const nw = $('nosWrap');
  const nb = $('nosBar');
  if (nw && nb) {
    nw.classList.toggle('on', game.upgrades.nitro && !game.onFoot);
    nb.style.width = clamp(game.nosFuel, 0, 100) + '%';
  }

  // Crosshair
  const ch = $('crosshair');
  if (ch) {
    const showCh = game.state === 'playing' && !game.shopOpen && !game.phoneOpen && (game.onFoot || weaponState.idx > 0);
    ch.classList.toggle('on', showCh);
  }

  updateStars();
}

// --- Static Pre-rendered Map Layer (4 Districts + River + Bridges + Sea + Island) ---
const MAP_MIN_X = RX[0] - 35;
const MAP_MAX_X = ISLAND.x + ISLAND.r + 45;
const MAP_MIN_Z = RZ[0] - 35;
const MAP_MAX_Z = RZ[RZ.length - 1] + 35;
const MAP_SPAN_X = MAP_MAX_X - MAP_MIN_X;
const MAP_SPAN_Z = MAP_MAX_Z - MAP_MIN_Z;

const mmStatic = document.createElement('canvas');
mmStatic.width = 480;
mmStatic.height = 400;
{
  const g = mmStatic.getContext('2d');
  const sx = mmStatic.width / MAP_SPAN_X;
  const sz = mmStatic.height / MAP_SPAN_Z;
  const tx = x => (x - MAP_MIN_X) * sx;
  const tz = z => (z - MAP_MIN_Z) * sz;

  // Base terrain & ocean
  g.fillStyle = '#1b2622';
  g.fillRect(0, 0, mmStatic.width, mmStatic.height);

  // River strip
  g.fillStyle = '#0e5d8f';
  g.fillRect(tx(RIV_X0), 0, (RIV_X1 - RIV_X0) * sx, mmStatic.height);

  // Pacific Sea
  g.fillRect(tx(SEA_X), 0, mmStatic.width - tx(SEA_X), mmStatic.height);

  // Island
  g.fillStyle = '#e3cf94';
  g.beginPath();
  g.arc(tx(ISLAND.x), tz(ISLAND.z), ISLAND.r * sx, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#528a4f';
  g.beginPath();
  g.arc(tx(ISLAND.x), tz(ISLAND.z), (ISLAND.r - 12) * sx, 0, Math.PI * 2);
  g.fill();

  // City blocks colored by district
  for (const b of blocks) {
    if (b.type === 'water') continue;
    g.fillStyle = b.type === 'park' ? '#3f7f48'
      : b.type === 'beach' ? '#d8c589'
      : b.type === 'suburbs' ? '#567853'
      : b.type === 'industrial' ? '#6b6257'
      : b.type === 'seaport' ? '#6e7c8a'
      : b.type === 'plaza' ? '#9aa5b5'
      : '#4b5563';
    g.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * sx, (b.maxZ - b.minZ) * sz);
  }

  // Roads
  g.fillStyle = '#1e242d';
  for (const rx of RX) {
    if (rx > RIV_X0 && rx < RIV_X1) continue;
    g.fillRect(tx(rx - ROADW / 2), tz(RZ[0] - ROADW / 2), ROADW * sx, (RZ[RZ.length - 1] - RZ[0] + ROADW) * sz);
  }
  for (let j = 0; j < RZ.length; j++) {
    const rz = RZ[j];
    const isBr = BRIDGE_JS.includes(j);
    if (isBr) {
      g.fillStyle = '#252c36';
      g.fillRect(tx(RX[0] - ROADW / 2), tz(rz - ROADW / 2), (RX[RX.length - 1] - RX[0] + ROADW) * sx, ROADW * sz);
    } else {
      g.fillStyle = '#1e242d';
      g.fillRect(tx(RX[0] - ROADW / 2), tz(rz - ROADW / 2), (RIV_X0 - RX[0] + ROADW / 2) * sx, ROADW * sz);
      g.fillRect(tx(RIV_X1), tz(rz - ROADW / 2), (RX[RX.length - 1] - RIV_X1 + ROADW / 2) * sx, ROADW * sz);
    }
  }
}

export function drawMapTo(cvs, full) {
  if (!cvs) return;
  const g = cvs.getContext('2d');
  const W = cvs.width;
  const H = cvs.height;
  g.clearRect(0, 0, W, H);
  const px = game.inInterior ? game.inInterior.outPos.x : player.pos.x;
  const pz = game.inInterior ? game.inInterior.outPos.z : player.pos.z;

  const mapPt = (wx, wz) => {
    if (full) {
      return [
        ((wx - MAP_MIN_X) / MAP_SPAN_X) * W,
        ((wz - MAP_MIN_Z) / MAP_SPAN_Z) * H
      ];
    }
    const zScale = 0.56;
    return [W / 2 + (wx - px) * zScale, H / 2 + (wz - pz) * zScale];
  };

  if (full) {
    g.drawImage(mmStatic, 0, 0, W, H);
  } else {
    g.fillStyle = '#0c111a';
    g.fillRect(0, 0, W, H);
    const zScale = 0.56;
    const dx = (MAP_MIN_X - px) * zScale + W / 2;
    const dz = (MAP_MIN_Z - pz) * zScale + H / 2;
    g.drawImage(mmStatic, dx, dz, MAP_SPAN_X * zScale, MAP_SPAN_Z * zScale);
  }

  // Shop icons
  for (const s of SHOPS) {
    const [x, y] = mapPt(s.x, s.z);
    g.fillStyle = '#' + s.color.toString(16).padStart(6, '0');
    g.fillRect(x - 3.5, y - 3.5, 7, 7);
  }

  // Docked Boats
  g.fillStyle = '#38bdf8';
  for (const b of dockedBoats) {
    if (!b.group.visible) continue;
    const [x, y] = mapPt(b.group.position.x, b.group.position.z);
    g.beginPath(); g.arc(x, y, 2.8, 0, Math.PI * 2); g.fill();
  }

  // NPC traffic
  g.fillStyle = '#cbd5e1';
  for (const n of npcs) {
    if (!n.active) continue;
    const [x, y] = mapPt(n.veh.group.position.x, n.veh.group.position.z);
    g.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  // Police / SWAT units
  const blink = (game.simTime * 6) % 2 > 1;
  g.fillStyle = blink ? '#ef4444' : '#3b82f6';
  for (const c of cops) {
    if (!c.active) continue;
    const [x, y] = mapPt(c.veh.group.position.x, c.veh.group.position.z);
    g.fillRect(x - 3, y - 3, 6, 6);
  }

  // Active Mission Marker
  if (missions.active) {
    const [mx, my] = mapPt(missions.target.x, missions.target.z);
    g.strokeStyle = '#f59e0b';
    g.lineWidth = 2;
    g.beginPath(); g.arc(mx, my, 5.5, 0, Math.PI * 2); g.stroke();
    if (!full && (mx < 4 || mx > W - 4 || my < 4 || my > H - 4)) {
      const a = Math.atan2(my - H / 2, mx - W / 2);
      const ex = clamp(W / 2 + Math.cos(a) * (W / 2 - 9), 7, W - 7);
      const ey = clamp(H / 2 + Math.sin(a) * (H / 2 - 9), 7, H - 7);
      g.fillStyle = '#f59e0b';
      g.beginPath(); g.arc(ex, ey, 4.5, 0, Math.PI * 2); g.fill();
    }
  }

  // Player Arrow
  const [ax, ay] = mapPt(px, pz);
  g.save();
  g.translate(ax, ay);
  g.rotate(-player.heading + Math.PI);
  g.fillStyle = '#22c55e';
  g.beginPath();
  g.moveTo(0, -6.5);
  g.lineTo(4.5, 5);
  g.lineTo(-4.5, 5);
  g.closePath();
  g.fill();
  g.restore();
}

export function drawMinimap() { drawMapTo($('minimap'), false); }
export function drawBigMap() { drawMapTo($('mapBig'), true); }

export function openShop(def) {
  game.shopOpen = true;
  game.curShop = def;
  const st = $('shopTitle');
  if (st) st.textContent = def.name || 'SHOP';
  if (document.pointerLockElement) document.exitPointerLock();
  renderShop();
  show($('shopPanel'));
}

export function closeShop() {
  game.shopOpen = false;
  hide($('shopPanel'));
}

export function renderShop() {
  const sm = $('shopMoney');
  if (sm) sm.textContent = 'Cash: $' + game.money;
  const list = SHOP_ITEMS[game.curShop.kind] || SHOP_ITEMS.coffee;
  const box = $('shopItems');
  if (!box) return;
  box.innerHTML = '';

  for (const it of list) {
    const owned = (it.id === 'nitro' && game.upgrades.nitro)
      || (it.id === 'ram' && game.upgrades.ram);
    const d = document.createElement('div');
    d.className = 'shopItem';
    d.innerHTML = `<div><div class="nm">${it.nm}</div><div class="ds">${it.ds}</div></div>
      <div style="display:flex;align-items:center;gap:10px"><span class="pr">$${it.pr}</span>
      <button class="btn buy" ${owned || game.money < it.pr ? 'disabled' : ''}>${owned ? 'OWNED' : 'BUY'}</button></div>`;
    d.querySelector('button').onclick = () => buyItem(it);
    box.appendChild(d);
  }

  const ext = $('shopExtras');
  if (ext) {
    ext.innerHTML = '';
    if (game.curShop.kind === 'garage') {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-family:Orbitron;font-size:11px;color:#38bdf8;margin-top:12px;letter-spacing:1px';
      lbl.textContent = 'PAY & SPRAY COLOR ($40 — COOLS WANTED)';
      ext.appendChild(lbl);
      const row = document.createElement('div');
      row.className = 'swatchRow';
      for (const hex of CAR_PAINTS) {
        const sw = document.createElement('button');
        sw.className = 'swatch';
        sw.style.background = '#' + hex.toString(16).padStart(6, '0');
        sw.title = 'Paint Vehicle ($40)';
        sw.onclick = () => {
          if (game.money < 40) { toast('Need $40'); return; }
          if (!player.veh) { toast('No vehicle nearby'); return; }
          game.money -= 40;
          repaintVehicle(player.veh, hex);
          undentVehicle(player.veh);
          player.veh.hp = player.veh.maxHp;
          player.veh.wrecked = false;
          game.wanted = Math.max(0, game.wanted - 1.5);
          updateHUD();
          renderShop();
          toast('Resprayed!');
          horn(520);
        };
        row.appendChild(sw);
      }
      ext.appendChild(row);
    }
  }
}

export function buyItem(it) {
  if (game.money < it.pr) return;
  game.money -= it.pr;

  if (it.id === 'pistol') {
    weaponState.owned[1] = true;
    weaponState.reserve[1] = Math.min(WEAPONS[1].res + 24, weaponState.reserve[1] + 48);
    weaponState.idx = 1;
    toast('Bought Pistol + Ammo');
  } else if (it.id === 'smg') {
    weaponState.owned[2] = true;
    weaponState.reserve[2] = Math.min(WEAPONS[2].res + 60, weaponState.reserve[2] + 120);
    weaponState.idx = 2;
    toast('Bought SMG + Ammo');
  } else if (it.id === 'shotgun') {
    weaponState.owned[3] = true;
    weaponState.reserve[3] = Math.min(WEAPONS[3].res + 16, weaponState.reserve[3] + 32);
    weaponState.idx = 3;
    toast('Bought Combat Shotgun');
  } else if (it.id === 'grenade') {
    weaponState.owned[4] = true;
    weaponState.reserve[4] += 4;
    weaponState.idx = 4;
    toast('Bought 4 Grenades');
  } else if (it.id === 'ammo') {
    for (let i = 1; i < WEAPONS.length; i++) {
      if (weaponState.owned[i]) {
        weaponState.reserve[i] = Math.max(weaponState.reserve[i], WEAPONS[i].res);
        weaponState.clip[i] = WEAPONS[i].clip;
      }
    }
    toast('All Owned Ammo Refilled');
  } else if (it.id === 'vest') {
    game.armor = 100;
    game.upgrades.armor = true;
    toast('Kevlar Armor Equipped');
  } else if (it.id === 'nitro') {
    game.upgrades.nitro = true;
    game.nosFuel = 100;
    toast('Nitro Installed (SHIFT)');
  } else if (it.id === 'ram') {
    game.upgrades.ram = true;
    toast('Reinforced Ram Installed');
  } else if (it.id === 'coffee') {
    game.health = Math.min(100, game.health + 25);
    toast('+25 HP');
  } else if (it.id === 'donut') {
    game.health = Math.min(100, game.health + 15);
    toast('+15 HP');
  } else if (it.id === 'cig') {
    game.smokeT = 14;
    game.smokeTick = 0;
    game.wanted = Math.max(0, game.wanted - 0.8);
    toast('Cooled down wanted heat');
  } else if (it.id === 'energy') {
    game.nosFuel = 100;
    toast('Nitro Full');
  } else if (it.id === 'repair') {
    if (player.veh) {
      player.veh.hp = player.veh.maxHp;
      player.veh.wrecked = false;
      undentVehicle(player.veh);
    }
    game.health = Math.min(100, game.health + 30);
    toast('Vehicle Repaired');
  } else if (it.id === 'payspray') {
    game.wanted = 0;
    for (const c of cops) { c.active = false; c.veh.group.visible = false; }
    if (player.veh) {
      repaintVehicle(player.veh, pick(CAR_PAINTS));
      undentVehicle(player.veh);
      player.veh.hp = player.veh.maxHp;
      player.veh.wrecked = false;
    }
    toast('Pay & Spray — Wanted Stars Cleared!');
    horn(520);
  }

  updateHUD();
  renderShop();
}

export function togglePhone() {
  if (game.state !== 'playing' || game.shopOpen) return;
  game.phoneOpen = !game.phoneOpen;
  if (game.phoneOpen) {
    if (document.pointerLockElement) document.exitPointerLock();
    const wl = $('weatherLabel');
    if (wl) wl.textContent = game.weather.rain ? 'Storm' : 'Clear';
    const rl = $('radioLabel');
    if (rl) rl.textContent = game.radioOn ? 'ON AIR' : 'OFF';
    show($('phonePanel'));
    drawBigMap();
  } else {
    hide($('phonePanel'));
  }
}

export function refreshBestLine() {
  const bl = $('bestLine');
  if (bl) {
    bl.textContent = game.best.dist > 0
      ? `BEST: ${Math.floor(game.best.dist)} m · ${fmtTime(game.best.time)}`
      : '';
  }
}
