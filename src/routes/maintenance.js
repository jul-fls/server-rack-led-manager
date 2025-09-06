// src/routes/maintenance.js
const express = require('express');
const router = express.Router();

const { SIDES, ledConfig } = require('../config');
const { ledStates } = require('../state');
const { buildPatch } = require('../math');
const { updateWLEDPatch } = require('../wled');

// clear all (black)
router.post('/clear', async (req, res) => {
  try {
    let pairs = [];
    SIDES.forEach(side => {
      for (let i = 0; i < ledConfig[side]; i++) {
        ledStates[side][i] = { color: '#000000' };
        pairs.push({ side, index: i, color: '#000000' });
      }
    });
    await updateWLEDPatch(buildPatch(pairs));
    res.json({ message: 'All LEDs cleared (black #000000)' });
  } catch {
    res.status(500).json({ error: 'Failed to update WLED instance.' });
  }
});

// reset all (white)
router.post('/reset', async (req, res) => {
  try {
    let pairs = [];
    SIDES.forEach(side => {
      for (let i = 0; i < ledConfig[side]; i++) {
        ledStates[side][i] = { color: '#FFFFFF' };
        pairs.push({ side, index: i, color: '#FFFFFF' });
      }
    });
    await updateWLEDPatch(buildPatch(pairs));
    res.json({ message: 'All LEDs reset to white (#FFFFFF)' });
  } catch {
    res.status(500).json({ error: 'Failed to reset LEDs on WLED instance.' });
  }
});

module.exports = router;
