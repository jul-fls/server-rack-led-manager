// src/routes/test.js
const express = require('express');
const router = express.Router();

const { SIDES, ledConfig, getSideOffsetCalib, RACK_UNITS_COUNT } = require('../config');
const { ledStates, verticalSegmentToLocalPairs } = require('../state');
const { buildPatch, toGlobalIndex, vToLocal, uToVertical } = require('../math');
const { updateWLEDPatch } = require('../wled');
const { randomHexColor } = require('../utils');

// test side: blue at 0, red at end, green in between
router.post('/test/side/:side', async (req, res) => {
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
      const color = i === 0 ? '#0000FF' : (i === length - 1 ? '#FF0000' : '#00FF00');
      ledStates[side][i] = { color };
      const globalIndex = toGlobalIndex(side, i);
      details.push({ localIndex: i, globalIndex, color });
      pairs.push({ side, index: i, color });
    }

    await updateWLEDPatch(buildPatch(pairs));

    res.json({
      message: `Tested side "${side}" (${length} LEDs). Start=Blue, End=Red, Middle=Green.`,
      leds: length,
      offset: getSideOffsetCalib(side),
      details
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to test side.', details: err.message });
  }
});

// scan U: e.g., 42 -> 1, each U blinks 3× random color
router.post('/test/scan-u', async (req, res) => {
  const {
    from = RACK_UNITS_COUNT,
    to = 1,
    times = 3,
    interval = 250,
    pauseBetweenUnits = 150
  } = req.body || {};

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

  const sides = ['left', 'right'];

  res.json({
    message: `Starting U scan from U${startU} down to U${endU}. Each U blinks ${times}× with interval ${interval}ms.`,
    sides
  });

  (async () => {
    for (let u = startU; u >= endU; u--) {
      const color = randomHexColor();

      let v;
      try {
        v = uToVertical(u);
      } catch (e) {
        console.error(`uToVertical failed for U${u}:`, e.message);
        continue;
      }

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

      if (pauseBetweenUnits > 0) {
        await new Promise(r => setTimeout(r, pauseBetweenUnits));
      }
    }
  })().catch(err => console.error('scan-u failed:', err.message));
});

module.exports = router;
