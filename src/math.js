// src/math.js
const { config, ledConfig, sideOffsets, getSideOffsetCalib, CANONICAL_H, RACK_UNIT_SIZE, RACK_UNITS_COUNT } = require('./config');

// local->global with reverse & absolute start (or fallback offset)
function toGlobalIndex(side, localIndex) {
  const { reverse, start } = config.common[side];
  const base = (typeof start === 'number') ? start : sideOffsets[side];
  const effectiveLocal = reverse ? (ledConfig[side] - 1 - localIndex) : localIndex;
  return base + effectiveLocal;
}

// build WLED patch from { side, index, color } pairs
function buildPatch(pairs) {
  const arr = [];
  for (const { side, index, color } of pairs) {
    const globalIndex = toGlobalIndex(side, index);
    arr.push(globalIndex, color.replace(/^#/, ''));
  }
  return { seg: { i: arr } };
}

// v (0..CANONICAL_H-1) -> local float (0..len-1)
function vToLocalLinear(side, v) {
  const len = ledConfig[side];
  if (len <= 0) throw new Error(`Side "${side}" has no LEDs.`);
  if (!Number.isInteger(v) || v < 0 || v >= CANONICAL_H) {
    throw new Error(`Vertical index ${v} out of range 0..${CANONICAL_H-1}`);
  }
  return (v / (CANONICAL_H - 1)) * (len - 1);
}

// final v->local (int) with side integer offset + clamp
function vToLocal(side, v) {
  const base = vToLocalLinear(side, v);
  const local = Math.round(base) + getSideOffsetCalib(side);
  return Math.max(0, Math.min(ledConfig[side] - 1, local));
}

// exact 1U => RACK_UNIT_SIZE rows
function uToVertical(unum) {
  if (!Number.isInteger(unum) || unum < 1 || unum > RACK_UNITS_COUNT) {
    throw new Error(`U number ${unum} out of range 1..${RACK_UNITS_COUNT}`);
  }
  const vStart = (unum - 1) * RACK_UNIT_SIZE;
  const vEnd = vStart + RACK_UNIT_SIZE - 1;
  const cStart = Math.max(0, Math.min(CANONICAL_H - 1, vStart));
  const cEnd   = Math.max(0, Math.min(CANONICAL_H - 1, vEnd));
  return { vStart: cStart, vLength: cEnd - cStart + 1 };
}

module.exports = {
  toGlobalIndex,
  buildPatch,
  vToLocal,
  uToVertical
};
