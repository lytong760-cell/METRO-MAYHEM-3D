import * as THREE from 'three';
import { R } from './state.js';

let maxAniso = 4;
export function setMaxAnisotropy(n) {
  maxAniso = Math.max(1, Math.min(8, n || 4));
}

export function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

export function glowTex(col) {
  return canvasTex(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, col);
    gr.addColorStop(0.42, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  });
}

export function asphaltTex() {
  const t = canvasTex(256, 256, g => {
    g.fillStyle = '#232730';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2400; i++) {
      const v = 28 + ((Math.random() * 22) | 0);
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(28, 0, 12, 256);
    g.fillRect(216, 0, 12, 256);
  }, true);
  t.repeat.set(1, 24);
  return t;
}

export function concreteTex() {
  const t = canvasTex(128, 128, g => {
    g.fillStyle = '#9aa1ab';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  }, true);
  t.repeat.set(4, 4);
  return t;
}

export function buildingTexture(v) {
  return canvasTex(128, 256, g => {
    g.fillStyle = v.base;
    g.fillRect(0, 0, 128, 256);
    if (v.style === 'glass') {
      const cols = 6, rows = 16, mw = 128 / cols, mh = 256 / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = Math.random() < v.lit;
          g.fillStyle = lit ? (Math.random() < 0.6 ? '#ffe4a3' : '#bfe8ff') : v.win;
          g.fillRect(c * mw + 2, r * mh + 2, mw - 4, mh - 4);
        }
        g.fillStyle = 'rgba(15,23,42,0.45)';
        g.fillRect(0, r * mh, 128, 2);
      }
    } else if (v.style === 'industrial') {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let x = 0; x < 128; x += 8) g.fillRect(x, 0, 3, 256);
      for (let c = 0; c < 4; c++) {
        g.fillStyle = Math.random() < 0.35 ? '#fcd34d' : '#1e293b';
        g.fillRect(10 + c * 30, 56, 20, 22);
      }
      g.fillStyle = '#334155';
      g.fillRect(16, 178, 96, 78);
      g.strokeStyle = '#64748b';
      for (let y = 186; y < 254; y += 10) g.strokeRect(18, y, 92, 6);
    } else if (v.style === 'suburb') {
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let y = 0; y < 256; y += 12) g.fillRect(0, y, 128, 2);
      const cols = 3, rows = 4, mw = 128 / cols, mh = 220 / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          g.fillStyle = '#f8fafc';
          g.fillRect(c * mw + 10, 14 + r * mh + 10, mw - 20, mh - 24);
          g.fillStyle = Math.random() < v.lit ? '#fde68a' : v.win;
          g.fillRect(c * mw + 13, 14 + r * mh + 13, mw - 26, mh - 30);
        }
      }
    } else {
      const cols = 5, rows = 13, mw = 128 / cols, mh = 256 / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          g.fillStyle = Math.random() < v.lit ? (Math.random() < 0.5 ? '#ffd98a' : '#bfe3ff') : v.win;
          g.fillRect(c * mw + mw * 0.2, r * mh + mh * 0.18, mw * 0.6, mh * 0.58);
        }
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(0, 236, 128, 20);
    g.fillStyle = '#fde68a';
    for (let i = 0; i < 4; i++) g.fillRect(8 + i * 30, 240, 18, 12);
  });
}

export function waterRippleTex() {
  const t = canvasTex(256, 256, g => {
    g.fillStyle = '#0c4a6e';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(186,230,253,${R(0.03, 0.13)})`;
      g.beginPath();
      g.ellipse(R(0, 256), R(0, 256), R(8, 26), R(1.5, 4), 0, 0, Math.PI * 2);
      g.fill();
    }
  }, true);
  t.repeat.set(45, 45);
  return t;
}
