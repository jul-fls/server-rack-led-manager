// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// --- Load JSON config (no rack-height math) ---
const CONFIG_PATH = process.env.LED_CONFIG_PATH || './led_strip_config.json';
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Validate minimal shape
const SIDES = ['left', 'top', 'right', 'bottom'];
SIDES.forEach(side => {
  if (!config.common?.[side]?.length) {
    throw new Error(`Missing common.${side}.length in ${CONFIG_PATH}`);
  }
  if (config.common[side].start === undefined) config.common[side].start = 0;
  if (config.common[side].reverse === undefined) config.common[side].reverse = false;
});

// LED lengths per side come from JSON
const ledConfig = {
  left:   config.common.left.length,
  top:    config.common.top.length,
  right:  config.common.right.length,
  bottom: config.common.bottom.length
};

// Rack unit height in LEDs (default 3)
const RACK_UNIT_SIZE =
  Number.isInteger(config.common?.rack_unit_size) && config.common.rack_unit_size > 0
    ? config.common.rack_unit_size
    : 3;

// How many RUs in the rack (default 42)
const RACK_UNITS_COUNT =
  Number.isInteger(config.common?.rack_units_count) && config.common.rack_units_count > 0
    ? config.common.rack_units_count
    : 42;

// In-memory state (0-indexed, default off)
const ledStates = {
  left:   Array(ledConfig.left).fill({ color: '#000000' }),
  top:    Array(ledConfig.top).fill({ color: '#000000' }),
  right:  Array(ledConfig.right).fill({ color: '#000000' }),
  bottom: Array(ledConfig.bottom).fill({ color: '#000000' })
};

// Build fallback global offsets using the declared order (used only if side.start is not set)
const sideOffsets = {
  left:   0,
  top:    ledConfig.left,
  right:  ledConfig.left + ledConfig.top,
  bottom: ledConfig.left + ledConfig.top + ledConfig.right
};

// Helper: local side index -> global index (honors side reverse & absolute start)
function toGlobalIndex(side, localIndex) {
  const { reverse, start } = config.common[side];
  const base = (typeof start === 'number') ? start : sideOffsets[side];
  const effectiveLocal = reverse ? (ledConfig[side] - 1 - localIndex) : localIndex;
  return base + effectiveLocal;
}

// Helper: build WLED patch from { side, index, color } pairs
function buildPatch(pairs) {
  const arr = [];
  for (const { side, index, color } of pairs) {
    const globalIndex = toGlobalIndex(side, index);
    arr.push(globalIndex, color.replace(/^#/, ''));
  }
  return { seg: { i: arr } };
}

// -------- Vertical mapping with side-level integer offset only --------

// Shared vertical ruler
const VERTICAL_H = (typeof config.common.vertical_height === 'number' && config.common.vertical_height > 1)
  ? config.common.vertical_height
  : Math.max(ledConfig.left, ledConfig.right, 2);

const CANONICAL_H = (Number.isInteger(config.common?.rack_units_count) && config.common.rack_units_count > 0
  ? config.common.rack_units_count
  : 42) * RACK_UNIT_SIZE;

function getSideOffsetCalib(side) {
  const c = config.common[side]?.calibration;
  return (c && Number.isInteger(c.offset)) ? c.offset : 0;
}

// Baseline linear map: v (0..H-1) -> local float (0..len-1)
// function vToLocalLinear(side, v) {
//   const len = ledConfig[side];
//   if (len <= 0) throw new Error(`Side "${side}" has no LEDs.`);
//   if (!Number.isInteger(v) || v < 0 || v >= VERTICAL_H) {
//     throw new Error(`Vertical index ${v} out of range 0..${VERTICAL_H-1}`);
//   }
//   return (v / (VERTICAL_H - 1)) * (len - 1);
// }

// Baseline linear map: v (0..CANONICAL_H-1) -> local float (0..len-1)
function vToLocalLinear(side, v) {
  const len = ledConfig[side];
  if (len <= 0) throw new Error(`Side "${side}" has no LEDs.`);
  if (!Number.isInteger(v) || v < 0 || v >= CANONICAL_H) {
    throw new Error(`Vertical index ${v} out of range 0..${CANONICAL_H-1}`);
  }
  return (v / (CANONICAL_H - 1)) * (len - 1);
}


// Final vertical -> local int, applying side-level integer offset and clamping
function vToLocal(side, v) {
  const base = vToLocalLinear(side, v);                   // float
  const local = Math.round(base) + getSideOffsetCalib(side); // int + offset
  return Math.max(0, Math.min(ledConfig[side] - 1, local));  // clamp
}

function verticalSegmentToLocalPairs(side, vStart, vLength, color) {
  const pairs = [];
  for (let dv = 0; dv < vLength; dv++) {
    const v = vStart + dv;
    const local = vToLocal(side, v);
    ledStates[side][local] = { color };
    pairs.push({ side, index: local, color });
  }
  return pairs;
}

// Normalize vertical spec (rack units -> LED rows) unless explicitly { unit: "leds" }
function normalizeVerticalSpec(vSpec) {
  if (!vSpec || !Number.isInteger(vSpec.start) || !Number.isInteger(vSpec.length)) {
    throw new Error(`Invalid vertical spec: ${JSON.stringify(vSpec)}`);
  }
  if (vSpec.unit && vSpec.unit.toLowerCase() === 'leds') {
    return { vStart: vSpec.start, vLength: vSpec.length };
  }
  // Default values are in rack units (U)
  return {
    vStart: vSpec.start * RACK_UNIT_SIZE,
    vLength: vSpec.length * RACK_UNIT_SIZE
  };
}

// Map U number (1..RACK_UNITS_COUNT) to vertical segment (vStart, vLength) proportionally
// function uToVertical(unum) {
//   if (!Number.isInteger(unum) || unum < 1 || unum > RACK_UNITS_COUNT) {
//     throw new Error(`U number ${unum} out of range 1..${RACK_UNITS_COUNT}`);
//   }
//   // Proportional mapping works even if VERTICAL_H !== RACK_UNIT_SIZE * RACK_UNITS_COUNT
//   const vStartFloat = ((unum - 1) * VERTICAL_H) / RACK_UNITS_COUNT;
//   const vEndFloat   = ( unum      * VERTICAL_H) / RACK_UNITS_COUNT;

//   let vStart = Math.round(vStartFloat);
//   let vEnd   = Math.round(vEndFloat) - 1; // inclusive
//   if (vEnd < vStart) vEnd = vStart;       // at least 1 row

//   // clamp
//   vStart = Math.max(0, Math.min(VERTICAL_H - 1, vStart));
//   vEnd   = Math.max(0, Math.min(VERTICAL_H - 1, vEnd));

//   const vLength = (vEnd - vStart + 1);
//   return { vStart, vLength };
// }

// Map U number (1..RACK_UNITS_COUNT) to a fixed vertical segment of size RACK_UNIT_SIZE
function uToVertical(unum) {
  if (!Number.isInteger(unum) || unum < 1 || unum > RACK_UNITS_COUNT) {
    throw new Error(`U number ${unum} out of range 1..${RACK_UNITS_COUNT}`);
  }
  const vStart = (unum - 1) * RACK_UNIT_SIZE;
  const vEnd   = vStart + RACK_UNIT_SIZE - 1; // inclusive
  // clamp to canonical ruler
  const cStart = Math.max(0, Math.min(CANONICAL_H - 1, vStart));
  const cEnd   = Math.max(0, Math.min(CANONICAL_H - 1, vEnd));
  return { vStart: cStart, vLength: (cEnd - cStart + 1) };
}


// WLED patch sender
async function updateWLEDPatch(payload) {
  try {
    await axios.post(process.env.WLED_API_URL, payload);
  } catch (err) {
    console.error('Error updating WLED:', err.message);
    throw err;
  }
}

// ---------------- Optional legacy maps: rack units & equipments ----------------

// Each rack unit -> array of segments. Segment kinds:
// - { kind: 'local',    side, start, length }        // side-local indices
// - { kind: 'vertical', side, vStart, vLength }      // vertical indices (mapped per side)
const rackUnitMap = new Map();
(config.rack_units || []).forEach(u => {
  const segments = [];

  // Legacy per-side local segments (if present)
  SIDES.forEach(side => {
    if (u[side] && typeof u[side].start === 'number' && typeof u[side].length === 'number') {
      segments.push({ kind: 'local', side, start: u[side].start, length: u[side].length });
    }
  });

  // Shared vertical slice -> apply to left and right (only if provided)
  if (u.vertical && Number.isInteger(u.vertical.start) && Number.isInteger(u.vertical.length)) {
    const { vStart, vLength } = normalizeVerticalSpec(u.vertical);
    ['left', 'right'].forEach(side => {
      if (ledStates[side]) {
        segments.push({ kind: 'vertical', side, vStart, vLength });
      }
    });
  }

  rackUnitMap.set(u.id, segments);
});

// Each equipment -> aggregated segments of its rack_units (preserving kind)
const equipmentMap = new Map();
(config.equipments || []).forEach(eq => {
  const segs = [];
  (eq.rack_units || []).forEach(uid => {
    const uSegs = rackUnitMap.get(uid);
    if (uSegs && uSegs.length) segs.push(...uSegs);
  });
  equipmentMap.set(eq.id, { meta: eq, segments: segs });
});

// Fill a continuous range on a side (local indices)
function rangeToPairs(side, start, length, color) {
  if (!ledStates[side]) throw new Error(`Invalid side "${side}"`);
  if (start < 0 || length < 0 || start + length > ledConfig[side]) {
    throw new Error(`Out-of-range segment on "${side}" (start=${start}, length=${length})`);
  }
  const pairs = [];
  for (let i = 0; i < length; i++) {
    const idx = start + i;
    ledStates[side][idx] = { color };
    pairs.push({ side, index: idx, color });
  }
  return pairs;
}

// ---- Routes ----

// Status
app.get('/api/status', (req, res) => {
  res.json({
    config: ledConfig,
    reverse: {
      left: config.common.left.reverse,
      top: config.common.top.reverse,
      right: config.common.right.reverse,
      bottom: config.common.bottom.reverse
    },
    calibrationOffset: {
      left: getSideOffsetCalib('left'),
      top: getSideOffsetCalib('top'),
      right: getSideOffsetCalib('right'),
      bottom: getSideOffsetCalib('bottom')
    },
    verticalHeight: VERTICAL_H,
    rackUnitSize: RACK_UNIT_SIZE,
    rackUnitsCount: RACK_UNITS_COUNT,
    states: ledStates
  });
});

// Manual side LED control (local indices)
app.post('/api/led/:side', async (req, res) => {
  const side = req.params.side;
  const commands = req.body.leds;
  if (!ledStates.hasOwnProperty(side)) {
    return res.status(400).json({ error: 'Invalid side specified.' });
  }
  if (!Array.isArray(commands)) {
    return res.status(400).json({ error: 'LED commands should be an array.' });
  }

  const pairs = [];
  for (const { index, color } of commands) {
    if (typeof index !== 'number' || index < 0 || index >= ledConfig[side]) {
      return res.status(400).json({ error: `Invalid LED index ${index} for side "${side}".` });
    }
    if (!color) return res.status(400).json({ error: 'Missing color.' });
    ledStates[side][index] = { color };
    pairs.push({ side, index, color });
  }

  try {
    await updateWLEDPatch(buildPatch(pairs));
  } catch {
    return res.status(500).json({ error: 'Failed to update WLED instance.' });
  }
  res.json({ message: `Updated ${side}`, count: pairs.length });
});

// Math-driven: color a rack unit by U number (no rack_units needed)
app.post('/api/rack-unit-u/:unum', async (req, res) => {
  const unum = parseInt(req.params.unum, 10);
  const { color } = req.body || {};
  if (!color) return res.status(400).json({ error: 'Missing "color".' });

  try {
    const { vStart, vLength } = uToVertical(unum);

    const sidesToFill = ['left', 'right'].filter(side => ledStates[side]);
    if (sidesToFill.length === 0) {
      return res.status(400).json({ error: 'No vertical sides (left/right) configured.' });
    }

    let pairs = [];
    for (const side of sidesToFill) {
      pairs = pairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, color));
    }

    await updateWLEDPatch(buildPatch(pairs));

    // Return explicit mapping for traceability
    const details = [];
    for (const side of sidesToFill) {
      for (let dv = 0; dv < vLength; dv++) {
        const v = vStart + dv;
        const localIndex = vToLocal(side, v);
        const globalIndex = toGlobalIndex(side, localIndex);
        details.push({ side, v, localIndex, globalIndex, color });
      }
    }

    res.json({
      message: `Lit U${unum} on ${sidesToFill.join('&')} with ${color}`,
      rackUnitsCount: RACK_UNITS_COUNT,
      verticalHeight: VERTICAL_H,
      vStart,
      vLength,
      offsets: {
        left: getSideOffsetCalib('left'),
        right: getSideOffsetCalib('right')
      },
      details
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * POST /api/rack-unit-u/:unum/blink
 * Blink a rack unit (by U number, math-driven).
 * Body: { "color": "#RRGGBB", "times": 3, "interval": 500 }
 */
app.post('/api/rack-unit-u/:unum/blink', async (req, res) => {
  const unum = parseInt(req.params.unum, 10);
  const { color = '#FF0000', times = 3, interval = 500 } = req.body || {};

  try {
    const { vStart, vLength } = uToVertical(unum);
    const sidesToBlink = ['left', 'right'].filter(side => ledStates[side]);

    if (sidesToBlink.length === 0) {
      return res.status(400).json({ error: 'No vertical sides (left/right) configured.' });
    }

    res.json({
      message: `Blinking U${unum} on ${sidesToBlink.join('&')} with ${color}, ${times} times, ${interval}ms interval`
    });

    (async () => {
      for (let t = 0; t < times; t++) {
        // ON
        let onPairs = [];
        for (const side of sidesToBlink) {
          onPairs = onPairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, color));
        }
        await updateWLEDPatch(buildPatch(onPairs));
        await new Promise(r => setTimeout(r, interval));

        // OFF
        let offPairs = [];
        for (const side of sidesToBlink) {
          offPairs = offPairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, '#000000'));
        }
        await updateWLEDPatch(buildPatch(offPairs));
        await new Promise(r => setTimeout(r, interval));
      }
    })().catch(err => console.error('U-blink failed:', err.message));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Legacy: color a whole equipment by ID (union of its rack units)
app.post('/api/equipment/:id', async (req, res) => {
  const id = req.params.id;
  const { color } = req.body;
  if (!color) return res.status(400).json({ error: 'Missing "color".' });

  const eq = equipmentMap.get(id);
  if (!eq) return res.status(404).json({ error: `Unknown equipment "${id}".` });

  try {
    let pairs = [];
    for (const seg of eq.segments) {
      if (seg.kind === 'local') {
        pairs = pairs.concat(rangeToPairs(seg.side, seg.start, seg.length, color));
      } else if (seg.kind === 'vertical') {
        pairs = pairs.concat(verticalSegmentToLocalPairs(seg.side, seg.vStart, seg.vLength, color));
      }
    }
    await updateWLEDPatch(buildPatch(pairs));
    res.json({ message: `Equipment ${id} (${eq.meta.name}) updated`, segments: eq.segments.length, leds: pairs.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Clear all (black off)
app.post('/api/clear', async (req, res) => {
  let pairs = [];
  SIDES.forEach(side => {
    for (let i = 0; i < ledConfig[side]; i++) {
      ledStates[side][i] = { color: '#000000' };
      pairs.push({ side, index: i, color: '#000000' });
    }
  });
  try {
    await updateWLEDPatch(buildPatch(pairs));
    res.json({ message: 'All LEDs cleared (black #000000)' });
  } catch {
    res.status(500).json({ error: 'Failed to update WLED instance.' });
  }
});

// Reset all (white)
app.post('/api/reset', async (req, res) => {
  let pairs = [];
  SIDES.forEach(side => {
    for (let i = 0; i < ledConfig[side]; i++) {
      ledStates[side][i] = { color: '#FFFFFF' };
      pairs.push({ side, index: i, color: '#FFFFFF' });
    }
  });

  try {
    await updateWLEDPatch(buildPatch(pairs));
    res.json({ message: 'All LEDs reset to white (#FFFFFF)' });
  } catch {
    res.status(500).json({ error: 'Failed to reset LEDs on WLED instance.' });
  }
});

/**
 * POST /api/test/side/:side
 * Tests side length & direction:
 *  - index 0  -> Blue  (#0000FF)
 *  - index N-1-> Red   (#FF0000)
 *  - others   -> Green (#00FF00)
 * Returns the full list of {localIndex, globalIndex, color}.
 */
app.post('/api/test/side/:side', async (req, res) => {
  const side = req.params.side;

  if (!SIDES.includes(side)) {
    return res.status(400).json({ error: `Invalid side "${side}".` });
  }

  const length = ledConfig[side];
  if (length <= 0) {
    return res.status(400).json({ error: `Side "${side}" has no LEDs configured.` });
  }

  try {
    const details = [];
    const pairs = [];

    for (let i = 0; i < length; i++) {
      const color =
        i === 0 ? '#0000FF' : (i === length - 1 ? '#FF0000' : '#00FF00');

      ledStates[side][i] = { color };

      const globalIndex = toGlobalIndex(side, i);
      details.push({
        localIndex: i,
        globalIndex,
        color
      });

      pairs.push({ side, index: i, color });
    }

    await updateWLEDPatch(buildPatch(pairs));

    res.json({
      message: `Tested side "${side}" (${length} LEDs). Start=Blue, End=Red, Middle=Green.`,
      leds: length,
      reverse: !!config.common[side].reverse,
      offset: getSideOffsetCalib(side),
      details // array of { localIndex, globalIndex, color }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to test side.', details: err.message });
  }
});

// Utility: random hex color like "#A1B2C3"
function randomHexColor() {
  const n = Math.floor(Math.random() * 0xFFFFFF);
  return '#' + n.toString(16).toUpperCase().padStart(6, '0');
}

/**
 * POST /api/test/scan-u
 * Sequentially blinks U from 42 down to 1 (default), each U blinks 3 times in a random color.
 * Body (all optional):
 *  {
 *    "from": 42,                // starting U (default 42)
 *    "to": 1,                   // ending U (default 1)
 *    "times": 3,                // blinks per U (default 3)
 *    "interval": 250,           // ms on/off (default 250)
 *    "pauseBetweenUnits": 150   // ms between units (default 150)
 *  }
 */
app.post('/api/test/scan-u', async (req, res) => {
  const {
    from = RACK_UNITS_COUNT,
    to = 1,
    times = 3,
    interval = 250,
    pauseBetweenUnits = 150
  } = req.body || {};

  // Validate bounds
  const startU = parseInt(from, 10);
  const endU   = parseInt(to, 10);
  if (!Number.isInteger(startU) || !Number.isInteger(endU)) {
    return res.status(400).json({ error: '"from" and "to" must be integers.' });
  }
  if (startU < 1 || startU > RACK_UNITS_COUNT || endU < 1 || endU > RACK_UNITS_COUNT) {
    return res.status(400).json({ error: `"from" and "to" must be in 1..${RACK_UNITS_COUNT}.` });
  }
  if (startU < endU) {
    return res.status(400).json({ error: '"from" should be >= "to" for a downward scan.' });
  }

  const sides = ['left', 'right'].filter(s => ledStates[s]);
  if (sides.length === 0) {
    return res.status(400).json({ error: 'No vertical sides (left/right) configured.' });
  }

  // Kick it off (don’t block the request)
  res.json({
    message: `Starting U scan from U${startU} down to U${endU}. Each U blinks ${times}× with interval ${interval}ms.`,
    sides
  });

  (async () => {
    for (let u = startU; u >= endU; u--) {
      const color = randomHexColor();

      // Compute vertical segment for this U
      let v;
      try {
        v = uToVertical(u);
      } catch (e) {
        console.error(`uToVertical failed for U${u}:`, e.message);
        continue;
      }

      // Blink this U 'times' times
      for (let t = 0; t < times; t++) {
        // ON
        let onPairs = [];
        for (const side of sides) {
          onPairs = onPairs.concat(verticalSegmentToLocalPairs(side, v.vStart, v.vLength, color));
        }
        await updateWLEDPatch(buildPatch(onPairs));
        await new Promise(r => setTimeout(r, interval));

        // OFF
        let offPairs = [];
        for (const side of sides) {
          offPairs = offPairs.concat(verticalSegmentToLocalPairs(side, v.vStart, v.vLength, '#000000'));
        }
        await updateWLEDPatch(buildPatch(offPairs));
        await new Promise(r => setTimeout(r, interval));
      }

      // Small pause between units so you can visually track the step
      if (pauseBetweenUnits > 0) {
        await new Promise(r => setTimeout(r, pauseBetweenUnits));
      }
    }
  })().catch(err => console.error('scan-u failed:', err.message));
});

app.listen(port, () => {
  console.log(`LED control server is running on http://localhost:${port}`);
});
console.log(`Server is running on port ${port}`);
