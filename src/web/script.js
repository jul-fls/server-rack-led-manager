// ---------- API helpers ----------
const api = {
  status: () => fetch('/api/status').then(r => r.json()),
  reset: () => postJSON('/api/reset', {}),
  clear: () => postJSON('/api/clear', {}),
  scan: (opts = {}) => postJSON('/api/test/scan-u', opts),
  sideTest: (side) => postJSON('/api/test/side/' + side, {}),
  setU: (unum, color) => postJSON('/api/rack-unit-u/' + unum, { color }),
  blinkU: (unum, color, times = 3, interval = 250) => postJSON('/api/rack-unit-u/' + unum + '/blink', { color, times, interval }),
  setURange: (range, color) => postJSON('/api/rack-unit-u/range/' + range, { color }),
  blinkURange: (range, color, times = 3, interval = 250) => postJSON('/api/rack-unit-u/range/' + range + '/blink', { color, times, interval }),
  equipSet: (id, color) => postJSON('/api/equipment/' + id, { color }),
  equipBlink: (id, color, times = 3, interval = 250) =>
    postJSON('/api/equipment/' + id + '/blink', { color, times, interval }),
};
function postJSON(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then(r => r.json());
}

// ---- Live WLED feed (direct) ----
let WLED_WS = null;
let WLED_PIXELS = null; // Uint8Array of last frame (RGB…)
let WLED_COUNT  = 0;    // number of LEDs
const WLED_STRIDE = 3;  // RGB

// ---- Mapping for monitor ----
let GLOBAL_MAP = null;  // { left:{start,len,reverse}, top:..., right:..., bottom:... }

// ---- UI refs ----
const $log = document.getElementById('log');
const $statusBadge = document.getElementById('statusBadge');
const $rack = document.getElementById('rackCanvas');
const $rackHint = document.getElementById('rackHint');
const $equipList = document.getElementById('equipList');

let STATUS = null;

// ---------- Logging ----------
function logLine(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  $log.textContent = (new Date().toLocaleTimeString()) + ' | ' + line + '\n' + $log.textContent;
}

// ---------- UI actions ----------
document.getElementById('refreshBtn').addEventListener('click', refresh);
document.getElementById('btnReset').addEventListener('click', async () => {
  logLine('reset');
  const res = await api.reset(); logLine('→', res.message || JSON.stringify(res));
  refresh();
});
document.getElementById('btnClear').addEventListener('click', async () => {
  logLine('clear');
  const res = await api.clear(); logLine('→', res.message || JSON.stringify(res));
  refresh();
});
document.getElementById('btnScan').addEventListener('click', async () => {
  logLine('scan U 42→1 start');
  const res = await api.scan(); logLine('→', res.message || JSON.stringify(res));
});
document.querySelectorAll('.sideTest').forEach(btn => {
  btn.addEventListener('click', async () => {
    const side = btn.getAttribute('data-side');
    logLine('side test', side);
    const res = await api.sideTest(side); logLine('→', res.message || JSON.stringify(res));
    refresh();
  });
});
document.getElementById('uSet').addEventListener('click', async () => {
  const uValue = document.getElementById('uNumber').value.trim();
  const color = document.getElementById('uColor').value || '#00FFAA';
  const rangeMatch = uValue.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    // use new API method
    const res = await api.setURange(rangeMatch[0], color);
    logLine('→', res.message || JSON.stringify(res));
    refresh();
    return;
  }
  const u = parseInt(uValue, 10);
  // if (!Number.isInteger(u)) return alert('Enter a U number');
  logLine('U set', u, color);
  const res = await api.setU(u, color); logLine('→', res.message || JSON.stringify(res));
  refresh();
});
document.getElementById('uBlink').addEventListener('click', async () => {
  const uValue = document.getElementById('uNumber').value.trim();
  const color = document.getElementById('uColor').value || '#FFBF00';
  const rangeMatch = uValue.match(/^(\d+)-(\d+)$/);
  console.log('uBlink', { uValue, rangeMatch });
  if (rangeMatch) {
    // use new API method
    const res = await api.blinkURange(rangeMatch[0], color, 3, 250);
    logLine('→', res.message || JSON.stringify(res));
    refresh();
    return;
  }
  const u = parseInt(uValue, 10);
  // if (!Number.isInteger(u)) return alert('Enter a U number');
  logLine('U blink', u, color);
  const res = await api.blinkU(u, color, 3, 250); logLine('→', res.message || JSON.stringify(res));
});

// ---------- Data + render ----------
async function refresh() {
  try {
    $statusBadge.textContent = 'loading…';
    STATUS = await api.status();
    $statusBadge.textContent = 'ok';

    renderRack(STATUS);       // builds SVG + embedded LED canvases
    renderEquipments(STATUS); // right-side cards
    buildGlobalMap(STATUS);   // compute side starts/length/reverse used by live painter

    // initial draw (placeholder until a live frame arrives)
    drawMonitor();

    // (re)connect live after we know the WLED IP (if provided by backend)
    startWledLive();

    logLine('status', { rackUnitsCount: STATUS.rackUnitsCount, rackUnitSize: STATUS.rackUnitSize });
  } catch (e) {
    $statusBadge.textContent = 'error';
    logLine('status error', e);
  }
}

// ---------- Compute mapping for live monitor ----------
function buildGlobalMap(state) {
  const lengths = {
    left:   57,
    top:    15,
    right:  56,
    bottom: 14
  };
  const starts  = {
    left:   1-state.calibrationOffset.left,
    top:    58-state.calibrationOffset.top,
    right:  73-state.calibrationOffset.right,
    bottom: 132-state.calibrationOffset.bottom
  };
  const reverse = {
    left:   true,
    top:    false,
    right:  false,
    bottom: true
  };

  GLOBAL_MAP = {
    left:   { start: starts.left,   len: lengths.left,   reverse: reverse.left   },
    top:    { start: starts.top,    len: lengths.top,    reverse: reverse.top    },
    right:  { start: starts.right,  len: lengths.right,  reverse: reverse.right  },
    bottom: { start: starts.bottom, len: lengths.bottom, reverse: reverse.bottom }
  };
}

// ---------- Rack drawing (SVG) with LED canvases around it ----------
function renderRack(state) {
  const U = state.rackUnitsCount || 42;
  const eqs = state.equipments || [];

  // Geometry constants
  const rowH = 24;
  const padding = 20;
  const railW = 18;
  const gutter = 28;
  const colW = 170;
  const width = padding + railW + gutter + colW + gutter + colW + gutter + railW + padding;
  const height = U * rowH + padding * 2;

  const leftColX = padding + railW + gutter;
  const rightColX = leftColX + colW + gutter;
  const spanX = leftColX;
  const spanW = (rightColX + colW) - leftColX;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'w-full block');

  // Background & rails
  svg.appendChild(rect(0, 0, width, height, 18, '#0A0F1C'));
  const railFill = '#0F172A';
  svg.appendChild(rect(padding, padding, railW, U * rowH, 10, railFill));
  svg.appendChild(rect(width - padding - railW, padding, railW, U * rowH, 10, railFill));

  // U grid + labels (both rails)
  for (let i = 0; i <= U; i++) {
    const y = padding + i * rowH;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', padding);
    line.setAttribute('x2', width - padding);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', i % 2 ? '#0B1220' : '#0D1526');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    if (i < U) {
      const unum = U - i;
      svg.appendChild(text(padding + railW / 2, y + rowH - 6, 'U' + unum, { fill: '#64748B', size: 10, anchor: 'middle' }));
      svg.appendChild(text(width - padding - railW / 2, y + rowH - 6, 'U' + unum, { fill: '#64748B', size: 10, anchor: 'middle' }));
    }
  }

  // Equipment blocks
  (eqs || []).forEach(eq => {
    const sides = (eq.sides && eq.sides.length) ? eq.sides : ['left', 'right'];
    const units = normalizeUArray(eq.rack_units, U);
    if (!units.length) return;

    const minU = Math.min(...units);
    const maxU = Math.max(...units);
    const topRowIndex = (U - maxU);
    const rows = (maxU - minU + 1);
    const y = padding + topRowIndex * rowH + 3;
    const h = Math.max(rows * rowH - 6, 18);
    const fill = softColor(eq.id);
    const label = eq.name || eq.id;

    if (sides.length === 2) {
      svg.appendChild(block(spanX, y, spanW, h, fill, label));
    } else if (sides[0] === 'left') {
      svg.appendChild(block(leftColX, y, colW, h, fill, label));
    } else if (sides[0] === 'right') {
      svg.appendChild(block(rightColX, y, colW, h, fill, label));
    }
  });

  // Place SVG
  $rack.innerHTML = '';
  $rack.appendChild(svg);

  // ----- Add the four LED canvases around the rack (positioned using SVG units -> CSS px) -----
  const monitorLayer = document.createElement('div');
  monitorLayer.className = 'pointer-events-none absolute inset-0';
  $rack.appendChild(monitorLayer);

  // geometry in SVG units
  const vBarW = 12;
  const hBarH = 10;
  const innerTop = padding;
  const innerBottom = padding + U * rowH;
  const innerLeftRail = padding;                          // left rail x (SVG units)
  const innerRightRail = width - padding - railW;         // right rail x (SVG units)
  const leftGutterX = innerLeftRail + railW;              // start of left gutter
  const rightGutterRight = innerRightRail;                // right edge before right rail
  const rightGutterX = rightGutterRight - gutter;         // start of right gutter

  // targets in SVG units
  const bars = {
    left:   { id: 'led_left',
              x: leftGutterX + (gutter - vBarW)/2 + 5,
              y: innerTop,
              w: vBarW,
              h: innerBottom - innerTop },
    right:  { id: 'led_right',
              x: rightGutterX + (gutter - vBarW)/2 + 5,
              y: innerTop,
              w: vBarW,
              h: innerBottom - innerTop },
    top:    { id: 'led_top',
              x: leftGutterX + gutter + 5,
              y: innerTop - Math.floor(hBarH/2),
              w: colW + gutter + colW,
              h: hBarH },
    bottom: { id: 'led_bottom',
              x: leftGutterX + gutter + 5,
              y: innerBottom - Math.floor(hBarH/2),
              w: colW + gutter + colW,
              h: hBarH }
  };

  // create bar wrappers once
  const canvases = {};
  for (const k of Object.keys(bars)) {
    const wrap = document.createElement('div');
    wrap.id = bars[k].id + '_wrap';
    Object.assign(wrap.style, {
      position: 'absolute',
      border: '1px solid #1F2937',
      borderRadius: '8px',
      background: '#0B1220',
      overflow: 'hidden'
    });
    const c = document.createElement('canvas');
    c.id = bars[k].id;
    c.style.width = '100%';
    c.style.height = '100%';
    wrap.appendChild(c);
    canvases[k] = wrap;
    monitorLayer.appendChild(wrap);
  }

  // helper: position a bar given SVG-units rect
  function placeCanvasSVGU(wrap, x, y, w, h) {
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width  / width;   // viewBox -> css px
    const scaleY = rect.height / height;

    const left = x * scaleX;
    const top  = y * scaleY;
    const cssW = Math.max(1, w * scaleX);
    const cssH = Math.max(1, h * scaleY);

    wrap.style.left   = `${left}px`;
    wrap.style.top    = `${top}px`;
    wrap.style.width  = `${cssW}px`;
    wrap.style.height = `${cssH}px`;
  }

  // initial placement
  for (const k of Object.keys(bars)) {
    const b = bars[k];
    placeCanvasSVGU(canvases[k], b.x, b.y, b.w, b.h);
  }

  // re-place on resize (SVG scales responsively)
  const onResize = () => {
    for (const k of Object.keys(bars)) {
      const b = bars[k];
      placeCanvasSVGU(canvases[k], b.x, b.y, b.w, b.h);
    }
    drawMonitor(); // repaint at new size
  };
  window.addEventListener('resize', onResize, { passive: true });

  // hint
  $rackHint.textContent = `Rack: ${U}U (top=U${U}, bottom=U1). LED bars mirror the physical strips (left/right in gutters, top/bottom across span).`;

  // --- helpers ---
  function rect(x, y, w, h, r, fill, stroke = '#0B1220') {
    const el = document.createElementNS(svgNS, 'rect');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('width', w); el.setAttribute('height', h);
    el.setAttribute('rx', r);
    el.setAttribute('fill', fill);
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', '1');
    return el;
  }
  function text(x, y, str, { fill = '#0B1220', size = 12, anchor = 'middle' } = {}) {
    const el = document.createElementNS(svgNS, 'text');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('fill', fill);
    el.setAttribute('font-size', size);
    el.setAttribute('font-weight', '600');
    el.setAttribute('text-anchor', anchor);
    el.textContent = str;
    return el;
  }
  function block(x, y, w, h, fill, label) {
    const g = document.createElementNS(svgNS, 'g');
    const r = rect(x, y, w, h, 12, fill, '#0B1220');
    r.setAttribute('opacity', '0.92');
    r.setAttribute('filter', 'drop-shadow(0 3px 8px rgba(0,0,0,0.25))');
    g.appendChild(r);

    const pad = 8;
    const maxFont = 14;
    const minFont = 10;
    const fs = Math.max(minFont, Math.min(maxFont, Math.floor((h - pad * 2) * 0.45)));

    const t = text(x + w / 2, y + h / 2 + fs / 3, label, { fill: '#0B1220', size: fs, anchor: 'middle' });
    g.appendChild(t);

    const title = document.createElementNS(svgNS, 'title');
    title.textContent = label;
    g.appendChild(title);

    return g;
  }
  function softColor(key) {
    const palette = ['#7DD3FC', '#6EE7B7', '#FDE68A', '#F9A8D4', '#A7F3D0', '#C4B5FD', '#FCA5A5', '#93C5FD'];
    let h = 0; for (let i = 0; i < String(key).length; i++) h = (h * 31 + String(key).charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }
  function normalizeUArray(arr, rackUnitsCount = 42) {
    if (!Array.isArray(arr)) return [];
    const zeroBased = arr.includes(0);
    return arr
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n))
      .map(n => zeroBased ? n + 1 : n)
      .filter(u => u >= 1 && u <= rackUnitsCount);
  }
}

// ---------- Equipments list ----------
function renderEquipments(state) {
  const eqs = state.equipments || [];
  $equipList.innerHTML = '';

  if (!eqs.length) {
    $equipList.innerHTML = '<div class="text-sm text-slate-400">No equipments in config.</div>';
    return;
  }

  eqs.forEach(eq => {
    const sides = (!eq.sides || eq.sides.length === 2) ? 'both' : eq.sides.join(' & ');
    const units = normalizeUArray(eq.rack_units, state.rackUnitsCount);
    const colorId = 'c_' + eq.id;

    const card = document.createElement('div');
    card.className = 'rounded-xl p-3 bg-slate-800/60 border border-slate-700';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="font-medium">${eq.name || eq.id}</div>
          <div class="text-xs text-slate-400">id: ${eq.id} • sides: ${sides} • U: ${units.join(', ') || '-'}</div>
        </div>
        <input id="${colorId}" type="color" class="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700" value="#00C2FF">
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button data-id="${eq.id}" class="equip-set px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm">Set Color</button>
        <button data-id="${eq.id}" class="equip-blink px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-sm">Blink</button>
      </div>
    `;
    $equipList.appendChild(card);

    card.querySelector('.equip-set').addEventListener('click', async () => {
      const color = document.getElementById(colorId).value || '#00C2FF';
      logLine('equipment set', eq.id, color);
      const res = await api.equipSet(eq.id, color);
      logLine('→', res.message || JSON.stringify(res));
      refresh();
    });
    card.querySelector('.equip-blink').addEventListener('click', async () => {
      const color = document.getElementById(colorId).value || '#FFBF00';
      logLine('equipment blink', eq.id, color);
      const res = await api.equipBlink(eq.id, color, 3, 250);
      logLine('→', res.message || JSON.stringify(res));
    });
  });

  function normalizeUArray(arr, rackUnitsCount = 42) {
    if (!Array.isArray(arr)) return [];
    const zeroBased = arr.includes(0);
    return arr
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n))
      .map(n => zeroBased ? n + 1 : n)
      .filter(u => u >= 1 && u <= rackUnitsCount);
  }
}

// ---------- Live LED drawing (only from WS) ----------
function drawMonitor() {
  if (WLED_PIXELS && GLOBAL_MAP && WLED_COUNT > 0) {
    drawSideFromLive('left');
    drawSideFromLive('right');
    drawSideFromLive('top');
    drawSideFromLive('bottom');
    return;
  }
  // placeholders
  ['left','right','top','bottom'].forEach(id => paintPlaceholder(`led_${id}`));
}

function paintPlaceholder(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const cssW = canvas.clientWidth || 100;
  const cssH = canvas.clientHeight || 20;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0B1220';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#64748B';
  ctx.font = '10px ui-sans-serif';
  ctx.fillText('waiting for live…', 6, cssH - 6);
  ctx.strokeStyle = '#1F2937';
  ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);
}

// Channel mapping: fix blue/green swap if needed
const CHANNEL_ORDER = 'RBG'; // adjust if needed: RGB / GRB / BGR / ...
function mapChannels(r,g,b) {
  switch (CHANNEL_ORDER) {
    case 'RBG': return [r,b,g];
    case 'GRB': return [g,r,b];
    case 'GBR': return [g,b,r];
    case 'BRG': return [b,r,g];
    case 'BGR': return [b,g,r];
    case 'RGB':
    default:    return [r,g,b];
  }
}

// Draw a side from the live frame using GLOBAL_MAP
function drawSideFromLive(side) {
  const meta = GLOBAL_MAP?.[side];
  const canvas = document.getElementById(`led_${side}`);
  if (!meta || !canvas || !WLED_PIXELS) return;

  const { start, len, reverse } = meta;
  if (!Number.isInteger(start) || !Number.isInteger(len) || len <= 0) return;

  const cssW = canvas.clientWidth  || 60;
  const cssH = canvas.clientHeight || 20;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // background
  ctx.fillStyle = '#0B1220';
  ctx.fillRect(0, 0, cssW, cssH);

  const stride = Math.max(3, Math.round(WLED_PIXELS.length / Math.max(1, WLED_COUNT)));
  const isHorizontal = (side === 'top' || side === 'bottom');

  if (isHorizontal) {
    // ---- horizontal bar (top/bottom): fill left -> right ----
    const tileW = Math.max(1, cssW / Math.max(1, len));
    for (let i = 0; i < len; i++) {
      const local = i;
      const global = start + (reverse ? (len - 1 - local) : local);
      if (global < 0 || global >= WLED_COUNT) continue;

      const o = global * stride;
      const B = WLED_PIXELS[o]   | 0;
      const G = WLED_PIXELS[o+1] | 0;
      const R = WLED_PIXELS[o+2] | 0;
      const [r, g, b] = mapChannels(R, G, B);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(i * tileW, 0, tileW + 0.5, cssH);
    }
  } else {
    // ---- vertical bar (left/right): fill top -> bottom ----
    const tileH = Math.max(1, cssH / Math.max(1, len));
    for (let i = 0; i < len; i++) {
      const local = i;
      const global = start + (reverse ? (len - 1 - local) : local);
      if (global < 0 || global >= WLED_COUNT) continue;

      const o = global * stride;
      const B = WLED_PIXELS[o]   | 0;
      const G = WLED_PIXELS[o+1] | 0;
      const R = WLED_PIXELS[o+2] | 0;
      const [r, g, b] = mapChannels(R, G, B);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, i * tileH, cssW, tileH + 0.5);
    }
  }

  // outline
  ctx.strokeStyle = '#1F2937';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);
}

// ---------- Live WS connect ----------
function startWledLive() {
  // Prefer backend-provided IP if available (STATUS.wled_ip), else the fixed one
  const ip = (STATUS && STATUS.wled_ip) ? STATUS.wled_ip : '192.168.30.19';
  const URL = `ws://${ip}/ws`;

  try {
    if (WLED_WS && (WLED_WS.readyState === WebSocket.OPEN || WLED_WS.readyState === WebSocket.CONNECTING)) {
      return;
    }
  } catch (_) {}

  WLED_WS = new WebSocket(URL);
  WLED_WS.binaryType = 'arraybuffer';

  WLED_WS.onopen = () => {
    console.log('[WLED] WS connected:', URL);
    // enable live view
    WLED_WS.send(JSON.stringify({ lv: true }));
  };

  WLED_WS.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      // JSON state – ignore for pixel bars
      return;
    }
    if (ev.data instanceof ArrayBuffer) {
      const u8 = new Uint8Array(ev.data);
      const count = Math.floor(u8.length / WLED_STRIDE);
      if (count > 0) {
        WLED_PIXELS = u8;
        WLED_COUNT = count;
        drawMonitor(); // paint immediately
      }
    }
  };

  WLED_WS.onclose = () => {
    console.warn('[WLED] WS closed. Reconnecting in 3s…');
    setTimeout(startWledLive, 3000);
  };

  WLED_WS.onerror = (e) => {
    console.error('[WLED] WS error:', e);
    try { WLED_WS.close(); } catch (_) {}
  };
}

// ---------- Initial load ----------
refresh();
