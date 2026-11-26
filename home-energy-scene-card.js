/*
 * Home Energy Scene Card
 * An animated Home Assistant Lovelace card in a dark "studio render" style: a white 3D house
 * with solar roof, home battery, EV, heat pump and grid connection on a glossy floor.
 * Power lines pulse when energy flows; backdrop and lighting follow the time of day.
 */
const HESC_VERSION = '3.3.0';

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
const VB_W = 400, VB_H = 285, OX = 190, OY = 232, K = 1.05;
// camera looks at the front-left corner of the house: +x along the street facade, +z away from the street
const AX = [0.93 * K, -0.12 * K], BZ = [-0.62 * K, -0.3 * K];
const P = (x, y, z, m = 1) => [OX + AX[0] * x + BZ[0] * z, OY + AX[1] * x + BZ[1] * z - m * K * y];
const pts = (arr, m) => arr.map(([x, y, z]) => P(x, y, z, m).map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (arr, fill, m, extra = '') =>
  `<polygon points="${pts(arr, m)}" fill="${fill}" stroke="${fill}" stroke-width=".5" stroke-linejoin="round" ${extra}/>`;
const seg = (a, b, m, stroke, w, extra = '') => {
  const p = P(...a, m), q = P(...b, m);
  return `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;
};
// local 2D frames (u = world x or z, v = -y): a wall facing the street (x/y plane) and a wall facing left (z/y plane)
const frameX = (x, y, z, m) => { const p = P(x, y, z, m); return `matrix(${AX[0]},${AX[1]},0,${m * K},${p[0].toFixed(2)},${p[1].toFixed(2)})`; };
const frameZ = (x, y, z, m) => { const p = P(x, y, z, m); return `matrix(${BZ[0]},${BZ[1]},0,${m * K},${p[0].toFixed(2)},${p[1].toFixed(2)})`; };
const rl = (u0, u1, y0, y1, fill, extra = '') =>
  `<rect x="${u0}" y="${-y1}" width="${+(u1 - u0).toFixed(2)}" height="${+(y1 - y0).toFixed(2)}" fill="${fill}" ${extra}/>`;
// visible faces from this viewpoint: front (z0), left (x0) and top
const box = (x0, x1, h, z0, z1, cf, cl, ct, m, y0 = 0) =>
  poly([[x0, y0, z0], [x1, y0, z0], [x1, h, z0], [x0, h, z0]], cf, m) +
  poly([[x0, y0, z0], [x0, y0, z1], [x0, h, z1], [x0, h, z0]], cl, m) +
  (m > 0 ? poly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], ct, m) : '');
// screen silhouette of a box (for click targets)
const hull = (x0, x1, y0, y1, z0, z1) => pts([[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 1);

// house: gable facing the street, ridge running back, garage on the left (1 unit ≈ 9 cm)
const HW = 94, HD = 110, HE = 56, HR = 112, OV = 4;
const PITCH = (HR - HE) / (HW / 2);
const LS = Math.hypot(HW / 2 + OV, HR - HE + OV * PITCH);                 // left roof plane, eave to ridge
const rpt = (z, v) => { const t = 1 - v / LS; return [-OV + (HW / 2 + OV) * t, HE - OV * PITCH + (HR - HE + OV * PITCH) * t, z]; };
const frameRoof = (m) => {
  const p = P(HW / 2, HR, 0, m), dx = HW / 2 + OV, dy = HR - HE + OV * PITCH;
  return `matrix(${BZ[0]},${BZ[1]},${((-AX[0] * dx) / LS).toFixed(4)},${((-AX[1] * dx + m * K * dy) / LS).toFixed(4)},${p[0].toFixed(2)},${p[1].toFixed(2)})`;
};
const GAR = { x0: -60, x1: 0, z0: 74, z1: 122, h: 34, d0: -35, d1: -6, dh: 22.2 };   // d0..d1 = open door
const PANELS = { groups: [6, 79], cols: 2, cw: 12.4, v0: 9, rows: 2, rh: 20.5 };   // 2x2 panels in front of and behind the dormer
const BAT = { x: -3.65, z0: 85.6, z1: 90.4, y0: 10.15, h: 0.45 };   // LED charge bar on the battery (Marstek Venus E, inside the garage)

const HUB = [-44, 0, -22];
const FLOWS = [
  { key: 'solar', w: [[-40, 0, -26], [-40, 0, -34], [6, 0, -34], [6, 0, -0.5], [6, 53, -0.5], [-0.5, 53, 1], [-0.5, 53, 18.4], rpt(18.4, 50)] },
  { key: 'home', w: [[-47, 0, -26], [-47, 0, -46], [44, 0, -46], [44, 0, -10.5], [44, 4, -10.5]] },
  { key: 'heatpump', w: [[-44, 0, -18], [-44, 0, 73.5], [-44, 34, 73.5], [-44, 34, 76], [-14, 34, 76], [-14, 34, 96], [-8.5, 34, 96]] },
  { key: 'battery', w: [[-40, 0, -20], [-31, 0, -20], [-31, 0, 80], [-6, 0, 80], [-6, 0, 88]] },
  { key: 'ev', w: [[-40, 0, -22], [-4, 0, -22], [-4, 0, 36], [-0.5, 0, 36], [-0.5, 13.5, 36]] },
  { key: 'grid', w: [[-54, 0, -24], [-54, 0, -58], [150, 0, -58], [150, 0, 10.5]] },
];

// label = text centre on screen (kept on dark surfaces); anchor = world point the dotted leader runs to
const LABELS = {
  grid: { at: [358, 196], anchor: [150, 0, 10.5] },
  home: { at: [266, 170], anchor: [79, 37, 0] },
  solar: { at: [153, 94], anchor: rpt(91.4, 22) },
  heatpump: { at: [94, 171.5], anchor: [-8, 40, 93], row: true },
  battery: { at: [50, 250], anchor: [-3.6, 9, 88] },
  ev: { at: [114, 250], anchor: [-28, 12, 6] },
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

// a white-framed window in a local wall frame, with warm night light
function windowL(u0, u1, y0, y1, m, { mull = [], tr = null, sill = true } = {}) {
  const f = 1.1;
  let s = '';
  if (sill) s += rl(u0 - 0.8, u1 + 0.8, y0 - 1.3, y0, '#d9dde2');
  s += rl(u0, u1, y0, y1, '#f4f6f8');
  s += rl(u0 + f, u1 - f, y0 + f, y1 - f, 'url(#gWin)');
  s += `<g class="winwarm">${rl(u0 + f, u1 - f, y0 + f, y1 - f, 'url(#gWinWarm)')}</g>`;
  if (m > 0) s += `<polygon class="shine" points="${u0 + f},${-(y0 + (y1 - y0) * 0.55)} ${u0 + f + (u1 - u0) * 0.25},${-(y1 - f)} ${u0 + f + (u1 - u0) * 0.38},${-(y1 - f)} ${u0 + f},${-(y0 + (y1 - y0) * 0.3)}" fill="#fff" opacity=".16"/>`;
  mull.forEach((u) => { s += rl(u - 0.6, u + 0.6, y0, y1, '#f4f6f8'); });
  if (tr != null) s += rl(u0, u1, tr - 0.5, tr + 0.5, '#f4f6f8');
  return s;
}

function house(m) {
  let s = '';
  // left side wall (faces the driveway)
  s += `<g transform="${frameZ(0, 0, 0, m)}">
    ${rl(0, HD, 0, HE, 'url(#pBrick)')}${rl(0, HD, 0, HE, '#000', 'opacity=".2"')}
    ${windowL(5, 17, 8, 31, m, { tr: 24 })}
    ${windowL(53, 59.5, 38, 47, m, { sill: false })}
    ${rl(59.3, 73.8, 0, 27.2, '#f4f6f8')}
    ${rl(60.3, 69.4, 0, 26.2, 'url(#gDoor)')}
    ${rl(67.4, 67.9, 7, 21, '#eef1f4')}
    ${rl(70.4, 72.8, 1, 26.2, 'url(#gWin)')}<g class="winwarm">${rl(70.4, 72.8, 1, 26.2, 'url(#gWinWarm)')}</g>
    ${rl(56.6, 58.2, 22, 26.5, '#16181c')}<g class="winwarm">${rl(56.8, 58, 22.3, 22.9, '#ffe7ab')}</g>
    ${rl(1.3, 2.5, 0, HE - 1, '#aeb5bd')}
  </g>`;
  // street gable
  s += `<g transform="${frameX(0, 0, 0, m)}">
    <polygon points="0,0 ${HW},0 ${HW},${-HE} ${HW / 2},${-HR} 0,${-HE}" fill="url(#pBrick)"/>
    <polygon points="0,0 ${HW},0 ${HW},${-HE} ${HW / 2},${-HR} 0,${-HE}" fill="url(#gWallLight)"/>
    ${rl(29, 65, 39, 41, '#d9dde2')}${windowL(30, 64, 41, 58, m, { sill: false })}
    ${rl(30, 64, 44, 58.5, 'url(#pShutter)')}${rl(29, 65, 57.5, 60.5, '#3b4048')}
    ${windowL(42.5, 50.5, 74, 97, m)}
  </g>`;
  // bay window volume
  s += `<g transform="${frameZ(14, 0, 0, m)}">${rl(-10, 0, 0, 32, 'url(#pBrick)')}${rl(-10, 0, 0, 32, '#000', 'opacity=".2"')}${rl(-10, 0, 30.5, 32.6, '#c4cad1')}</g>`;
  s += `<g transform="${frameX(0, 0, -10, m)}">
    ${rl(14, 80, 0, 32, 'url(#pBrick)')}${rl(14, 80, 0, 32, 'url(#gWallLight)')}${rl(14, 80, 30.5, 32.6, '#eceff2')}
    ${windowL(19, 75, 9, 27.5, m, { mull: [33, 47, 61], tr: 22.5 })}
  </g>`;
  if (m > 0) s += poly([[14, 32.6, -10], [80, 32.6, -10], [80, 32.6, 0], [14, 32.6, 0]], '#e2e6ea', m);
  if (m < 0) return s;

  // left roof plane with tiles and solar panels
  const { groups, cols, cw, v0, rows, rh } = PANELS;
  let pv = '';
  for (const u0 of groups) for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = u0 + c * cw + 0.5, v = v0 + r * rh + 0.5, w = cw - 1, h = rh - 1;
      pv += `<rect x="${a}" y="${v}" width="${w}" height="${h}" fill="url(#gPanel)" stroke="#4d5a70" stroke-width=".45"/>`;
      let g = '';
      for (let i = 1; i < 3; i++) g += `<path d="M${a + (w * i) / 3} ${v}v${h}" />`;
      for (let i = 1; i < 6; i++) g += `<path d="M${a} ${v + (h * i) / 6}h${w}" />`;
      pv += `<g stroke="#8fa3c4" stroke-width=".18" opacity=".35">${g}</g>`;
    }
  }
  s += `<g transform="${frameRoof(m)}">
    <rect x="-3" y="0" width="${HD + 6}" height="${LS}" fill="url(#pTiles)"/>
    <rect x="-3" y="0" width="${HD + 6}" height="${LS}" fill="url(#gRoofShade)"/>
    <rect x="-3" y="-1.2" width="${HD + 6}" height="2.6" fill="#16171a"/>
    ${pv}
    ${groups.map((u0) => `<rect class="sheen" x="${u0}" y="${v0}" width="${cols * cw}" height="${rows * rh}" fill="url(#gSheen)"/>`).join('')}
  </g>`;
  s += seg(rpt(-3, LS), rpt(HD + 3, LS), m, '#9aa2ab', 1.6, 'stroke-linecap="round"');

  // chimney (above the dormer, near the ridge)
  const cy = (x) => HE + PITCH * x;
  s += poly([[35, cy(35), 51], [35, cy(35), 59], [35, 128, 59], [35, 128, 51]], '#4a2119', m);
  s += poly([[35, cy(35), 51], [44, cy(44), 51], [44, 128, 51], [35, 128, 51]], '#6e3022', m);
  s += poly([[34, 128, 50], [45, 128, 50], [45, 128, 60], [34, 128, 60]], '#b8bec6', m);
  s += poly([[34, 128, 50], [45, 128, 50], [45, 126.5, 50], [34, 126.5, 50]], '#8b929b', m);

  // dormer
  const dz0 = 41, dz1 = 69, dx = 12, dt = 92, dxr = (dt - HE) / PITCH;
  s += poly([[dx, cy(dx), dz0], [dxr, dt, dz0], [dx, dt, dz0]], '#b9c0c8', m);
  s += `<g transform="${frameZ(dx, 0, 0, m)}">
    <polygon points="${dz0},${-cy(dx)} ${dz1},${-cy(dx)} ${dz1},${-dt} ${dz0},${-dt}" fill="url(#gDormer)"/>
    ${windowL(44, 54.5, 73, 89.5, m, { sill: false })}${windowL(55.5, 66, 73, 89.5, m, { sill: false })}
  </g>`;
  s += poly([[dx - 3, dt, dz0 - 1.5], [dxr + 1, dt, dz0 - 1.5], [dxr + 1, dt, dz1 + 1.5], [dx - 3, dt, dz1 + 1.5]], '#dfe3e8', m);
  s += poly([[dx - 3, dt, dz0 - 1.5], [dx - 3, dt, dz1 + 1.5], [dx - 3, dt - 3, dz1 + 1.5], [dx - 3, dt - 3, dz0 - 1.5]], '#c3c9d0', m);
  s += poly([[dx - 3, dt, dz0 - 1.5], [dxr + 1, dt, dz0 - 1.5], [dxr + 1, dt - 3, dz0 - 1.5], [dx - 3, dt - 3, dz0 - 1.5]], '#e9ecef', m);

  // verges on the street gable
  const vz = -3, dn = (p) => [p[0], p[1] - 3.4, p[2]];
  const L0 = [-OV, HE - OV * PITCH, vz], top = [HW / 2, HR + 1.5, vz], R0 = [HW + OV, HE - OV * PITCH, vz];
  s += poly([L0, top, dn(top), dn(L0)], '#1b1c20', m);
  s += poly([top, R0, dn(R0), dn(top)], '#26272c', m);
  s += seg(L0, top, m, '#cfd4da', 1.1, 'stroke-linecap="round"') + seg(top, R0, m, '#cfd4da', 1.1, 'stroke-linecap="round"');

  return s;
}

function garage(m) {
  const { x0, x1, z0, z1, h, d0, d1, dh } = GAR;
  let s = '';
  // interior seen through the open doors: white walls, concrete floor, warm light at night
  s += poly([[d0, 0, z0], [x1, 0, z0], [x1, 0, z1], [d0, 0, z1]], '#80868d', m);
  s += poly([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], '#d5dae0', m);
  s += poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], '#eef1f4', m);
  s += `<g class="garagewarm">${poly([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], 'url(#gGarageWarm)', m)}${poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], 'url(#gGarageWarm)', m)}</g>`;
  // outside walls
  s += `<g transform="${frameZ(x0, 0, 0, m)}">${rl(z0, z1, 0, h, 'url(#pWood)')}${rl(z0, z1, 0, h, '#000', 'opacity=".3"')}</g>`;
  s += poly([[d1, 0, z0], [d1, 0, z0 + 2], [d1, dh, z0 + 2], [d1, dh, z0]], '#6b4626', m);
  const hole = `M${x0} 0H${x1}V${-h}H${x0}ZM${d0} 0V${-dh}H${d1}V0Z`;
  s += `<g transform="${frameX(0, 0, z0, m)}">
    <path d="${hole}" fill="url(#pWood)" fill-rule="evenodd"/><path d="${hole}" fill="url(#gWallLight)" fill-rule="evenodd"/>
    ${rl(x0, x1, 22.2, 23, '#c9cfd6')}${rl(d0 - 0.5, d0, 0, dh, '#4a2f18')}
    ${rl(x0 + 4, x0 + 6, 28, 29.6, '#eef1f4')}
  </g>`;
  if (m > 0) {
    s += poly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], '#1d2026', m);
    s += poly([[x0, h, z0], [x1, h, z0], [x1, h - 1.6, z0], [x0, h - 1.6, z0]], '#c9cfd6', m);
    s += poly([[x0, h, z0], [x0, h, z1], [x0, h - 1.6, z1], [x0, h - 1.6, z0]], '#8f97a1', m);
  }
  return s;
}

// Marstek Venus E (black, rounded, on small feet), standing against the right garage wall, drawn ~1.5x size
function battery(m) {
  const x0 = -3.6, z0 = 84, z1 = 92, y0 = 0.7, y1 = 12;
  let s = '';
  [z0 + 0.8, z1 - 1.4].forEach((z) => { s += box(x0 + 0.6, x0 + 1.4, y0, z, z + 0.6, '#0b0c0e', '#0b0c0e', '#0b0c0e', m, 0); });
  s += box(x0, 0, y1, z0, z1, '#24272c', '#16181c', '#33363c', m, y0);
  s += `<g transform="${frameZ(x0 - 0.04, 0, 0, m)}">
    <rect x="${z0 + 0.15}" y="${-y1 + 0.1}" width="${z1 - z0 - 0.3}" height="${y1 - y0 - 0.2}" rx=".9" fill="url(#gVenus)"/>
    ${rl(z0 + 0.2, z1 - 0.2, 8.1, 8.3, '#9aa0a8')}
    <rect x="${BAT.z0}" y="${-(BAT.y0 + BAT.h)}" width="${BAT.z1 - BAT.z0}" height="${BAT.h}" fill="#3a3f46"/>
    ${[86.1, 87.1, 88.9, 89.9].map((z) => `<circle cx="${z}" cy="-11.1" r=".14" fill="#dfe5ec"/>`).join('')}
  </g>`;
  s += `<polygon class="socbar" points="" fill="#4ade80"/>`;
  return s;
}

function heatpump(m) {
  const y0 = GAR.h;   // on the garage roof, back against the house wall, fan facing the driveway
  let s = box(-8, 0, y0 + 12, 88, 104, '#bfc6cf', 'url(#gHp)', '#fbfcfd', m, y0);
  s += `<g transform="${frameZ(-8.05, y0 + 6, 93, m)} scale(.45)">
    <circle r="10" fill="#171b21"/>
    <g class="fan"><ellipse cy="-4.6" rx="2.4" ry="4.6" fill="#8f99a5"/><ellipse cy="-4.6" rx="2.4" ry="4.6" fill="#8f99a5" transform="rotate(120)"/><ellipse cy="-4.6" rx="2.4" ry="4.6" fill="#8f99a5" transform="rotate(240)"/><circle r="1.8" fill="#d5dbe2"/></g>
    <g fill="none" stroke="#4d5662" stroke-width=".6"><circle r="9.6"/><circle r="6.6"/><circle r="3.6"/><path d="M-9.6 0H9.6M0-9.6V9.6"/></g>
  </g>`;
  for (let y = y0 + 2.5; y <= y0 + 10; y += 1.8) s += seg([-8.05, y, 98], [-8.05, y, 102.5], m, '#a3abb5', 0.5);
  return s;
}

function tower(m) {
  const cx = 150, cz = 20, steel = '#b9c1cc', cap = 'stroke-linecap="round"';
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
  let s = `<g opacity=".45">${face(1, 2)}${face(2, 3)}${leg(2)}</g>`;
  s += face(3, 0) + leg(3) + face(0, 1) + leg(0) + leg(1);
  [[58, 14], [72, 10.5]].forEach(([y, L]) => {
    [-1, 1].forEach((d) => {
      const tip = [cx + d * L, y, cz], h = hw(y), drop = [tip[0], y - 4, cz];
      s += seg([cx + d * h, y, cz - h], tip, m, steel, 0.6, cap) + seg([cx + d * h, y, cz + h], tip, m, steel, 0.6, cap);
      s += seg([cx + d * hw(y + 5), y + 5, cz], tip, m, steel, 0.6, cap);
      const wire = [];
      for (let t = 0; t <= 1.001; t += 0.125) wire.push([tip[0], y - 4 - 9 * t * (1.5 - t), cz - 62 * t]);
      s += `<polyline points="${pts(wire, m)}" fill="none" stroke="#6b7482" stroke-width=".45"/>`;
      s += seg(tip, drop, m, '#e8edf2', 1.1, cap);
    });
  });
  return s;
}

function wallbox(m) {
  let s = box(-2.2, 0, 23, 34, 38.5, '#202329', '#121418', '#2c3037', m, 14);
  if (m > 0) {
    s += `<g transform="${frameZ(-2.25, 19.5, 36.25, m)}"><circle class="evled" r="1.25" fill="#334155"/></g>`;
    s += `<path d="M${P(-2.2, 15, 36.5).join(' ')} C${P(-4, 2, 34).join(' ')} ${P(-6, 1, 26).join(' ')} ${P(-6.5, 0.3, 20).join(' ')} S${P(-9, 4, 8).join(' ')} ${P(-10.4, 9.5, 8).join(' ')}" fill="none" stroke="#111318" stroke-width=".9" stroke-linecap="round"/>`;
  }
  return s;
}

function car(m) {
  const x0 = -30, x1 = -10, z0 = 6;   // parked nose-in towards the garage, rear to the street
  const prof = [[0, 3], [0, 8.2], [0.6, 11.4], [2.4, 15.3], [22, 16.5], [30.5, 15.6], [36.5, 11.6], [44.5, 9.7], [47, 7.6], [47, 3]];
  const S = (u, y) => [x0, y, z0 + u], B = (u, y) => [x1, y, z0 + u];
  const cols = ['url(#gCarRear)', '#121418', 'url(#gGlass)', '#16181c', '#16181c', 'url(#gGlass)', '#a9aeb4', '#979da3', '#848a90'];
  let s = '';
  for (let i = prof.length - 2; i >= 0; i--) {
    const a = prof[i], b = prof[i + 1];
    s += poly([S(...a), S(...b), B(...b), B(...a)], cols[i], m);
  }
  // rear: light bar and tail lights
  s += `<g transform="${frameX(x0, 0, z0 + 0.25, m)}">
    ${rl(0.8, 5.6, 9.1, 10.7, '#ef4444', 'class="taillight"')}${rl(14.4, 19.2, 9.1, 10.7, '#ef4444', 'class="taillight"')}
    ${rl(5.6, 14.4, 9.6, 10.2, '#7f1d1d')}${rl(0.6, 19.4, 3, 4.3, '#1a1d21')}
  </g>`;
  // near side
  s += poly(prof.map((p) => S(...p)), 'url(#gCarSide)', m);
  s += poly([S(3.2, 11.3), S(2.6, 15), S(22, 16.1), S(30.2, 15.3), S(35.6, 11.6)], '#111318', m);
  s += poly([S(4.1, 11.9), S(3.7, 14.5), S(15, 15.2), S(15, 11.9)], 'url(#gGlass)', m);
  s += poly([S(16.1, 11.9), S(16.1, 15.3), S(22, 15.6), S(29.4, 15), S(34.2, 11.9)], 'url(#gGlass)', m);
  s += poly([S(1.5, 3), S(45.5, 3), S(45.5, 4.4), S(1.5, 4.4)], '#3a3f45', m);
  s += seg(S(15.6, 4.6), S(15.6, 11.2), m, '#8d949b', 0.4);
  [9, 38.5].forEach((u) => {
    s += `<g transform="${frameZ(x0 - 0.1, 4.6, z0 + u, m)} scale(.62)">
      <circle r="7.4" fill="#14171c"/><circle r="6.1" fill="#0b0d10"/><circle r="4.2" fill="#2a2e34"/>
      <path d="M0 -4V4M-3.8 -1.2L3.8 1.2M-2.4 3.2L2.4 -3.2M-3.8 1.2L3.8 -1.2M-2.4 -3.2L2.4 3.2" stroke="#545b64" stroke-width=".9"/>
      <circle r="1.2" fill="#8b939d"/></g>`;
  });
  return s;
}

const solids = (m) => tower(m) + house(m) + garage(m) + heatpump(m) + battery(m) + wallbox(m) + car(m);

function shadows() {
  const fp = (x0, x1, z0, z1) => `<polygon points="${pts([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 1)}"/>`;
  return `<g fill="#000" opacity=".55" filter="url(#shadow)">
    ${fp(-4, HW + 3, -13, HD + 2)}${fp(-63, 1, 71, 124)}${fp(-32, -8, 3, 55)}${fp(141, 159, 11, 29)}
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
.lbl.row { font-size: clamp(6.5px, 1.8cqw, 9.5px); line-height: 1.05; }
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

  const leaders = Object.entries(LABELS).map(([key, { at, anchor, row }]) => {
    const a = P(...anchor);
    return `<line id="leader-${key}" class="leader hidden" x1="${at[0]}" y1="${at[1] + (a[1] > at[1] ? 1 : -1) * (row ? 7 : 11)}" x2="${a[0].toFixed(1)}" y2="${a[1].toFixed(1)}"/>
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
    <linearGradient id="gRefFade" gradientUnits="userSpaceOnUse" x1="0" y1="${OY}" x2="0" y2="${VB_H}"><stop offset="0" stop-color="#fff"/><stop offset=".75" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
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
    <linearGradient id="gCarSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9bec3"/><stop offset=".55" stop-color="#9da3a9"/><stop offset="1" stop-color="#70767c"/></linearGradient>
    <linearGradient id="gCarFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e7ec"/><stop offset="1" stop-color="#b3bbc5"/></linearGradient>
    <linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46587a"/><stop offset="1" stop-color="#0d121b"/></linearGradient>
    <linearGradient id="gSpill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc76b" stop-opacity=".75"/><stop offset="1" stop-color="#ffc76b" stop-opacity="0"/></linearGradient>
    <linearGradient id="gBolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f99d"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
    <radialGradient id="gHub"><stop offset="0" stop-color="#27303f"/><stop offset="1" stop-color="#0a0d13"/></radialGradient>
    <radialGradient id="gWarm"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset=".4" stop-color="#ffbf5e" stop-opacity=".35"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <pattern id="pBrick" patternUnits="userSpaceOnUse" width="10" height="3.6"><rect width="10" height="3.6" fill="#3b2723"/>
      <rect x=".15" y=".15" width="4.7" height="1.5" fill="#7b3627"/><rect x="5.15" y=".15" width="4.7" height="1.5" fill="#64291f"/>
      <rect x="-2.35" y="1.95" width="4.7" height="1.5" fill="#6d2d22"/><rect x="2.65" y="1.95" width="4.7" height="1.5" fill="#86412e"/><rect x="7.65" y="1.95" width="4.7" height="1.5" fill="#6d2d22"/></pattern>
    <pattern id="pWood" patternUnits="userSpaceOnUse" width="6.8" height="40"><rect width="3.4" height="40" fill="#a8733f"/><rect x="3.4" width="3.4" height="40" fill="#986639"/>
      <rect width=".22" height="40" fill="#4e3019"/><rect x="3.4" width=".22" height="40" fill="#5a381d"/></pattern>
    <pattern id="pTiles" patternUnits="userSpaceOnUse" width="4.2" height="3.4"><rect width="4.2" height="3.4" fill="#2e2d31"/><rect y="3" width="4.2" height=".4" fill="#17171a"/><rect width=".25" height="3.4" fill="#202023"/></pattern>
    <pattern id="pShutter" patternUnits="userSpaceOnUse" width="10" height="1.3"><rect width="10" height="1.3" fill="#7f858d"/><rect y="1.02" width="10" height=".28" fill="#5c6168"/></pattern>
    <linearGradient id="gWallLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
    <linearGradient id="gRoofShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
    <linearGradient id="gDormer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eceef1"/><stop offset="1" stop-color="#ccd1d7"/></linearGradient>
    <linearGradient id="gDoor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8bec5"/><stop offset="1" stop-color="#9aa1a9"/></linearGradient>
    <linearGradient id="gCarRear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6abb1"/><stop offset="1" stop-color="#7b8187"/></linearGradient>
    <linearGradient id="gVenus" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c3036"/><stop offset=".5" stop-color="#1a1c20"/><stop offset="1" stop-color="#101114"/></linearGradient>
  </defs>

  <!-- glossy studio floor -->
  <rect x="0" y="128" width="${VB_W}" height="${VB_H - 128}" fill="url(#gFloor)"/>
  <ellipse cx="200" cy="232" rx="210" ry="52" fill="url(#gFloorLight)"/>
  ${shadows()}

  <!-- mirror image on the floor -->
  <g mask="url(#refMask)"><g opacity=".42" filter="url(#refblur)"><g filter="url(#daylight)">${solids(-1)}</g></g></g>
  <polygon id="spill" points="${pts([[20, 0, -10.5], [74, 0, -10.5], [84, 0, -46], [10, 0, -46]], 1)}" fill="url(#gSpill)" opacity="0" filter="url(#soft)"/>

  <!-- the model -->
  <g id="exterior" filter="url(#daylight)">${solids(1)}</g>
  <g id="bloom" opacity="0" style="pointer-events:none">
    <ellipse cx="${P(47, 16, -10)[0].toFixed(1)}" cy="${P(47, 16, -10)[1].toFixed(1)}" rx="46" ry="30" fill="url(#gWarm)" opacity=".5"/>
  </g>

  <!-- click targets -->
  <g fill="transparent">
    <polygon class="device" data-key="home" points="${pts([[0, 0, HD], [0, 0, -10], [HW, 0, -10], [HW, HE, 0], [HW / 2, HR, 0], [HW / 2, HR, HD], [0, HE, HD]], 1)}"/>
    <polygon class="device" data-key="solar" points="${pts([rpt(PANELS.groups[0], PANELS.v0), rpt(PANELS.groups[1] + PANELS.cols * PANELS.cw, PANELS.v0), rpt(PANELS.groups[1] + PANELS.cols * PANELS.cw, PANELS.v0 + PANELS.rows * PANELS.rh), rpt(PANELS.groups[0], PANELS.v0 + PANELS.rows * PANELS.rh)], 1)}"/>
    <polygon class="device" data-key="battery" points="${hull(-3.6, 0, 0, 12, 84, 92)}"/>
    <polygon class="device" data-key="heatpump" points="${hull(-8, 0, GAR.h, GAR.h + 12, 88, 104)}"/>
    <polygon class="device" data-key="ev" points="${hull(-30, -10, 0, 17, 6, 53)}"/>
    <polygon class="device" data-key="grid" points="${hull(141, 159, 0, 84, 11, 29)}"/>
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
  return Object.entries(LABELS).map(([key, { at, row }]) => `
    <div id="lbl-${key}" class="lbl hidden${row ? ' row' : ''}" data-key="${key}" style="left:${((at[0] / VB_W) * 100).toFixed(2)}%;top:${((at[1] / VB_H) * 100).toFixed(2)}%;--c:${colors[key]}">
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
    const sw = soc == null ? 0 : ((BAT.z1 - BAT.z0) * clamp(soc, 0, 100)) / 100;
    const socCol = soc == null ? '#4ade80' : soc < 20 ? '#ef4444' : soc < 50 ? '#f59e0b' : '#4ade80';
    $$('.socbar').forEach((bar, i) => {
      const m = i === 0 ? -1 : 1; // the mirror image is first in the document
      bar.setAttribute('points', pts([[BAT.x, BAT.y0, BAT.z0], [BAT.x, BAT.y0, BAT.z0 + sw], [BAT.x, BAT.y0 + BAT.h, BAT.z0 + sw], [BAT.x, BAT.y0 + BAT.h, BAT.z0]], m));
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
