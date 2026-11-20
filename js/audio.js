import { game, player, keys, touch, clamp, $ } from './state.js';

export const audio = { ctx: null, started: false };
let lastCrashSnd = 0;
let radioTimer = null;
let radioStep = 0;
const PENT = [220, 261.6, 293.7, 329.6, 392, 440, 523.2];

export function initAudio() {
  if (audio.started) return;
  try {
    const C = new (window.AudioContext || window.webkitAudioContext)();
    audio.ctx = C;
    const master = C.createGain();
    master.gain.value = 0.45;
    master.connect(C.destination);
    audio.master = master;

    audio.engFilter = C.createBiquadFilter();
    audio.engFilter.type = 'lowpass';
    audio.engFilter.frequency.value = 420;
    audio.engGain = C.createGain();
    audio.engGain.gain.value = 0;
    audio.engOsc = C.createOscillator();
    audio.engOsc.type = 'sawtooth';
    audio.engOsc.frequency.value = 55;
    audio.engOsc2 = C.createOscillator();
    audio.engOsc2.type = 'square';
    audio.engOsc2.frequency.value = 28;
    const g2 = C.createGain();
    g2.gain.value = 0.5;
    audio.engOsc.connect(audio.engFilter);
    audio.engOsc2.connect(g2);
    g2.connect(audio.engFilter);
    audio.engFilter.connect(audio.engGain);
    audio.engGain.connect(master);
    audio.engOsc.start();
    audio.engOsc2.start();

    const len = C.sampleRate;
    const buf = C.createBuffer(1, len, C.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    audio.noiseBuf = buf;

    const skid = C.createBufferSource();
    skid.buffer = buf;
    skid.loop = true;
    const bp = C.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 880;
    bp.Q.value = 0.9;
    audio.skidGain = C.createGain();
    audio.skidGain.gain.value = 0;
    skid.connect(bp);
    bp.connect(audio.skidGain);
    audio.skidGain.connect(master);
    skid.start();

    const rn = C.createBufferSource();
    rn.buffer = buf;
    rn.loop = true;
    const hp = C.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    audio.rainGain = C.createGain();
    audio.rainGain.gain.value = 0;
    rn.connect(hp);
    hp.connect(audio.rainGain);
    audio.rainGain.connect(master);
    rn.start();

    // Subtle police siren oscillator when wanted >= 1
    audio.sirenOsc = C.createOscillator();
    audio.sirenOsc.type = 'triangle';
    audio.sirenOsc.frequency.value = 620;
    audio.sirenGain = C.createGain();
    audio.sirenGain.gain.value = 0;
    audio.sirenOsc.connect(audio.sirenGain);
    audio.sirenGain.connect(master);
    audio.sirenOsc.start();

    audio.started = true;
  } catch (e) {
    console.warn('audio unavailable', e);
  }
}

export function updateEngineAudio() {
  if (!audio.started || !audio.ctx) return;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    const isBoat = player.veh && player.veh.group.userData.type === 'boat';
    const sn = clamp(Math.abs(player.vF) / (isBoat ? 46 : 55), 0, 1);
    const thr = (keys.gas || touch.gas) ? 1 : 0;
    const gear = Math.min(5, Math.floor(sn * 6));
    const fr = sn * 6 - gear;
    const baseF = game.onFoot ? 40 : isBoat ? 64 : 48;
    const f = baseF + gear * 16 + fr * 55 + thr * 11;
    audio.engOsc.frequency.setTargetAtTime(f, t, 0.05);
    audio.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    audio.engFilter.frequency.setTargetAtTime(300 + sn * 1100 + thr * 280, t, 0.08);
    audio.engGain.gain.setTargetAtTime(
      game.state === 'playing' ? (game.onFoot ? 0.014 : 0.036 + 0.085 * thr + sn * 0.04) : 0,
      t,
      0.09
    );
    audio.skidGain.gain.setTargetAtTime(player.drifting && !isBoat ? 0.16 : 0, t, 0.07);
    audio.rainGain.gain.setTargetAtTime(game.weather.intensity * 0.12, t, 0.4);

    // Police wail when wanted >= 1 and outdoors
    const sirenOn = game.state === 'playing' && game.wanted >= 1 && !game.inInterior && !game.shopOpen;
    if (sirenOn) {
      const wail = 640 + Math.sin(game.simTime * 5.2) * 240;
      audio.sirenOsc.frequency.setTargetAtTime(wail, t, 0.05);
      audio.sirenGain.gain.setTargetAtTime(0.028 + Math.min(0.03, game.wanted * 0.006), t, 0.15);
    } else {
      audio.sirenGain.gain.setTargetAtTime(0, t, 0.12);
    }
  } catch (e) {}
}

export function horn(pitch = 400) {
  if (!audio.started || !audio.ctx) return;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    for (const p of [pitch, pitch * 1.19]) {
      const o = C.createOscillator();
      o.type = 'square';
      o.frequency.value = p;
      const g = C.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g);
      g.connect(audio.master);
      o.start(t);
      o.stop(t + 0.5);
    }
  } catch (e) {}
}

export function crashSound(power = 0.7) {
  if (!audio.started || !audio.ctx) return;
  const now = performance.now();
  if (now - lastCrashSnd < 140) return;
  lastCrashSnd = now;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    const s = C.createBufferSource();
    s.buffer = audio.noiseBuf;
    const lp = C.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 280 + power * 340;
    const g = C.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.18 + power * 0.25), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(lp);
    lp.connect(g);
    g.connect(audio.master);
    s.start(t);
    s.stop(t + 0.4);

    const o = C.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    const og = C.createGain();
    og.gain.setValueAtTime(0.32 * power, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og);
    og.connect(audio.master);
    o.start(t);
    o.stop(t + 0.32);
  } catch (e) {}
}

export function gunSound(id) {
  if (!audio.started || !audio.ctx) return;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    const s = C.createBufferSource();
    s.buffer = audio.noiseBuf;
    const bp = C.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = id === 'shotgun' ? 520 : id === 'smg' ? 1400 : 1050;
    bp.Q.value = id === 'shotgun' ? 0.6 : 1.1;
    const g = C.createGain();
    const vol = id === 'shotgun' ? 0.42 : id === 'smg' ? 0.22 : 0.3;
    const dur = id === 'shotgun' ? 0.26 : 0.13;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(bp);
    bp.connect(g);
    g.connect(audio.master);
    s.start(t);
    s.stop(t + dur + 0.02);

    const o = C.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(id === 'shotgun' ? 150 : 210, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = C.createGain();
    og.gain.setValueAtTime(vol * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og);
    og.connect(audio.master);
    o.start(t);
    o.stop(t + 0.11);
  } catch (e) {}
}

export function explosionSound() {
  if (!audio.started || !audio.ctx) return;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    const s = C.createBufferSource();
    s.buffer = audio.noiseBuf;
    const lp = C.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(650, t);
    lp.frequency.exponentialRampToValueAtTime(95, t + 0.9);
    const g = C.createGain();
    g.gain.setValueAtTime(0.65, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    s.connect(lp);
    lp.connect(g);
    g.connect(audio.master);
    s.start(t);
    s.stop(t + 1.0);

    const o = C.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.55);
    const og = C.createGain();
    og.gain.setValueAtTime(0.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(og);
    og.connect(audio.master);
    o.start(t);
    o.stop(t + 0.65);
  } catch (e) {}
}

export function reloadSound() {
  if (!audio.started || !audio.ctx) return;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    for (const dt of [0, 0.14]) {
      const o = C.createOscillator();
      o.type = 'square';
      o.frequency.value = dt === 0 ? 520 : 760;
      const g = C.createGain();
      g.gain.setValueAtTime(0.08, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.05);
      o.connect(g);
      g.connect(audio.master);
      o.start(t + dt);
      o.stop(t + dt + 0.06);
    }
  } catch (e) {}
}

function radioTick() {
  if (!audio.started || !game.radioOn) return;
  try {
    const C = audio.ctx;
    const t = C.currentTime;
    const bass = [98, 98, 130.8, 110, 87.3, 87.3, 110, 123.5][radioStep % 8];
    const o = C.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = bass;
    const lp = C.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const g = C.createGain();
    g.gain.setValueAtTime(0.075, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
    o.connect(lp);
    lp.connect(g);
    g.connect(audio.master);
    o.start(t);
    o.stop(t + 0.23);

    if (radioStep % 2 === 0) {
      const l = C.createOscillator();
      l.type = 'triangle';
      l.frequency.value = PENT[(radioStep * 3 + Math.floor(Math.random() * 2)) % PENT.length];
      const lg = C.createGain();
      lg.gain.setValueAtTime(0.05, t);
      lg.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      l.connect(lg);
      lg.connect(audio.master);
      l.start(t);
      l.stop(t + 0.28);
    }
    radioStep++;
  } catch (e) {}
}

export function setRadio(on) {
  game.radioOn = on;
  if (!audio.started) return;
  if (on && !radioTimer) radioTimer = setInterval(radioTick, 175);
  if (!on && radioTimer) {
    clearInterval(radioTimer);
    radioTimer = null;
  }
  const lbl = $('radioLabel');
  if (lbl) lbl.textContent = on ? 'ON AIR' : 'OFF';
}
