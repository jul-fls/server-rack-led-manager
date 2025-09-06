// src/routes/equipment.js
const express = require('express');
const router = express.Router();

const { config, RACK_UNITS_COUNT } = require('../config');
const { verticalSegmentToLocalPairs } = require('../state');
const { buildPatch, toGlobalIndex, uToVertical, vToLocal } = require('../math');
const { updateWLEDPatch } = require('../wled');
const { normalizeSides } = require('../utils');

// Normalize rack_units array: support 0-based or 1-based seamlessly.
function normalizeUArray(arr) {
  if (!Array.isArray(arr)) return [];
  const zeroBased = arr.includes(0);
  return arr
    .map(n => parseInt(n, 10))
    .filter(n => Number.isInteger(n))
    .map(n => (zeroBased ? n + 1 : n))
    .filter(u => u >= 1 && u <= RACK_UNITS_COUNT);
}

// Build equipment map at startup (units + side preference)
const equipmentMap = new Map();
(config.equipments || []).forEach(eq => {
  const units = normalizeUArray(eq.rack_units);
  const sides = normalizeSides(eq.side); // <- left/right/both resolution
  equipmentMap.set(eq.id, { meta: eq, units, sides });
});

// Color an equipment by ID (lights all its U slices on selected sides)
router.post('/equipment/:id', async (req, res) => {
  const id = req.params.id;
  const { color } = req.body || {};
  if (!color) return res.status(400).json({ error: 'Missing "color".' });

  const eq = equipmentMap.get(id);
  if (!eq || eq.units.length === 0) {
    return res.status(404).json({ error: `Unknown or empty equipment "${id}".` });
  }

  try {
    const sides = eq.sides; // already normalized
    let pairs = [];
    const details = [];

    for (const u of eq.units) {
      const { vStart, vLength } = uToVertical(u);
      for (const side of sides) {
        const segPairs = verticalSegmentToLocalPairs(side, vStart, vLength, color);
        pairs = pairs.concat(segPairs);

        for (let dv = 0; dv < vLength; dv++) {
          const v = vStart + dv;
          const localIndex = vToLocal(side, v);
          const globalIndex = toGlobalIndex(side, localIndex);
          details.push({ side, u, v, localIndex, globalIndex, color });
        }
      }
    }

    await updateWLEDPatch(buildPatch(pairs));
    res.json({
      message: `Equipment ${id} (${eq.meta.name}) updated`,
      units: eq.units,
      sides,
      leds: pairs.length,
      details
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Blink an equipment by ID (selected sides only)
router.post('/equipment/:id/blink', async (req, res) => {
  const id = req.params.id;
  const { color = '#FF0000', times = 3, interval = 500 } = req.body || {};

  const eq = equipmentMap.get(id);
  if (!eq || eq.units.length === 0) {
    return res.status(404).json({ error: `Unknown or empty equipment "${id}".` });
  }

  const sides = eq.sides;

  res.json({
    message: `Blinking equipment ${id} (${eq.meta.name}) on ${sides.join('&')} with ${color}, ${times} times, ${interval}ms interval`,
    units: eq.units,
    sides
  });

  (async () => {
    for (let t = 0; t < times; t++) {
      // ON
      let onPairs = [];
      for (const u of eq.units) {
        const { vStart, vLength } = uToVertical(u);
        for (const side of sides) {
          onPairs = onPairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, color));
        }
      }
      await updateWLEDPatch(buildPatch(onPairs));
      await new Promise(r => setTimeout(r, interval));

      // OFF
      let offPairs = [];
      for (const u of eq.units) {
        const { vStart, vLength } = uToVertical(u);
        for (const side of sides) {
          offPairs = offPairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, '#000000'));
        }
      }
      await updateWLEDPatch(buildPatch(offPairs));
      await new Promise(r => setTimeout(r, interval));
    }
  })().catch(err => console.error('equipment-blink failed:', err.message));
});

module.exports = router;
