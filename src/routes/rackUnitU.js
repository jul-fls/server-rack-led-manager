// src/routes/rackUnitU.js
const express = require('express');
const router = express.Router();

const { RACK_UNITS_COUNT } = require('../config');
const { verticalSegmentToLocalPairs } = require('../state');
const { buildPatch, toGlobalIndex, uToVertical, vToLocal } = require('../math');
const { updateWLEDPatch } = require('../wled');

// light a U
router.post('/rack-unit-u/:unum', async (req, res) => {
  const unum = parseInt(req.params.unum, 10);
  const { color } = req.body || {};
  if (!color) return res.status(400).json({ error: 'Missing "color".' });

  try {
    const { vStart, vLength } = uToVertical(unum);
    const sidesToFill = ['left', 'right'];

    let pairs = [];
    for (const side of sidesToFill) {
      pairs = pairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, color));
    }
    await updateWLEDPatch(buildPatch(pairs));

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
      vStart,
      vLength,
      details
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// blink a U
router.post('/rack-unit-u/:unum/blink', async (req, res) => {
  const unum = parseInt(req.params.unum, 10);
  const { color = '#FF0000', times = 3, interval = 500 } = req.body || {};

  try {
    const { vStart, vLength } = uToVertical(unum);
    const sidesToBlink = ['left', 'right'];

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

// Set color for a range of U units
router.post('/rack-unit-u/range/:range', async (req, res) => {
  const rangeMatch = String(req.params.range).match(/^(\d+)-(\d+)$/);
  const { color } = req.body || {};
  if (!rangeMatch) return res.status(400).json({ error: 'Invalid range format. Use start-end.' });
  if (!color) return res.status(400).json({ error: 'Missing "color".' });
  let start = parseInt(rangeMatch[1], 10);
  let end = parseInt(rangeMatch[2], 10);
  if (start > end) [start, end] = [end, start];
  const details = [];
  try {
    const sidesToFill = ['left', 'right'];
    let pairs = [];
    for (let unum = start; unum <= end; unum++) {
      const { vStart, vLength } = uToVertical(unum);
      for (const side of sidesToFill) {
        pairs = pairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, color));
        for (let dv = 0; dv < vLength; dv++) {
          const v = vStart + dv;
          const localIndex = vToLocal(side, v);
          const globalIndex = toGlobalIndex(side, localIndex);
          details.push({ unum, side, v, localIndex, globalIndex, color });
        }
      }
    }
    await updateWLEDPatch(buildPatch(pairs));
    res.json({
      message: `Lit U${start}-U${end} on left&right with ${color}`,
      rackUnitsCount: RACK_UNITS_COUNT,
      details
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Blink a range of U units
router.post('/rack-unit-u/range/:range/blink', async (req, res) => {
  const rangeMatch = String(req.params.range).match(/^(\d+)-(\d+)$/);
  const { color = '#FF0000', times = 3, interval = 500 } = req.body || {};
  if (!rangeMatch) return res.status(400).json({ error: 'Invalid range format. Use start-end.' });
  let start = parseInt(rangeMatch[1], 10);
  let end = parseInt(rangeMatch[2], 10);
  if (start > end) [start, end] = [end, start];
  try {
    res.json({
      message: `Blinking U${start}-U${end} on left&right with ${color}, ${times} times, ${interval}ms interval`
    });
    (async () => {
      for (let t = 0; t < times; t++) {
        // ON
        let onPairs = [];
        for (let unum = start; unum <= end; unum++) {
          const { vStart, vLength } = uToVertical(unum);
          const sidesToBlink = ['left', 'right'];
          for (const side of sidesToBlink) {
            onPairs = onPairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, color));
          }
        }
        await updateWLEDPatch(buildPatch(onPairs));
        await new Promise(r => setTimeout(r, interval));
        // OFF
        let offPairs = [];
        for (let unum = start; unum <= end; unum++) {
          const { vStart, vLength } = uToVertical(unum);
          const sidesToBlink = ['left', 'right'];
          for (const side of sidesToBlink) {
            offPairs = offPairs.concat(verticalSegmentToLocalPairs(side, vStart, vLength, '#000000'));
          }
        }
        await updateWLEDPatch(buildPatch(offPairs));
        await new Promise(r => setTimeout(r, interval));
      }
    })().catch(err => console.error('U-blink-range failed:', err.message));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
