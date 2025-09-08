// ---------- API helpers ----------
const api = {
	status: () => fetch('/api/status').then(r => r.json()),
	reset: () => postJSON('/api/reset', {}),
	clear: () => postJSON('/api/clear', {}),
	scan: (opts = {}) => postJSON('/api/test/scan-u', opts),
	sideTest: (side) => postJSON('/api/test/side/' + side, {}),
	setU: (unum, color) => postJSON('/api/rack-unit-u/' + unum, { color }),
	blinkU: (unum, color, times = 3, interval = 250) => postJSON('/api/rack-unit-u/' + unum + '/blink', { color, times, interval }),
	equipSet: (id, color) => postJSON('/api/equipment/' + id, { color }),
	equipBlink: (id, color, times = 3, interval = 250) => postJSON('/api/equipment/' + id + '/blink', { color, times, interval }),
};
function postJSON(url, body) {
	return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
		.then(r => r.json());
}

// ---- Live WLED feed integration ----
let LIVE_ACTIVE = false;           // becomes true when live.ws is found
let LIVE_STRIDE = 3;               // bytes per pixel in the live feed (RGB=3)
let LATEST_LIVE_PIXELS = null;     // Uint8Array of the last frame
let LIVE_COUNT = 0;                // total pixels in the frame
let GLOBAL_MAP = null;             // { left:{start,len,reverse}, top:..., right:..., bottom:... }

// ---- WLED Live-View feed (direct) ----
let WLED_WS = null;
let WLED_PIXELS = null;   // Uint8Array of last live frame (RGBRGB…)
let WLED_COUNT = 0;      // number of LEDs in that frame
const WLED_STRIDE = 3;    // RGB

// ---------- Logging ----------
const $log = document.getElementById('log');
function logLine(...args) {
	const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
	$log.textContent = (new Date().toLocaleTimeString()) + ' | ' + line + '\n' + $log.textContent;
}

// ---------- State / refs ----------
const $statusBadge = document.getElementById('statusBadge');
const $rack = document.getElementById('rackCanvas');
const $rackHint = document.getElementById('rackHint');
const $equipList = document.getElementById('equipList');
const $monitor = document.getElementById('monitor');

let STATUS = null;

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
	const u = parseInt(document.getElementById('uNumber').value, 10);
	const color = document.getElementById('uColor').value || '#00FFAA';
	if (!Number.isInteger(u)) return alert('Enter a U number');
	logLine('U set', u, color);
	const res = await api.setU(u, color); logLine('→', res.message || JSON.stringify(res));
	refresh();
});
document.getElementById('uBlink').addEventListener('click', async () => {
	const u = parseInt(document.getElementById('uNumber').value, 10);
	const color = document.getElementById('uColor').value || '#FFBF00';
	if (!Number.isInteger(u)) return alert('Enter a U number');
	logLine('U blink', u, color);
	const res = await api.blinkU(u, color, 3, 250); logLine('→', res.message || JSON.stringify(res));
});

// ---------- Data + render ----------
async function refresh() {
	try {
		$statusBadge.textContent = 'loading…';
		STATUS = await api.status();
		$statusBadge.textContent = 'ok';
		renderRack(STATUS);
		renderEquipments(STATUS);
		renderMonitorShell(STATUS);   // create canvases/skeleton
		drawMonitor(STATUS);          // initial paint
		logLine('status', { rackUnitsCount: STATUS.rackUnitsCount, rackUnitSize: STATUS.rackUnitSize });
	} catch (e) {
		$statusBadge.textContent = 'error';
		logLine('status error', e);
	}
}

// ---------- Rack drawing (both rails labeled every U) ----------
function renderRack(state) {
	const U = state.rackUnitsCount || 42;
	const eqs = state.equipments || [];

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
	svg.setAttribute('class', 'w-full');

	svg.appendChild(rect(0, 0, width, height, 18, '#0A0F1C'));
	const railFill = '#0F172A';
	svg.appendChild(rect(padding, padding, railW, U * rowH, 10, railFill));
	svg.appendChild(rect(width - padding - railW, padding, railW, U * rowH, 10, railFill));

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

	const eqsArr = eqs;
	eqsArr.forEach(eq => {
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

	$rack.innerHTML = '';
	$rack.appendChild(svg);
	$rackHint.textContent = `Rack: ${U}U (top=U${U}, bottom=U1). Labels shown on both rails for every U.`;
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

// ---------- Live LED Monitor ----------
// Build rows/canvases once after we know lengths, then repaint on every status poll
function renderMonitorShell(state) {
  $monitor.innerHTML = '';
  const sides = ['left','top','right','bottom'];

  // lengths per side (already in your /api/status payload)
  const lengths = {
    left:   state.config?.left   || 0,
    top:    state.config?.top    || 0,
    right:  state.config?.right  || 0,
    bottom: state.config?.bottom || 0
  };

  // starts & reverse; if your /api/status already returns sideStart, we use it; else fallback to contiguous L→T→R→B
  const startFallback = {
    left:   0,
    top:    lengths.left,
    right:  lengths.left + lengths.top,
    bottom: lengths.left + lengths.top + lengths.right
  };
  const starts  = state.sideStart || startFallback;
  const reverse = state.reverse   || { left:false, top:false, right:false, bottom:false };

  GLOBAL_MAP = {
    left:   { start: 1,   len: 57, reverse: false },
    top:    { start: 58,  len: 15, reverse: false },
    right:  { start: 73,  len: 56, reverse: false },
    bottom: { start: 132, len: 14, reverse: false }
  };

  // build canvas rows
  sides.forEach(side => {
    const len = lengths[side];
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[80px_1fr] items-center gap-3';

    const label = document.createElement('div');
    label.className = 'text-xs text-slate-400 text-right';
    label.textContent = `${side.toUpperCase()} (${len})`;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'w-full rounded-xl border border-slate-800 bg-slate-950 overflow-hidden';
    const canvas = document.createElement('canvas');
    canvas.id = `led_${side}`;
    canvas.style.width = '100%';
    canvas.style.height = '18px';
    canvasWrap.appendChild(canvas);

    row.appendChild(label);
    row.appendChild(canvasWrap);
    $monitor.appendChild(row);
  });

  // first paint + keep responsive
  drawMonitor(STATUS);
  window.addEventListener('resize', () => drawMonitor(STATUS), { passive: true });

  // auto-connect to WLED live feed
  startWledLive();
}



function drawMonitor() {
  if (WLED_PIXELS && GLOBAL_MAP && WLED_COUNT > 0) {
    drawSideFromLive('left');
    drawSideFromLive('top');
    drawSideFromLive('right');
    drawSideFromLive('bottom');
  } else {
    // optional: draw placeholders
    ['left','top','right','bottom'].forEach(side => {
      const canvas = document.getElementById(`led_${side}`);
      if (!canvas) return;
      const cssWidth = canvas.clientWidth || 600;
      const cssHeight = parseInt((canvas.style.height || '18px'), 10) || 18;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0B1220';
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = '#64748B';
      ctx.font = '10px ui-sans-serif';
      ctx.fillText('waiting for live…', 8, cssHeight - 5);
      ctx.strokeStyle = '#1F2937';
      ctx.strokeRect(0.5, 0.5, cssWidth - 1, cssHeight - 1);
    });
  }
}


// Fallback painter (hex colors from backend)
function drawSideFromStates(side, arr) {
	const canvas = document.getElementById(`led_${side}`);
	if (!canvas || !arr) return;

	const cssWidth = canvas.clientWidth || 600;
	const cssHeight = parseInt((canvas.style.height || '18px'), 10) || 18;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.floor(cssWidth * dpr);
	canvas.height = Math.floor(cssHeight * dpr);

	const ctx = canvas.getContext('2d');
	ctx.scale(dpr, dpr);
	ctx.fillStyle = '#0B1220';
	ctx.fillRect(0, 0, cssWidth, cssHeight);

	const n = arr.length || 0;
	if (n === 0) return;
	const tileW = Math.max(1, cssWidth / n);

	for (let i = 0; i < n; i++) {
		const c = arr[i]?.color || '#000000';
		ctx.fillStyle = c;
		ctx.fillRect(i * tileW, 0, tileW + 0.5, cssHeight);
	}

	ctx.strokeStyle = '#1F2937';
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, cssWidth - 1, cssHeight - 1);
}

// Live painter (RGB bytes from WLED) using GLOBAL_MAP (start/len/reverse)
function drawSideFromLive(side) {
	const meta = GLOBAL_MAP?.[side];
	const canvas = document.getElementById(`led_${side}`);
	if (!meta || !canvas || !WLED_PIXELS) return;

	const { start, len, reverse } = meta;
	if (!Number.isInteger(start) || !Number.isInteger(len) || len <= 0) return;

	const cssWidth = canvas.clientWidth || 600;
	const cssHeight = parseInt((canvas.style.height || '18px'), 10) || 18;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.floor(cssWidth * dpr);
	canvas.height = Math.floor(cssHeight * dpr);
	const ctx = canvas.getContext('2d');
	ctx.scale(dpr, dpr);

	// background
	ctx.fillStyle = '#0B1220';
	ctx.fillRect(0, 0, cssWidth, cssHeight);

	const tileW = Math.max(1, cssWidth / len);

	for (let i = 0; i < len; i++) {
		const local = i;
		const global = start + (reverse ? (len - 1 - local) : local);
		if (global < 0 || global >= WLED_COUNT) continue;

		const o = global * WLED_STRIDE;
		const g = WLED_PIXELS[o] | 0;
		const b = WLED_PIXELS[o + 1] | 0;
		const r = WLED_PIXELS[o + 2] | 0;

		ctx.fillStyle = `rgb(${r},${g},${b})`;
		ctx.fillRect(i * tileW, 0, tileW + 0.5, cssHeight);
	}

	// outline
	ctx.strokeStyle = '#1F2937';
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, cssWidth - 1, cssHeight - 1);
}

function startWledLive() {
	try {
		if (WLED_WS && (WLED_WS.readyState === WebSocket.OPEN || WLED_WS.readyState === WebSocket.CONNECTING)) {
			return; // already connecting/connected
		}
	} catch (_) { }

	const URL = `ws://${STATUS.wled_ip}/ws`; // <- your WLED
	WLED_WS = new WebSocket(URL);
	WLED_WS.binaryType = 'arraybuffer';

	WLED_WS.onopen = () => {
		console.log('[WLED] WS connected:', URL);
		// Ask WLED to stream raw LED data
		// See https://kno.wled.ge/interfaces/json/ — { "lv": true } enables live view
		WLED_WS.send(JSON.stringify({ lv: true }));
	};

	WLED_WS.onmessage = (ev) => {
		// WLED /ws can send both JSON (text) and binary.
		if (typeof ev.data === 'string') {
			// JSON state messages — ignore for the pixel monitor
			// console.debug('[WLED] JSON', ev.data);
			return;
		}
		if (ev.data instanceof ArrayBuffer) {
			const u8 = new Uint8Array(ev.data);
			// Treat payload as flat RGB bytes
			const count = Math.floor(u8.length / WLED_STRIDE);
			if (count > 0) {
				WLED_PIXELS = u8;
				WLED_COUNT = count;
				// repaint immediately
				drawMonitor();
			}
		}
	};

	WLED_WS.onclose = () => {
		console.warn('[WLED] WS closed. Reconnecting in 3s…');
		setTimeout(startWledLive, 3000);
	};

	WLED_WS.onerror = (e) => {
		console.error('[WLED] WS error:', e);
		try { WLED_WS.close(); } catch (_) { }
	};
}


// Very small fallback: assume raw RGB stream with no header (count = pixels.length / stride)
function fallbackParsePixels(u8) {
	if (!u8 || u8.length < 3) return null;
	const stride = LIVE_STRIDE || 3;
	const count = Math.floor(u8.length / stride);
	return { count, pixels: u8 };
}

// ---------- Initial load ----------
refresh();
document.addEventListener('DOMContentLoaded', startWledLive);
