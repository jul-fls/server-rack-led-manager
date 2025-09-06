// ---------- API helpers ----------
    const api = {
      status: () => fetch('/api/status').then(r => r.json()),
      reset: () => postJSON('/api/reset', {}),
      clear: () => postJSON('/api/clear', {}),
      scan:  (opts={}) => postJSON('/api/test/scan-u', opts),
      sideTest: (side) => postJSON('/api/test/side/' + side, {}),
      setU: (unum, color) => postJSON('/api/rack-unit-u/' + unum, { color }),
      blinkU: (unum, color, times=3, interval=250) => postJSON('/api/rack-unit-u/' + unum + '/blink', { color, times, interval }),
      equipSet: (id, color) => postJSON('/api/equipment/' + id, { color }),
      equipBlink: (id, color, times=3, interval=250) => postJSON('/api/equipment/' + id + '/blink', { color, times, interval }),
    };
    function postJSON(url, body) {
      return fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) })
        .then(r => r.json());
    }

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

    let STATUS = null;

    // ---------- UI actions ----------
    document.getElementById('refreshBtn').addEventListener('click', refresh);
    document.getElementById('btnReset').addEventListener('click', async () => {
      logLine('reset');
      const res = await api.reset(); logLine('→', res.message || JSON.stringify(res));
    });
    document.getElementById('btnClear').addEventListener('click', async () => {
      logLine('clear');
      const res = await api.clear(); logLine('→', res.message || JSON.stringify(res));
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
      });
    });
    document.getElementById('uSet').addEventListener('click', async () => {
      const u = parseInt(document.getElementById('uNumber').value, 10);
      const color = document.getElementById('uColor').value || '#00FFAA';
      if (!Number.isInteger(u)) return alert('Enter a U number');
      logLine('U set', u, color);
      const res = await api.setU(u, color); logLine('→', res.message || JSON.stringify(res));
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
        logLine('status', { rackUnitsCount: STATUS.rackUnitsCount, rackUnitSize: STATUS.rackUnitSize });
      } catch (e) {
        $statusBadge.textContent = 'error';
        logLine('status error', e);
      }
    }

    // Draw a clean rack (top=Umax → bottom=U1). Dual-side equipment shows as ONE centered block.
    function renderRack(state) {
      const U = state.rackUnitsCount || 42;
      const eqs = state.equipments || [];

      // Layout knobs
      const rowH     = 24;     // px per U (roomier)
      const padding  = 20;
      const railW    = 18;
      const gutter   = 28;     // space between rail and columns
      const colW     = 170;    // single-side block width
      const width    = padding + railW + gutter + colW + gutter + colW + gutter + railW + padding;
      const height   = U * rowH + padding * 2;

      const leftColX  = padding + railW + gutter;
      const rightColX = leftColX + colW + gutter;
      const spanX     = leftColX;
      const spanW     = (rightColX + colW) - leftColX;

      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('class', 'w-full');

      // BG
      svg.appendChild(rect(0, 0, width, height, 18, '#0A0F1C'));

      // Rails
      const railFill = '#0F172A';
      svg.appendChild(rect(padding, padding, railW, U * rowH, 10, railFill));
      svg.appendChild(rect(width - padding - railW, padding, railW, U * rowH, 10, railFill));

      // U separators + labels
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
          const unum = U - i; // top = Umax
          if (unum % 2 === 0) {
            svg.appendChild(text(width - padding - railW / 2, y + rowH - 6, 'U' + unum, {
              fill: '#64748B', size: 10, anchor: 'middle'
            }));
          }
        }
      }

      // Equipment blocks
      eqs.forEach(eq => {
        const sides = (eq.sides && eq.sides.length) ? eq.sides : ['left','right'];
        const units = normalizeUArray(eq.rack_units, U);
        if (!units.length) return;

        const minU = Math.min(...units);
        const maxU = Math.max(...units);
        const topRowIndex = (U - maxU);
        const rows = (maxU - minU + 1);
        const y = padding + topRowIndex * rowH + 3;
        const h = Math.max(rows * rowH - 6, 18); // min height so text fits

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

      // ---- helpers ----
      function rect(x,y,w,h,r,fill,stroke='#0B1220') {
        const el = document.createElementNS(svgNS, 'rect');
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', w); el.setAttribute('height', h);
        el.setAttribute('rx', r);
        el.setAttribute('fill', fill);
        el.setAttribute('stroke', stroke);
        el.setAttribute('stroke-width', '1');
        return el;
      }
      function text(x,y,str,{fill='#0B1220',size=12,anchor='middle'}={}) {
        const el = document.createElementNS(svgNS, 'text');
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('fill', fill);
        el.setAttribute('font-size', size);
        el.setAttribute('font-weight', '600');
        el.setAttribute('text-anchor', anchor);
        el.textContent = str;
        return el;
      }
      function block(x,y,w,h,fill,label) {
        const g = document.createElementNS(svgNS, 'g');

        const r = rect(x, y, w, h, 12, fill, '#0B1220');
        r.setAttribute('opacity', '0.92');
        r.setAttribute('filter', 'drop-shadow(0 3px 8px rgba(0,0,0,0.25))');
        g.appendChild(r);

        const pad = 8;
        const maxFont = 14;
        const minFont = 10;
        const fs = Math.max(minFont, Math.min(maxFont, Math.floor((h - pad*2) * 0.45)));

        const t = text(x + w/2, y + h/2 + fs/3, label, { fill: '#0B1220', size: fs, anchor: 'middle' });
        g.appendChild(t);

        const title = document.createElementNS(svgNS, 'title');
        title.textContent = label;
        g.appendChild(title);

        return g;
      }
      function softColor(key) {
        const palette = ['#7DD3FC','#6EE7B7','#FDE68A','#F9A8D4','#A7F3D0','#C4B5FD','#FCA5A5','#93C5FD'];
        let h = 0; for (let i = 0; i < String(key).length; i++) h = (h * 31 + String(key).charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
      }
      function normalizeUArray(arr, rackUnitsCount=42) {
        if (!Array.isArray(arr)) return [];
        const zeroBased = arr.includes(0);
        return arr
          .map(n => parseInt(n, 10))
          .filter(n => Number.isInteger(n))
          .map(n => zeroBased ? n + 1 : n)
          .filter(u => u >= 1 && u <= rackUnitsCount);
      }

      // Mount
      $rack.innerHTML = '';
      $rack.appendChild(svg);
      $rackHint.textContent = `Rack: ${U}U (top=U${U}, bottom=U1). Centered blocks span both sides; single-side blocks sit in their column.`;
    }

    // Equipment list with color + actions
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
        });
        card.querySelector('.equip-blink').addEventListener('click', async () => {
          const color = document.getElementById(colorId).value || '#FFBF00';
          logLine('equipment blink', eq.id, color);
          const res = await api.equipBlink(eq.id, color, 3, 250);
          logLine('→', res.message || JSON.stringify(res));
        });
      });

      function normalizeUArray(arr, rackUnitsCount=42) {
        if (!Array.isArray(arr)) return [];
        const zeroBased = arr.includes(0);
        return arr
          .map(n => parseInt(n, 10))
          .filter(n => Number.isInteger(n))
          .map(n => zeroBased ? n + 1 : n)
          .filter(u => u >= 1 && u <= rackUnitsCount);
      }
    }

    // Initial load
    refresh();