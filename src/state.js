// src/state.js
const { ledConfig } = require('./config');
const { vToLocal } = require('./math');

// in-memory state
const ledStates = {
  left:   Array(ledConfig.left).fill({ color: '#000000' }),
  top:    Array(ledConfig.top).fill({ color: '#000000' }),
  right:  Array(ledConfig.right).fill({ color: '#000000' }),
  bottom: Array(ledConfig.bottom).fill({ color: '#000000' })
};

// fill a local continuous range on a side
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

// expand a vertical segment (vStart..vStart+vLength-1) into local indices
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

module.exports = {
  ledStates,
  rangeToPairs,
  verticalSegmentToLocalPairs
};
