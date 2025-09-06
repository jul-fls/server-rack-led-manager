// src/maps.js
const { ledStates } = require('./state');
const { RACK_UNIT_SIZE } = require('./config');

// normalize vertical spec (U -> LEDs) unless unit: "leds"
function normalizeVerticalSpec(vSpec) {
  if (!vSpec || !Number.isInteger(vSpec.start) || !Number.isInteger(vSpec.length)) {
    throw new Error(`Invalid vertical spec: ${JSON.stringify(vSpec)}`);
  }
  if (vSpec.unit && vSpec.unit.toLowerCase() === 'leds') {
    return { vStart: vSpec.start, vLength: vSpec.length };
  }
  return {
    vStart: vSpec.start * RACK_UNIT_SIZE,
    vLength: vSpec.length * RACK_UNIT_SIZE
  };
}

// Build legacy maps from config (optional)
function buildLegacyMaps(config) {
  const rackUnitMap = new Map();
  (config.rack_units || []).forEach(u => {
    const segments = [];

    // per-side local
    ['left', 'top', 'right', 'bottom'].forEach(side => {
      if (u[side] && typeof u[side].start === 'number' && typeof u[side].length === 'number') {
        segments.push({ kind: 'local', side, start: u[side].start, length: u[side].length });
      }
    });

    // shared vertical -> left/right
    if (u.vertical && Number.isInteger(u.vertical.start) && Number.isInteger(u.vertical.length)) {
      const { vStart, vLength } = normalizeVerticalSpec(u.vertical);
      ['left', 'right'].forEach(side => {
        if (ledStates[side]) segments.push({ kind: 'vertical', side, vStart, vLength });
      });
    }

    rackUnitMap.set(u.id, segments);
  });

  const equipmentMap = new Map();
  (config.equipments || []).forEach(eq => {
    const segs = [];
    (eq.rack_units || []).forEach(uid => {
      const uSegs = rackUnitMap.get(uid);
      if (uSegs && uSegs.length) segs.push(...uSegs);
    });
    equipmentMap.set(eq.id, { meta: eq, segments: segs });
  });

  return { rackUnitMap, equipmentMap };
}

module.exports = {
  normalizeVerticalSpec,
  buildLegacyMaps
};
