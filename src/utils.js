// src/utils.js
function randomHexColor() {
  const n = Math.floor(Math.random() * 0xFFFFFF);
  return '#' + n.toString(16).toUpperCase().padStart(6, '0');
}

// Normalize an equipment "side" prop into a concrete sides array.
// Accepts: "left" | "right" | "both" | ["left"] | ["right"] | ["left","right"] | undefined
function normalizeSides(sideProp) {
  if (Array.isArray(sideProp)) {
    const set = new Set(sideProp.map(s => String(s).toLowerCase()));
    const out = [];
    if (set.has('left')) out.push('left');
    if (set.has('right')) out.push('right');
    if (out.length) return out;
  } else if (typeof sideProp === 'string') {
    const s = sideProp.toLowerCase();
    if (s === 'left')  return ['left'];
    if (s === 'right') return ['right'];
    if (s === 'both')  return ['left', 'right'];
  }
  // default: both sides
  return ['left', 'right'];
}

module.exports = { randomHexColor, normalizeSides };