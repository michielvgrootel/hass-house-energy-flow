/*
 * Home Energy Scene Card
 * An animated Home Assistant Lovelace card in a dark "studio render" style: a white 3D house
 * with solar roof, home battery, EV, heat pump and grid connection on a glossy floor.
 * Power lines pulse when energy flows; backdrop and lighting follow the time of day.
 */
const HESC_VERSION = '3.2.0';

const I18N = {
  en: {
    now: 'Now', solar: 'Solar', self: 'Self-sufficient', grid: 'Grid', import: 'Grid import',
    export: 'Grid export', home: 'Home', battery: 'Battery', ev: 'EV', heatpump: 'Heat pump',
  },
  nl: {
    now: 'Nu', solar: 'Opwek', self: 'Zelfvoorzienend', grid: 'Net', import: 'Afname',
    export: 'Teruglevering', home: 'Huis', battery: 'Batterij', ev: 'Auto', heatpump: 'Warmtepomp',
  },
};

const DEFAULT_COLORS = {
  solar: '#fde047', grid: '#f472d0', battery: '#4ade80',
  ev: '#60a5fa', heatpump: '#fb923c', home: '#f8fafc',
};

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const hex2rgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)); };
const rgb2hex = (a) => '#' + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------ projection --
// World: x runs along the front of the house, z into the depth, y up.
const VB_W = 400, VB_H = 285, OX = 58, OY = 196;
const AX = [0.97, 0.16], BZ = [0.55, -0.36];
const P = (x, y, z, m = 1) => [OX + AX[0] * x + BZ[0] * z, OY + AX[1] * x + BZ[1] * z - m * y];
const pts = (arr, m) => arr.map(([x, y, z]) => P(x, y, z, m).map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (arr, fill, m, extra = '') =>
  `<polygon points="${pts(arr, m)}" fill="${fill}" stroke="${fill}" stroke-width=".5" stroke-linejoin="round" ${extra}/>`;
const seg = (a, b, m, stroke, w, extra = '') => {
  const p = P(...a, m), q = P(...b, m);
  return `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;
};
// local 2D frames: a wall facing the viewer (x/y plane) and a wall facing right (z/y plane)
const frameX = (x, y, z, m) => { const p = P(x, y, z, m); return `matrix(${AX[0]},${AX[1]},0,${m},${p[0].toFixed(2)},${p[1].toFixed(2)})`; };
const frameZ = (x, y, z, m) => { const p = P(x, y, z, m); return `matrix(${BZ[0]},${BZ[1]},0,${m},${p[0].toFixed(2)},${p[1].toFixed(2)})`; };
const box = (x0, x1, h, z0, z1, cf, cs, ct, m) =>
  poly([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], cf, m) +
  poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], cs, m) +
  (m > 0 ? poly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], ct, m) : '');

// house dimensions
const W = 180, D = 84, H = 64, R = 46;
const slope = (x, t) => [x, H + R * t, (D / 2) * t];          // front roof plane
const bslope = (x, t) => [x, H + R * t, D - (D / 2) * t];     // back roof plane
const BAT = { x0: 5.5, x1: 10.5, y0: 6, h: 25, z: -14 };     // state-of-charge bar on the battery

const HUB = [104, 0, -44];
const FLOWS = [
  { key: 'solar', w: [[109, 0, -44], [109, 0, 0], [109, 64, 0], [109, 87, 21]] },
  { key: 'home', w: [[99, 0, -44], [99, 0, -20], [56, 0, -20], [56, 0, 0], [56, 8, 0]] },
  { key: 'heatpump', w: [[104, 0, -44], [147, 0, -44], [147, 0, -20]] },
  { key: 'battery', w: [[97, 0, -44], [97, 0, -31], [8, 0, -31], [8, 0, -14]] },
  { key: 'ev', w: [[100, 0, -44], [100, 0, -72], [204.5, 0, -72], [204.5, 0, -37]] },
  { key: 'grid', w: [[104, 0, -44], [-16, 0, -44], [-16, 0, -36]] },
];

// label = text centre on screen (kept on dark surfaces: roof, garage roof, floor); anchor = world point the dotted leader runs to
const LABELS = {
  grid: { at: [30, 243], anchor: [-16, 0, -30] },
  home: { at: [97, 100], anchor: [40, 44, 0] },
  solar: { at: [140, 124], anchor: [83, 66, 3] },
  heatpump: { at: [200, 104], anchor: [154, 26, -13] },
  battery: { at: [86, 245], anchor: [12, 2, -14] },
  ev: { at: [292, 170], anchor: [246, 15, -8.5] },
};

// elevation, backdrop top, backdrop horizon, studio glow, floor far, floor near
const SKY_STOPS = [
  [-18, '#03050a', '#081022', '#1d4fae', '#0c1422', '#05070c'],
  [-8, '#070b1a', '#141a3c', '#2a4aa0', '#0e1526', '#06080e'],
  [-3, '#1a2150', '#8a4a5e', '#e0705a', '#2a2233', '#0b0c14'],
  [1, '#2f4a86', '#e39562', '#ffa864', '#4a3a40', '#14141c'],
  [7, '#3f72ba', '#e8c8a4', '#ffe2b8', '#55606f', '#1a2029'],
  [16, '#2f74cc', '#9cc6ec', '#e8f3ff', '#5a7088', '#1c2531'],
  [50, '#2468c8', '#8fbfea', '#ffffff', '#5c7590', '#1e2835'],
];

function sampleStops(stops, el, idx) {
  if (el <= stops[0][0]) return stops[0][idx];
  for (let i = 1; i < stops.length; i++) {
    if (el <= stops[i][0]) {
      const e0 = stops[i - 1][0], e1 = stops[i][0];
      return mix(stops[i - 1][idx], stops[i][idx], (el - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1][idx];
}

function fmtPower(w) {
  if (w == null || isNaN(w)) return { value: '—', unit: '' };
  const a = Math.abs(w);
  if (a >= 1000) return { value: (w / 1000).toFixed(a >= 10000 ? 1 : 2), unit: 'kW' };
  return { value: String(Math.round(w)), unit: 'W' };
}

// rounded-corner screen path through world points
function flowPath(w, r = 4) {
  const s = w.map((p) => P(...p));
  let d = `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)}`;
  for (let i = 1; i < s.length; i++) {
    const p = s[i];
    if (i === s.length - 1) { d += ` L${p[0].toFixed(1)} ${p[1].toFixed(1)}`; break; }
    const a = s[i - 1], b = s[i + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la / 2), rb = Math.min(r, lb / 2);
    const p1 = [p[0] - ((p[0] - a[0]) / la) * ra, p[1] - ((p[1] - a[1]) / la) * ra];
    const p2 = [p[0] + ((b[0] - p[0]) / lb) * rb, p[1] + ((b[1] - p[1]) / lb) * rb];
    d += ` L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// --------------------------------------------------------------- objects --

function house(m) {
  let s = '';
  s += poly([[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]], 'url(#gFront)', m);
  s += poly([[W, 0, 0], [W, 0, D], [W, H, D], [W, H + R, D / 2], [W, H, 0]], 'url(#gSide)', m);
  // big living-room window
  s += poly([[18, 6, 0], [94, 6, 0], [94, 44, 0], [18, 44, 0]], '#1c2027', m);
  s += poly([[20, 8, 0], [92, 8, 0], [92, 42, 0], [20, 42, 0]], 'url(#gWin)', m);
  s += `<g class="winwarm">${poly([[20, 8, 0], [92, 8, 0], [92, 42, 0], [20, 42, 0]], 'url(#gWinWarm)', m)}
    ${poly([[58, 8, 0], [84, 8, 0], [84, 16, 0], [58, 16, 0]], '#d99a4e', m, 'opacity=".45"')}
    ${poly([[28, 8, 0], [29.2, 8, 0], [29.2, 27, 0], [28, 27, 0]], '#8a5a2a', m, 'opacity=".6"')}
    ${poly([[24, 27, 0], [33, 27, 0], [31, 33, 0], [26, 33, 0]], '#ffffff', m, 'opacity=".85"')}</g>`;
  if (m > 0) s += poly([[21, 30, 0], [33, 42, 0], [41, 42, 0], [21, 22, 0]], '#ffffff', m, 'class="shine" opacity=".16"');
  [44, 68].forEach((x) => { s += poly([[x - 0.9, 8, 0], [x + 0.9, 8, 0], [x + 0.9, 42, 0], [x - 0.9, 42, 0]], '#1c2027', m); });
  s += poly([[16, 4.5, 0], [96, 4.5, 0], [96, 6, 0], [16, 6, 0]], '#c9cfd7', m);
  if (m < 0) return s;

  // roof: eave + edges, then the black front plane with panels
  const e = -0.1, o = 6;
  const dn = (p) => [p[0], p[1] - 3.2, p[2]];
  s += poly([bslope(W + o, 1), bslope(W + o, e), dn(bslope(W + o, e)), dn(bslope(W + o, 1))], '#07080b', m);
  s += poly([slope(-o, e), slope(W + o, e), slope(W + o, 1), slope(-o, 1)], 'url(#gRoof)', m);
  s += poly([slope(-o, e), slope(W + o, e), dn(slope(W + o, e)), dn(slope(-o, e))], '#2b2f38', m);
  s += poly([slope(W + o, e), slope(W + o, 1), dn(slope(W + o, 1)), dn(slope(W + o, e))], '#07080b', m);
  s += seg(slope(-o, 1), slope(W + o, 1), m, '#4a505c', 0.9);
  const cols = 6, rows = 2, x0 = 8, x1 = 172, t0 = 0.07, t1 = 0.93, gx = 1.3, gt = 0.018;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = x0 + ((x1 - x0) * c) / cols + gx, b = x0 + ((x1 - x0) * (c + 1)) / cols - gx;
      const p = t0 + ((t1 - t0) * r) / rows + gt, q = t0 + ((t1 - t0) * (r + 1)) / rows - gt;
      s += `<polygon points="${pts([slope(a, p), slope(b, p), slope(b, q), slope(a, q)], m)}" fill="url(#gPanel)" stroke="#4d5a70" stroke-width=".55" stroke-linejoin="round"/>`;
      let grid = '';
      for (let i = 1; i < 3; i++) { const x = a + ((b - a) * i) / 3; grid += seg(slope(x, p), slope(x, q), m, '#8fa3c4', 0.25); }
      for (let i = 1; i < 4; i++) { const t = p + ((q - p) * i) / 4; grid += seg(slope(a, t), slope(b, t), m, '#8fa3c4', 0.25); }
      s += `<g opacity=".3">${grid}</g>`;
    }
  }
  s += `<polygon class="sheen" points="${pts([slope(x0, t0), slope(x1, t0), slope(x1, t1), slope(x0, t1)], m)}" fill="url(#gSheen)"/>`;
  return s;
}

function garage(m) {
  const x0 = W, x1 = 276, z0 = 20, z1 = D, h = 40;
  let s = '';
  s += poly([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], 'url(#gFront)', m);
  s += poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], 'url(#gSide)', m);
  s += poly([[198, 0, z0], [262, 0, z0], [262, 31, z0], [198, 31, z0]], 'url(#gGarage)', m);
  s += `<g class="garagewarm">${poly([[198, 0, z0], [262, 0, z0], [262, 31, z0], [198, 31, z0]], 'url(#gGarageWarm)', m)}</g>`;
  if (m > 0) {
    s += poly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], '#14171c', m);
    s += poly([[x0, h - 4, z0], [x1, h - 4, z0], [x1, h, z0], [x0, h, z0]], '#262a32', m);
    s += poly([[x1, h - 4, z0], [x1, h - 4, z1], [x1, h, z1], [x1, h, z0]], '#0d0f13', m);
  }
  return s;
}

function battery(m) {
  let s = box(1, 15, 36, -14, 0, 'url(#gBattF)', '#101216', '#3a404a', m);
  s += poly([[BAT.x0, BAT.y0, BAT.z], [BAT.x1, BAT.y0, BAT.z], [BAT.x1, BAT.y0 + BAT.h, BAT.z], [BAT.x0, BAT.y0 + BAT.h, BAT.z]], '#06080b', m);
  s += `<polygon class="socbar" points="" fill="#4ade80"/>`;
  if (m > 0) s += seg([1.6, 1, -14], [1.6, 35, -14], m, '#ffffff', 0.5, 'opacity=".25"');
  return s;
}

function heatpump(m) {
  let s = box(128, 166, 26, -20, -6, 'url(#gHp)', '#bfc6cf', '#fbfcfd', m);
  s += `<g transform="${frameX(141.5, 13, -20, m)}">
    <circle r="10" fill="#171b21"/>
    <g class="fan"><ellipse cy="-4.6" rx="2.4" ry="4.6" fill="#8f99a5"/><ellipse cy="-4.6" rx="2.4" ry="4.6" fill="#8f99a5" transform="rotate(120)"/><ellipse cy="-4.6" rx="2.4" ry="4.6" fill="#8f99a5" transform="rotate(240)"/><circle r="1.8" fill="#d5dbe2"/></g>
    <g fill="none" stroke="#4d5662" stroke-width=".6"><circle r="9.6"/><circle r="6.6"/><circle r="3.6"/><path d="M-9.6 0H9.6M0-9.6V9.6"/></g>
  </g>`;
  for (let y = 7; y <= 20; y += 3.2) s += seg([154, y, -20], [163, y, -20], m, '#a3abb5', 0.7);
  return s;
}

function tower(m) {
  const cx = -16, cz = -28, steel = '#b9c1cc', cap = 'stroke-linecap="round"';
  const hw = (y) => (y <= 58 ? 8.5 - (5.7 * y) / 58 : 2.8 - (1.5 * (y - 58)) / 26);
  // corners: 0 front-left, 1 front-right, 2 back-right, 3 back-left
  const c = (i, y) => { const h = hw(y); return [cx + (i === 1 || i === 2 ? h : -h), y, cz + (i >= 2 ? h : -h)]; };
  const lv = [0, 16, 31, 45, 58, 65, 72, 78, 84];
  const face = (a, b) => {
    let f = '';
    for (let i = 0; i < lv.length - 1; i++) {
      f += seg(c(a, lv[i]), c(b, lv[i + 1]), m, steel, 0.5, cap) + seg(c(b, lv[i]), c(a, lv[i + 1]), m, steel, 0.5, cap);
      f += seg(c(a, lv[i + 1]), c(b, lv[i + 1]), m, steel, 0.5, cap);
    }
    return f;
  };
  const leg = (i) => seg(c(i, 0), c(i, 58), m, steel, 1.1, cap) + seg(c(i, 58), c(i, 84), m, steel, 0.9, cap);
  let s = `<g opacity=".45">${face(2, 3)}${face(3, 0)}${leg(3)}</g>`;
  s += face(1, 2) + leg(2) + face(0, 1) + leg(0) + leg(1);
  // cross-arms with insulators and conductors running off towards the viewer
  [[58, 14], [72, 10.5]].forEach(([y, L]) => {
    [-1, 1].forEach((d) => {
      const tip = [cx + d * L, y, cz], h = hw(y), drop = [tip[0], y - 4, cz];
      s += seg([cx + d * h, y, cz - h], tip, m, steel, 0.6, cap) + seg([cx + d * h, y, cz + h], tip, m, steel, 0.6, cap);
      s += seg([cx + d * hw(y + 5), y + 5, cz], tip, m, steel, 0.6, cap);
      s += seg([cx + d * (h + (L - h) / 2), y, cz], [cx + d * hw(y + 5), y + 5, cz], m, steel, 0.4, cap);
      const wire = [];
      for (let t = 0; t <= 1.001; t += 0.125) wire.push([tip[0], y - 4 - 9 * t * (1.5 - t), cz - 62 * t]);
      s += `<polyline points="${pts(wire, m)}" fill="none" stroke="#6b7482" stroke-width=".45"/>`;
      s += seg(tip, drop, m, '#e8edf2', 1.1, cap);
    });
  });
  return s;
}

function wallbox(m) {
  let s = box(202, 207, 24, -37, -33, '#f4f6f8', '#c3cad3', '#ffffff', m);
  s += poly([[203, 16, -37], [206, 16, -37], [206, 21, -37], [203, 21, -37]], '#1b2130', m);
  if (m > 0) s += `<g transform="${frameX(204.5, 12, -37, m)}"><circle class="evled" r="1.3" fill="#334155"/></g>`;
  return s;
}

function car(m) {
  const x1 = 248, x0 = 218, z0 = -70;
  const prof = [[0, 4], [0, 9], [2, 11.5], [20, 14], [31, 20.5], [46, 20.5], [58, 15], [63, 14], [64, 9], [64, 4]];
  const S = (u, y) => [x1, y, z0 + u], B = (u, y) => [x0, y, z0 + u];
  const cols = ['url(#gCarFront)', '#dfe4ea', '#fafbfc', 'url(#gGlass)', '#f1f4f7', 'url(#gGlass)', '#e9edf1', '#c5ccd5', '#b9c1cb'];
  let s = '';
  for (let i = prof.length - 2; i >= 0; i--) {
    const a = prof[i], b = prof[i + 1];
    s += poly([S(...a), S(...b), B(...b), B(...a)], cols[i], m);
  }
  // nose details
  s += poly([[x1 - 4, 4.6, z0], [x0 + 4, 4.6, z0], [x0 + 4, 6.6, z0], [x1 - 4, 6.6, z0]], '#1b1f26', m);
  s += poly([[x1 - 0.6, 9.4, z0 + 0.1], [x1 - 0.6, 11.1, z0 + 1.5], [x1 - 8, 11.1, z0 + 1.5], [x1 - 8, 9.4, z0 + 0.1]], '#fff8dc', m, 'class="headlight"');
  s += poly([[x0 + 0.6, 9.4, z0 + 0.1], [x0 + 0.6, 11.1, z0 + 1.5], [x0 + 8, 11.1, z0 + 1.5], [x0 + 8, 9.4, z0 + 0.1]], '#fff8dc', m, 'class="headlight"');
  // near side
  s += poly(prof.map((p) => S(...p)), 'url(#gCarSide)', m);
  s += poly([S(3, 4), S(61, 4), S(61, 5.3), S(3, 5.3)], '#8d96a1', m);
  s += poly([S(22.5, 14.7), S(31.4, 19.6), S(38, 19.6), S(38, 14.7)], 'url(#gGlass)', m);
  s += poly([S(39.7, 14.7), S(39.7, 19.6), S(45.6, 19.6), S(55.4, 15.1), S(55.4, 14.7)], 'url(#gGlass)', m);
  s += seg(S(38.9, 14.6), S(38.9, 5.6), m, '#aab2bc', 0.45);
  s += poly([S(60.8, 13.4), S(63.5, 13), S(63.9, 11), S(60.8, 11.6)], '#ef4444', m);
  [12, 52].forEach((u) => {
    s += `<g transform="${frameZ(x1, 6, z0 + u, m)}">
      <circle r="7.4" fill="#14171c"/><circle r="6.1" fill="#0b0d10"/><circle r="4" fill="#d5dae0"/>
      <path d="M0 -4V4M-3.8 -1.2L3.8 1.2M-2.4 3.2L2.4 -3.2M-3.8 1.2L3.8 -1.2M-2.4 -3.2L2.4 3.2" stroke="#8b939d" stroke-width=".8"/>
      <circle r="1.2" fill="#5a626c"/></g>`;
  });
  return s;
}

const solids = (m) => tower(m) + house(m) + garage(m) + battery(m) + heatpump(m) + car(m) + wallbox(m);

function shadows() {
  const fp = (x0, x1, z0, z1) => `<polygon points="${pts([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 1)}"/>`;
  return `<g fill="#000" opacity=".55" filter="url(#shadow)">
    ${fp(-6, W + 4, -7, D)}${fp(W, 282, 12, D)}${fp(214, 254, -76, -2)}${fp(125, 170, -25, -4)}${fp(-1, 19, -19, 2)}${fp(-25, -7, -37, -19)}${fp(200, 210, -41, -31)}
  </g>`;
}

function stars() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let s = '';
  for (let i = 0; i < 70; i++) {
    const big = rnd() < 0.1;
    const size = big ? 2.2 : rnd() < 0.5 ? 1 : 1.4;
    s += `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(18 + rnd() * 30).toFixed(1)}%;width:${size}px;height:${size}px;${big ? 'box-shadow:0 0 5px 1px #cfe0ff;' : ''}animation-duration:${(2 + rnd() * 4).toFixed(1)}s;animation-delay:-${(rnd() * 6).toFixed(1)}s"></i>`;
  }
  return s;
}

const CSS = `
:host { display: block; }
ha-card { display: block; overflow: hidden; border: none; background: none; border-radius: var(--ha-card-border-radius, 18px); }
.wrap {
  position: relative; overflow: hidden; container-type: inline-size; color: #fff;
  background: linear-gradient(180deg, var(--sky-top, #03050a) 0%, var(--sky-hor, #081022) 52%, var(--floor-near, #05070c) 100%);
  font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
}
.wrap::after { content: ''; position: absolute; inset: 0; z-index: 3; pointer-events: none; border-radius: inherit; box-shadow: inset 0 0 0 1px rgba(255,255,255,.07); }

/* ---- backdrop ---- */
.sky { position: absolute; inset: 0; pointer-events: none; }
.halo { position: absolute; inset: 0; background:
  radial-gradient(ellipse 62% 36% at 46% 47%, var(--glow, rgba(29,79,174,.6)), transparent 72%),
  radial-gradient(ellipse 40% 24% at var(--sun-x, 50%) 50%, var(--glow2, transparent), transparent 75%); }
.stars { position: absolute; inset: 0; transition: opacity 1.5s; }
.stars i { position: absolute; border-radius: 50%; background: #fff; animation: twinkle 3s ease-in-out infinite; }
@keyframes twinkle { 0%,100% { opacity: .15 } 50% { opacity: .9 } }
.sun { position: absolute; width: 9cqw; height: 9cqw; max-width: 44px; max-height: 44px; transform: translate(-50%,-50%); border-radius: 50%; transition: opacity 1s;
  background: radial-gradient(circle at 42% 40%, #fffef4 0%, var(--sun-a, #ffe78f) 55%, var(--sun-b, #ffcf52) 100%);
  box-shadow: 0 0 24px 10px var(--sun-glow, rgba(255,226,140,.55)), 0 0 90px 44px var(--sun-glow, rgba(255,226,140,.5)); }
.moon { position: absolute; width: 6.5cqw; height: 6.5cqw; max-width: 32px; max-height: 32px; transform: translate(-50%,-50%); border-radius: 50%; transition: opacity 1s;
  background: radial-gradient(circle at 36% 34%, #fffef6 0%, #e9e7d8 55%, #cfccba 100%);
  box-shadow: inset -5px -4px 9px rgba(40,50,90,.5), 0 0 26px 8px rgba(190,210,255,.28), 0 0 80px 30px rgba(150,180,255,.12); }

/* ---- header tile ---- */
.header { position: relative; z-index: 2; margin: 12px 12px 0; padding: 12px 16px; border-radius: 16px; display: flex; align-items: center; gap: 12px;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.09);
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3); }
.head { flex: 1; min-width: 0; }
.subtitle { font-size: 12.5px; color: rgba(255,255,255,.62); letter-spacing: .2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title { font-size: clamp(22px, 6.6cqw, 30px); font-weight: 600; line-height: 1.15; letter-spacing: -.4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hstats { display: flex; gap: 16px; }
.hstats .stat { text-align: right; }
.stat { cursor: pointer; min-width: 0; }
.stat[data-entity=""] { cursor: default; }
.stat .label { font-size: 12.5px; color: rgba(255,255,255,.62); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat .dot { display: inline-block; width: .5em; height: .5em; border-radius: 50%; margin-right: .5em; vertical-align: .1em; box-shadow: 0 0 6px currentColor; }
.stat .value { font-size: clamp(18px, 5.4cqw, 25px); font-weight: 500; white-space: nowrap; line-height: 1.3; letter-spacing: -.2px; }
.stat .unit { font-size: .68em; margin-left: 3px; color: rgba(255,255,255,.85); }
.stat .extra { font-size: .52em; margin-left: 6px; color: rgba(255,255,255,.7); }

/* ---- footer tiles ---- */
.footer { position: relative; z-index: 2; display: grid; gap: 8px; padding: 0 12px 12px; margin-top: -3cqw; }
.footer .stat { padding: 10px 14px 9px; border-radius: 16px; background: rgba(255,255,255,.065); border: 1px solid rgba(255,255,255,.08);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }

/* ---- scene ---- */
.scenebox { position: relative; z-index: 1; }
.scene { display: block; width: 100%; height: auto; }
.line.off { display: none; }
.pipe { fill: none; stroke: rgba(4,6,12,.4); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.base { fill: none; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; opacity: .32; transition: opacity .6s; }
.halo2 { fill: none; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
.flow { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 7 13; opacity: 0; transition: opacity .6s; }
.core { fill: none; stroke: #fff; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 3 17; stroke-dashoffset: -2; opacity: 0; transition: opacity .6s; }
.node { opacity: .4; transform-box: fill-box; transform-origin: center; transition: opacity .6s; }
.line.on .base { opacity: .8; }
.line.on .halo2 { animation: pulse 2s ease-in-out infinite; animation-delay: inherit; }
.line.on .flow { opacity: 1; animation: dash var(--dur, 1.5s) linear infinite; }
.line.on .core { opacity: .95; animation: dashcore var(--dur, 1.5s) linear infinite; }
.line.on.rev .flow, .line.on.rev .core { animation-direction: reverse; }
.line.on .node { opacity: 1; animation: nodepulse 2s ease-in-out infinite; animation-delay: inherit; }
@keyframes dash { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -40 } }
@keyframes dashcore { from { stroke-dashoffset: -2 } to { stroke-dashoffset: -42 } }
@keyframes pulse { 0%,100% { opacity: .12 } 50% { opacity: .6 } }
@keyframes nodepulse { 50% { transform: scale(1.5) } }
@keyframes spin { to { transform: rotate(360deg) } }
.fan.on { animation: spin var(--fdur, 1s) linear infinite; }
.hubring { transform-box: fill-box; transform-origin: center; opacity: 0; }
.hubring.on { animation: ping 2s ease-out infinite; }
@keyframes ping { 0% { transform: scale(1); opacity: .8 } 100% { transform: scale(2.2); opacity: 0 } }
.evled.on { animation: blink 1.2s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .25 } }
.leader { stroke: rgba(255,255,255,.5); stroke-width: .7; stroke-dasharray: .2 2.4; stroke-linecap: round; }
.leader.hidden, .ldot.hidden { display: none; }
.ldot { fill: #fff; opacity: .85; }

/* ---- floating labels ---- */
.lbl { position: absolute; transform: translate(-50%,-50%); text-align: center; white-space: nowrap; cursor: pointer; line-height: 1.15;
  font-size: clamp(8px, 2.35cqw, 12px); text-shadow: 0 1px 6px rgba(0,0,0,.55); transition: opacity .6s; }
.lbl.hidden { display: none; }
.lbl .n { font-size: .92em; color: rgba(255,255,255,.62); }
.lbl .v { font-size: 1.5em; font-weight: 500; letter-spacing: -.2px; }
.lbl .v small { font-size: .62em; margin-left: .2em; color: rgba(255,255,255,.85); }
.lbl .x { font-size: .85em; color: var(--c); font-weight: 700; text-shadow: 0 0 3px rgba(0,0,0,.75), 0 1px 5px rgba(0,0,0,.5); }
.lbl.idle .v { color: rgba(255,255,255,.5); }
.lbl.idle .n { color: rgba(255,255,255,.4); }

@media (prefers-reduced-motion: reduce) {
  .line.on .flow, .line.on .core, .line.on .halo2, .line.on .node, .fan.on, .hubring.on, .stars i { animation: none; }
}
`;

function sceneSVG(colors) {
  const flows = FLOWS.map(({ key, w }, i) => {
    const d = flowPath(w), end = P(...w[w.length - 1]);
    return `
    <g id="line-${key}" class="line off" style="animation-delay:-${(i * 0.33).toFixed(2)}s">
      <path class="pipe" d="${d}"/>
      <path class="base" d="${d}" stroke="${colors[key]}"/>
      <path class="halo2" d="${d}" stroke="${colors[key]}" filter="url(#blur)"/>
      <path class="flow" d="${d}" stroke="${colors[key]}" filter="url(#glow)"/>
      <path class="core" d="${d}"/>
      <circle class="node" cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="2.3" fill="${colors[key]}" stroke="#0e131c" stroke-width=".8"/>
    </g>`;
  }).join('');

  const leaders = Object.entries(LABELS).map(([key, { at, anchor }]) => {
    const a = P(...anchor);
    return `<line id="leader-${key}" class="leader hidden" x1="${at[0]}" y1="${at[1] + (a[1] > at[1] ? 11 : -11)}" x2="${a[0].toFixed(1)}" y2="${a[1].toFixed(1)}"/>
      <circle id="ldot-${key}" class="ldot hidden" cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="1.3"/>`;
  }).join('');

  const hub = P(...HUB);
  const floorM = `matrix(${AX[0]},${AX[1]},${BZ[0]},${BZ[1]},${hub[0].toFixed(1)},${hub[1].toFixed(1)})`;
  const full = `x="0" y="0" width="${VB_W}" height="${VB_H}"`;

  return `
<svg class="scene" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" filterUnits="userSpaceOnUse" ${full}><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="blur" filterUnits="userSpaceOnUse" ${full}><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="shadow" filterUnits="userSpaceOnUse" ${full}><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="soft" filterUnits="userSpaceOnUse" ${full}><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="refblur" filterUnits="userSpaceOnUse" ${full}><feGaussianBlur stdDeviation=".9"/></filter>
    <filter id="daylight" filterUnits="userSpaceOnUse" ${full} color-interpolation-filters="sRGB">
      <feColorMatrix class="daymatrix" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
    </filter>
    <linearGradient id="gFloor" gradientUnits="userSpaceOnUse" x1="0" y1="128" x2="0" y2="${VB_H}">
      <stop id="fs0" offset="0" stop-color="#0c1422" stop-opacity="0"/><stop id="fs1" offset=".2" stop-color="#0c1422"/><stop id="fs2" offset="1" stop-color="#05070c"/>
    </linearGradient>
    <radialGradient id="gFloorLight" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="gRefFade" gradientUnits="userSpaceOnUse" x1="0" y1="196" x2="0" y2="${VB_H}"><stop offset="0" stop-color="#fff"/><stop offset=".75" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="refMask" maskUnits="userSpaceOnUse" ${full}><rect ${full} fill="url(#gRefFade)"/></mask>
    <linearGradient id="gFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e6eb"/></linearGradient>
    <linearGradient id="gSide" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dee5"/><stop offset="1" stop-color="#b4bbc5"/></linearGradient>
    <linearGradient id="gRoof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23272f"/><stop offset="1" stop-color="#0c0e12"/></linearGradient>
    <linearGradient id="gPanel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2436"/><stop offset="1" stop-color="#04060a"/></linearGradient>
    <linearGradient id="gSheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dbe8ff" stop-opacity=".42"/><stop offset=".35" stop-color="#9cc4ff" stop-opacity="0"/>
      <stop offset=".65" stop-color="#9cc4ff" stop-opacity="0"/><stop offset="1" stop-color="#e2efff" stop-opacity=".2"/>
    </linearGradient>
    <linearGradient id="gWin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7396c0"/><stop offset="1" stop-color="#1f2f47"/></linearGradient>
    <linearGradient id="gWinWarm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbe8"/><stop offset=".55" stop-color="#ffe7ab"/><stop offset="1" stop-color="#ffc66e"/></linearGradient>
    <linearGradient id="gGarage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090b0f"/><stop offset="1" stop-color="#1f232b"/></linearGradient>
    <linearGradient id="gGarageWarm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd58a" stop-opacity=".5"/><stop offset="1" stop-color="#ffb65c" stop-opacity=".12"/></linearGradient>
    <linearGradient id="gBattF" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a414c"/><stop offset=".4" stop-color="#22262d"/><stop offset="1" stop-color="#181b20"/></linearGradient>
    <linearGradient id="gHp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9fafb"/><stop offset="1" stop-color="#d6dbe1"/></linearGradient>
    <linearGradient id="gCarSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#eef1f5"/><stop offset="1" stop-color="#b9c1cb"/></linearGradient>
    <linearGradient id="gCarFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e7ec"/><stop offset="1" stop-color="#b3bbc5"/></linearGradient>
    <linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46587a"/><stop offset="1" stop-color="#0d121b"/></linearGradient>
    <linearGradient id="gSpill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc76b" stop-opacity=".75"/><stop offset="1" stop-color="#ffc76b" stop-opacity="0"/></linearGradient>
    <linearGradient id="gBolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f99d"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
    <radialGradient id="gHub"><stop offset="0" stop-color="#27303f"/><stop offset="1" stop-color="#0a0d13"/></radialGradient>
    <radialGradient id="gWarm"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset=".4" stop-color="#ffbf5e" stop-opacity=".35"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  </defs>

  <!-- glossy studio floor -->
  <rect x="0" y="128" width="${VB_W}" height="${VB_H - 128}" fill="url(#gFloor)"/>
  <ellipse cx="200" cy="232" rx="210" ry="52" fill="url(#gFloorLight)"/>
  ${shadows()}

  <!-- mirror image on the floor -->
  <g mask="url(#refMask)"><g opacity=".42" filter="url(#refblur)"><g filter="url(#daylight)">${solids(-1)}</g></g></g>
  <polygon id="spill" points="${pts([[20, 0, -1], [92, 0, -1], [104, 0, -46], [6, 0, -46]], 1)}" fill="url(#gSpill)" opacity="0" filter="url(#soft)"/>

  <!-- the model -->
  <g id="exterior" filter="url(#daylight)">${solids(1)}</g>
  <g id="bloom" opacity="0" style="pointer-events:none">
    <ellipse cx="${P(56, 25, 0)[0].toFixed(1)}" cy="${P(56, 25, 0)[1].toFixed(1)}" rx="62" ry="40" fill="url(#gWarm)" opacity=".5"/>
  </g>

  <!-- click targets -->
  <g fill="transparent">
    <polygon class="device" data-key="solar" points="${pts([slope(0, 0), slope(W, 0), slope(W, 1), slope(0, 1)], 1)}"/>
    <polygon class="device" data-key="home" points="${pts([[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]], 1)}"/>
    <polygon class="device" data-key="battery" points="${pts([[1, 0, -14], [15, 0, -14], [15, 36, 0], [1, 36, -14]], 1)}"/>
    <polygon class="device" data-key="heatpump" points="${pts([[128, 0, -20], [166, 0, -20], [166, 26, -6], [128, 26, -20]], 1)}"/>
    <polygon class="device" data-key="ev" points="${pts([[218, 0, -70], [248, 0, -70], [248, 0, -6], [248, 21, -6], [218, 21, -30]], 1)}"/>
    <polygon class="device" data-key="grid" points="${pts([[-25, 0, -36], [-7, 0, -36], [-1, 58, -28], [-12, 86, -28], [-20, 86, -28], [-31, 58, -28]], 1)}"/>
  </g>

  ${leaders}
  ${flows}

  <!-- hub -->
  <g transform="${floorM}">
    <circle id="hubring" class="hubring" r="13" fill="none" stroke="#5eead4" stroke-width="1.4"/>
    <circle r="14" fill="url(#gHub)" stroke="rgba(255,255,255,.28)" stroke-width="1"/>
    <circle r="10.5" fill="none" stroke="url(#gBolt)" stroke-width=".8" opacity=".6"/>
  </g>
  <path transform="translate(${hub[0].toFixed(1)} ${(hub[1] - 0.5).toFixed(1)})" d="M1.6 -7 L-4.4 1 H-.4 L-1.7 7 L4.4 -1.1 H.4 Z" fill="url(#gBolt)" filter="url(#glow)"/>
</svg>`;
}

function labelsHTML(colors) {
  return Object.entries(LABELS).map(([key, { at }]) => `
    <div id="lbl-${key}" class="lbl hidden" data-key="${key}" style="left:${((at[0] / VB_W) * 100).toFixed(2)}%;top:${((at[1] / VB_H) * 100).toFixed(2)}%;--c:${colors[key]}">
      <div class="n"></div><div class="v"></div>
    </div>`).join('');
}

// ------------------------------------------------------------------ card --

class HomeEnergySceneCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._demoHour = null;
  }

  static getStubConfig() {
    return {
      entities: {
        solar: 'sensor.solar_power',
        grid: 'sensor.grid_power',
        battery: 'sensor.battery_power',
        battery_soc: 'sensor.battery_state_of_charge',
        ev: 'sensor.ev_charger_power',
        heatpump: 'sensor.heat_pump_power',
      },
    };
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    this._config = {
      threshold: 10,
      sun_entity: 'sun.sun',
      ...config,
      entities: { ...(config.entities || {}) },
      colors: { ...DEFAULT_COLORS, ...(config.colors || {}) },
    };
    this._build();
    if (this.isConnected) this._startTimer();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built && this._config) this._build();
    this._update();
  }

  get hass() { return this._hass; }

  /** Force a time of day (0–24) — handy for previews. Set to null to follow real time again. */
  set demoHour(h) { this._demoHour = h == null ? null : Number(h); this._updateSky(); }
  get demoHour() { return this._demoHour; }

  connectedCallback() { this._startTimer(); this._updateSky(); }
  disconnectedCallback() { clearInterval(this._timer); this._timer = null; }

  getCardSize() { return 8; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  _startTimer() {
    clearInterval(this._timer);
    const fast = this._config && this._config.demo_cycle;
    this._timer = setInterval(() => this._updateSky(), fast ? 100 : 30000);
  }

  _t() {
    const lang = (this._config.language || (this._hass && this._hass.language) || 'en').toLowerCase();
    return { ...I18N.en, ...(I18N[lang.slice(0, 2)] || {}), ...(this._config.labels || {}) };
  }

  _ent(key) {
    const c = this._config.entities[key];
    if (!c) return null;
    return typeof c === 'string' ? { entity: c } : c;
  }

  _num(key, isPower) {
    const e = this._ent(key);
    if (!e || !this._hass) return null;
    const s = this._hass.states[e.entity];
    if (!s) return null;
    let v = parseFloat(s.state);
    if (isNaN(v)) return null;
    if (isPower) {
      const u = String(s.attributes.unit_of_measurement || '').toLowerCase();
      if (u === 'kw') v *= 1000;
      else if (u === 'mw') v *= 1e6;
    }
    if (e.invert) v = -v;
    return v;
  }

  _build() {
    if (!this._config) return;
    const c = this._config.colors;
    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <ha-card>
        <div class="wrap" id="wrap">
          <div class="sky">
            <div class="stars" id="stars">${stars()}</div>
            <div class="sun" id="sun"></div>
            <div class="moon" id="moon"></div>
            <div class="halo"></div>
          </div>
          <div class="header">
            <div class="head"><div class="subtitle" id="subtitle"></div><div class="title" id="title"></div></div>
            <div class="hstats" id="hstats"></div>
          </div>
          <div class="scenebox">${sceneSVG(c)}${labelsHTML(c)}</div>
          <div class="footer" id="fstats"></div>
        </div>
      </ha-card>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.$ = $;
    this.$$ = (sel) => this.shadowRoot.querySelectorAll(sel);
    this._built = true;
    this._hHTML = this._fHTML = null;

    const open = (entityId) => {
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } }));
    };
    this.$$('[data-key]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const key = el.dataset.key;
        const e = this._ent(key === 'battery' && !this._ent('battery') ? 'battery_soc' : key);
        open(e && e.entity);
      });
    });
    ['hstats', 'fstats'].forEach((id) => $(id).addEventListener('click', (ev) => {
      const s = ev.target.closest('[data-entity]');
      if (s) open(s.dataset.entity);
    }));
    this._lastSky = null;
    this._updateSky();
  }

  _values() {
    const v = {};
    ['solar', 'grid', 'battery', 'ev', 'heatpump', 'home'].forEach((k) => { v[k] = this._num(k, true); });
    v.battery_soc = this._num('battery_soc');
    v.ev_soc = this._num('ev_soc');
    if (v.home == null && (v.solar != null || v.grid != null)) {
      v.home = Math.max(0, (v.solar || 0) + (v.grid || 0) - (v.battery || 0) - (v.ev || 0) - (v.heatpump || 0));
      v.homeComputed = true;
    }
    return v;
  }

  _update() {
    if (!this._built || !this._hass) return;
    const $ = this.$, $$ = this.$$;
    const cfg = this._config;
    const th = cfg.threshold;
    const v = this._values();
    const t = this._t();

    // --- flows: positive "outward" = energy moving from the hub towards the device
    const outward = {
      solar: v.solar == null ? null : -v.solar,
      grid: v.grid == null ? null : -v.grid,
      battery: v.battery, ev: v.ev, heatpump: v.heatpump, home: v.home,
    };
    let any = false;
    FLOWS.forEach(({ key }) => {
      const val = outward[key];
      const active = val != null && Math.abs(val) > th;
      any = any || active;
      const g = $(`line-${key}`);
      g.classList.toggle('off', val == null);
      g.classList.toggle('on', active);
      g.classList.toggle('rev', active && val < 0);
      if (active) {
        const dur = clamp(2.6 - Math.log10(Math.max(Math.abs(val), 10)) * 0.48, 0.45, 2.4).toFixed(2) + 's';
        if (g.style.getPropertyValue('--dur') !== dur) g.style.setProperty('--dur', dur);
      }
    });
    $('hubring').classList.toggle('on', any);

    // --- devices
    const hpOn = v.heatpump != null && v.heatpump > th;
    const fdur = hpOn ? clamp(1.6 - Math.log10(v.heatpump) * 0.35, 0.25, 1.2).toFixed(2) + 's' : '';
    $$('.fan').forEach((f) => { f.classList.toggle('on', hpOn); if (hpOn) f.style.setProperty('--fdur', fdur); });

    const evOn = v.ev != null && v.ev > th;
    $$('.evled').forEach((l) => {
      l.classList.toggle('on', evOn);
      l.setAttribute('fill', evOn ? cfg.colors.ev : v.ev != null ? '#22c55e' : '#334155');
    });

    const soc = v.battery_soc;
    const sh = soc == null ? 0 : (BAT.h * clamp(soc, 0, 100)) / 100;
    const socCol = soc == null ? '#4ade80' : soc < 20 ? '#ef4444' : soc < 50 ? '#f59e0b' : '#4ade80';
    $$('.socbar').forEach((bar, i) => {
      const m = i === 0 ? -1 : 1; // the mirror image is first in the document
      bar.setAttribute('points', pts([[BAT.x0, BAT.y0, BAT.z], [BAT.x1, BAT.y0, BAT.z], [BAT.x1, BAT.y0 + sh, BAT.z], [BAT.x0, BAT.y0 + sh, BAT.z]], m));
      bar.setAttribute('fill', socCol);
    });

    // --- floating labels
    const label = (key, name, val, text, extra) => {
      const b = $(`lbl-${key}`);
      const hidden = text == null;
      b.classList.toggle('hidden', hidden);
      $(`leader-${key}`).classList.toggle('hidden', hidden);
      $(`ldot-${key}`).classList.toggle('hidden', hidden);
      if (hidden) return;
      b.classList.toggle('idle', !(val != null && Math.abs(val) > th));
      const html = `${esc(text.value)}<small>${esc(text.unit)}</small>`;
      const nHTML = esc(name) + (extra ? ` <span class="x">${esc(extra)}</span>` : '');
      const n = b.querySelector('.n'), vEl = b.querySelector('.v');
      if (n.innerHTML !== nHTML) n.innerHTML = nHTML;
      if (vEl.innerHTML !== html) vEl.innerHTML = html;
    };
    const pw = (w) => (w == null ? null : fmtPower(w));
    label('solar', t.solar, v.solar, pw(v.solar));
    label('home', t.home, v.home, pw(v.home));
    label('heatpump', t.heatpump, v.heatpump, pw(v.heatpump));
    label('grid', t.grid, v.grid, v.grid == null ? null : fmtPower(Math.abs(v.grid)), v.grid > th ? '↓' : v.grid < -th ? '↑' : '');
    label('ev', t.ev, v.ev, pw(v.ev), v.ev_soc != null ? `${Math.round(v.ev_soc)}%` : '');
    label('battery', t.battery, v.battery ?? 0,
      v.battery != null ? fmtPower(Math.abs(v.battery)) : soc != null ? { value: String(Math.round(soc)), unit: '%' } : null,
      v.battery != null && soc != null ? `${Math.round(soc)}%` : '');

    // --- stats
    $('title').textContent = cfg.title ?? t.now;
    const hs = cfg.header_stats || ['solar', 'self_sufficiency'];
    const fs = cfg.footer_stats || ['grid', 'home', 'battery'];
    const hHTML = hs.map((s) => this._statHTML(this._stat(s, v, t))).join('');
    const fHTML = fs.map((s) => this._statHTML(this._stat(s, v, t), true)).join('');
    if (hHTML !== this._hHTML) { $('hstats').innerHTML = hHTML; this._hHTML = hHTML; }
    if (fHTML !== this._fHTML) { $('fstats').innerHTML = fHTML; this._fHTML = fHTML; }
    $('fstats').style.gridTemplateColumns = `repeat(${fs.length}, 1fr)`;
    this._updateSky();
  }

  _stat(s, v, t) {
    const th = this._config.threshold;
    const col = this._config.colors;
    const ent = (k) => (this._ent(k) || {}).entity || '';
    if (typeof s === 'object') {
      const st = this._hass.states[s.entity];
      let value = st ? st.state : '—';
      if (st && s.decimals != null && !isNaN(parseFloat(value))) value = parseFloat(value).toFixed(s.decimals);
      return {
        label: s.name ?? (st ? st.attributes.friendly_name : s.entity),
        value, unit: s.unit ?? (st ? st.attributes.unit_of_measurement || '' : ''), entity: s.entity, color: s.color,
      };
    }
    switch (s) {
      case 'solar': return { label: t.solar, ...fmtPower(v.solar), entity: ent('solar'), color: col.solar };
      case 'home': return { label: t.home, ...fmtPower(v.home), entity: v.homeComputed ? '' : ent('home'), color: col.home };
      case 'ev': return { label: t.ev, ...fmtPower(v.ev), extra: v.ev_soc != null ? `${Math.round(v.ev_soc)}%` : '', entity: ent('ev'), color: col.ev };
      case 'heatpump': return { label: t.heatpump, ...fmtPower(v.heatpump), entity: ent('heatpump'), color: col.heatpump };
      case 'grid': {
        const label = v.grid == null || Math.abs(v.grid) <= th ? t.grid : v.grid > 0 ? t.import : t.export;
        return { label, ...fmtPower(v.grid == null ? null : Math.abs(v.grid)), entity: ent('grid'), color: col.grid };
      }
      case 'battery': {
        const b = v.battery;
        const extra = b == null || Math.abs(b) <= th ? '' : `${b > 0 ? '▲' : '▼'} ${Object.values(fmtPower(Math.abs(b))).join(' ')}`;
        if (v.battery_soc == null) return { label: t.battery, ...fmtPower(b), entity: ent('battery'), color: col.battery };
        return { label: t.battery, value: String(Math.round(v.battery_soc)), unit: '%', extra, entity: ent('battery_soc'), color: col.battery };
      }
      case 'self_sufficiency': {
        if (v.grid == null) return { label: t.self, value: '—', unit: '' };
        const load = (v.home || 0) + (v.ev || 0) + (v.heatpump || 0);
        const ss = load > 0 ? Math.round(clamp(1 - Math.max(0, v.grid) / load) * 100) : 100;
        return { label: t.self, value: String(ss), unit: '%' };
      }
      default: return { label: s, value: '—', unit: '' };
    }
  }

  _statHTML(s, dot) {
    const d = dot && s.color ? `<i class="dot" style="background:${esc(s.color)};color:${esc(s.color)}"></i>` : '';
    return `<div class="stat" data-entity="${esc(s.entity || '')}">
      <div class="label">${d}${esc(s.label)}</div>
      <div class="value">${esc(s.value)}<span class="unit">${esc(s.unit || '')}</span>${s.extra ? `<span class="extra">${esc(s.extra)}</span>` : ''}</div>
    </div>`;
  }

  _updateSky() {
    if (!this._built || !this._config) return;
    const $ = this.$, $$ = this.$$;
    const cfg = this._config;
    const now = new Date();
    let hour;
    if (this._demoHour != null) hour = this._demoHour;
    else if (cfg.demo_cycle) hour = (((Date.now() / 1000) % cfg.demo_cycle) / cfg.demo_cycle) * 24;
    else hour = now.getHours() + now.getMinutes() / 60;
    hour = ((hour % 24) + 24) % 24;

    const sun = this._hass && this._hass.states[cfg.sun_entity];
    let rise = 7, set = 19;
    if (sun) {
      const hod = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.getHours() + d.getMinutes() / 60; };
      rise = hod(sun.attributes.next_rising) ?? rise;
      set = hod(sun.attributes.next_setting) ?? set;
      if (set <= rise) { rise = 7; set = 19; }
    }
    const simulated = this._demoHour != null || cfg.demo_cycle;
    const useReal = !simulated && sun && typeof sun.attributes.elevation === 'number';

    const dayLen = set - rise;
    const f = (hour - rise) / dayLen;
    const isDay = f >= 0 && f <= 1;
    const nf = ((hour - set + 24) % 24) / (24 - dayLen);
    const el = useReal ? sun.attributes.elevation
      : isDay ? 48 * Math.sin(Math.PI * f) : -32 * Math.sin(Math.PI * clamp(nf));

    const key = `${hour.toFixed(2)}|${el.toFixed(2)}`;
    if (key === this._lastSky) return;
    this._lastSky = key;

    const n = clamp((6 - el) / 16);                          // 0 = day, 1 = night
    const g = el > -6 ? clamp(1 - Math.abs(el - 2) / 8) : 0; // golden hour
    const lamp = clamp((n - 0.2) / 0.45);

    const wrap = $('wrap');
    const set$ = (k, val) => wrap.style.setProperty(k, val);
    const floorFar = sampleStops(SKY_STOPS, el, 4), floorNear = sampleStops(SKY_STOPS, el, 5);
    set$('--sky-top', sampleStops(SKY_STOPS, el, 1));
    set$('--sky-hor', sampleStops(SKY_STOPS, el, 2));
    set$('--floor-near', floorNear);
    const glow = hex2rgb(sampleStops(SKY_STOPS, el, 3));
    set$('--glow', `rgba(${glow.join(',')},${(0.3 + 0.28 * n + 0.3 * g).toFixed(2)})`);
    const sunX = 6 + clamp(f) * 88;
    set$('--sun-x', `${sunX}%`);
    set$('--glow2', `rgba(255,${Math.round(235 - 75 * g)},${Math.round(200 - 110 * g)},${(isDay ? 0.25 + 0.4 * g : 0).toFixed(2)})`);
    $('fs0').setAttribute('stop-color', floorFar);
    $('fs1').setAttribute('stop-color', floorFar);
    $('fs2').setAttribute('stop-color', floorNear);

    // model relighting: cooler and dimmer at night, warm at golden hour
    const b = 1 - 0.24 * n;
    const rS = b * (1 - 0.12 * n), gS = b * (1 - 0.04 * n), bS = b;
    const rO = 0.06 * g, gO = 0.015 * g, bO = 0.05 * n - 0.04 * g;
    const mtx = `${rS.toFixed(3)} 0 0 0 ${rO.toFixed(3)}  0 ${gS.toFixed(3)} 0 0 ${gO.toFixed(3)}  0 0 ${bS.toFixed(3)} 0 ${bO.toFixed(3)}  0 0 0 1 0`;
    $$('.daymatrix').forEach((m) => m.setAttribute('values', mtx));
    $$('.sheen').forEach((s) => s.setAttribute('opacity', (1 - 0.75 * n).toFixed(2)));
    $$('.shine').forEach((s) => s.setAttribute('opacity', (0.18 * (1 - n)).toFixed(2)));

    // lights
    $$('.winwarm').forEach((w) => w.setAttribute('opacity', (0.12 + 0.88 * lamp).toFixed(2)));
    $$('.garagewarm').forEach((w) => w.setAttribute('opacity', (0.9 * lamp).toFixed(2)));
    $('spill').setAttribute('opacity', (0.75 * lamp).toFixed(2));
    $('bloom').setAttribute('opacity', lamp.toFixed(2));

    // sun & moon
    const sunEl = $('sun');
    sunEl.style.left = `${sunX}%`;
    sunEl.style.top = `${52 - (clamp(el, -12, 50) / 50) * 31}%`;
    sunEl.style.opacity = isDay || el > -4 ? '1' : '0';
    const low = clamp(1 - el / 14);
    sunEl.style.setProperty('--sun-a', mix('#ffe78f', '#ffb15c', low));
    sunEl.style.setProperty('--sun-b', mix('#ffcf52', '#ff7a3d', low));
    sunEl.style.setProperty('--sun-glow', `rgba(255,${Math.round(226 - 76 * low)},${Math.round(150 - 80 * low)},.45)`);

    const moon = $('moon');
    moon.style.left = `${8 + clamp(nf) * 84}%`;
    moon.style.top = `${44 - Math.sin(Math.PI * clamp(nf)) * 22}%`;
    moon.style.opacity = isDay ? '0' : clamp((n - 0.45) / 0.35).toFixed(2);
    $('stars').style.opacity = (clamp((-el - 3) / 7) * 0.8).toFixed(2);

    // subtitle: configured text, otherwise the (simulated) clock
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    $('subtitle').textContent = cfg.subtitle ?? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}

if (!customElements.get('home-energy-scene-card')) {
  customElements.define('home-energy-scene-card', HomeEnergySceneCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'home-energy-scene-card',
    name: 'House Energy Flow',
    description: 'Studio-style 3D house with solar, battery, EV, heat pump and grid flows, lit by the time of day.',
    preview: true,
  });
  console.info(`%c HOME-ENERGY-SCENE-CARD %c v${HESC_VERSION} `, 'background:#4ade80;color:#0f141c;font-weight:700', 'background:#0f141c;color:#fff');
}
