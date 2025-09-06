// src/routes/led.js
const express = require('express');
const router = express.Router();

const { ledConfig } = require('../config');
const { rangeToPairs, ledStates } = require('../state');
const { buildPatch } = require('../math');
const { updateWLEDPatch } = require('../wled');

router.post('/led/:side', async (req, res) => {
  const side = req.params.side;
  const commands = req.body.leds;

  if (!ledStates.hasOwnProperty(side)) {
    return res.status(400).json({ error: 'Invalid side specified.' });
  }
  if (!Array.isArray(commands)) {
    return res.status(400).json({ error: 'LED commands should be an array.' });
  }

  try {
    const pairs = [];
    for (const { index, color } of commands) {
      if (typeof index !== 'number' || index < 0 || index >= ledConfig[side]) {
        return res.status(400).json({ error: `Invalid LED index ${index} for side "${side}".` });
      }
      if (!color) return res.status(400).json({ error: 'Missing color.' });
      pairs.push(...rangeToPairs(side, index, 1, color));
    }

    await updateWLEDPatch(buildPatch(pairs));
    res.json({ message: `Updated ${side}`, count: pairs.length });
  } catch {
    res.status(500).json({ error: 'Failed to update WLED instance.' });
  }
});

module.exports = router;
