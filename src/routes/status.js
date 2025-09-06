// src/routes/status.js
const express = require('express');
const router = express.Router();

const { config, ledConfig, getSideOffsetCalib, RACK_UNIT_SIZE, RACK_UNITS_COUNT, CANONICAL_H } = require('../config');
const { ledStates } = require('../state');
const { normalizeSides } = require('../utils');

router.get('/status', (req, res) => {
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
    verticalHeight: CANONICAL_H,
    rackUnitSize: RACK_UNIT_SIZE,
    rackUnitsCount: RACK_UNITS_COUNT,
    equipments: (config.equipments || []).map(e => ({
      id: e.id,
      name: e.name,
      rack_units: e.rack_units,
      sides: normalizeSides(e.side)
    })),
    states: ledStates
  });
});

module.exports = router;
