// src/config.js
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.LED_CONFIG_PATH || path.resolve('./led_strip_config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const SIDES = ['left', 'top', 'right', 'bottom'];

// minimal validation + defaults
SIDES.forEach(side => {
  if (!config.common?.[side]?.length) {
    throw new Error(`Missing common.${side}.length in ${CONFIG_PATH}`);
  }
  if (config.common[side].start === undefined) config.common[side].start = 0;
  if (config.common[side].reverse === undefined) config.common[side].reverse = false;
  if (!config.common[side].calibration) config.common[side].calibration = { offset: 0 };
  if (typeof config.common[side].calibration.offset !== 'number') {
    config.common[side].calibration.offset = 0;
  }
});

const ledConfig = {
  left:   config.common.left.length,
  top:    config.common.top.length,
  right:  config.common.right.length,
  bottom: config.common.bottom.length
};

// rack settings
const RACK_UNIT_SIZE =
  Number.isInteger(config.common?.rack_unit_size) && config.common.rack_unit_size > 0
    ? config.common.rack_unit_size
    : 3;

const RACK_UNITS_COUNT =
  Number.isInteger(config.common?.rack_units_count) && config.common.rack_units_count > 0
    ? config.common.rack_units_count
    : 42;

// canonical vertical ruler (e.g., 42 * 3 = 126)
const CANONICAL_H = RACK_UNITS_COUNT * RACK_UNIT_SIZE;

// fallback side offsets (used if a side doesn't have absolute start)
const sideOffsets = {
  left:   0,
  top:    ledConfig.left,
  right:  ledConfig.left + ledConfig.top,
  bottom: ledConfig.left + ledConfig.top + ledConfig.right
};

function getSideOffsetCalib(side) {
  const c = config.common[side]?.calibration;
  return (c && Number.isInteger(c.offset)) ? c.offset : 0;
}

module.exports = {
  CONFIG_PATH,
  config,
  SIDES,
  ledConfig,
  RACK_UNIT_SIZE,
  RACK_UNITS_COUNT,
  CANONICAL_H,
  sideOffsets,
  getSideOffsetCalib
};
