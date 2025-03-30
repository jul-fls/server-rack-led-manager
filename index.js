// server.js
require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // For HTTP requests to the WLED instance

const app = express();
const port = process.env.PORT || 3000;

// LED configuration: number of LEDs per side loaded from env vars.
let ledConfig = {
  left: parseInt(process.env.LED_LEFT, 10) || 30,
  top: parseInt(process.env.LED_TOP, 10) || 30,
  right: parseInt(process.env.LED_RIGHT, 10) || 30,
  bottom: parseInt(process.env.LED_BOTTOM, 10) || 30
};

// In-memory state for each LED of each side (0-indexed arrays with default color "#000000").
let ledStates = {
  left: Array(ledConfig.left).fill({ color: '#000000' }),
  top: Array(ledConfig.top).fill({ color: '#000000' }),
  right: Array(ledConfig.right).fill({ color: '#000000' }),
  bottom: Array(ledConfig.bottom).fill({ color: '#000000' })
};

app.use(bodyParser.json());

/**
 * Get the global starting index for a given side.
 * The ordering is: left, top, right, bottom.
 * For patch requests, global indices are 0-indexed.
 */
function getSideOffset(side) {
  switch (side) {
    case 'left':
      return 0;
    case 'top':
      return ledConfig.left;
    case 'right':
      return ledConfig.left + ledConfig.top;
    case 'bottom':
      return ledConfig.left + ledConfig.top + ledConfig.right;
    default:
      return 0;
  }
}

/**
 * Build a patch payload for a given side based on individual commands.
 * Each command should have:
 *    - index: LED index (0-based within that side)
 *    - color: a hex color string (e.g., "#FF0000" or "FF0000")
 *
 * Returns an object like:
 *    {"seg":{"i":[globalIndex1,"FF0000", globalIndex2,"00FF00", ...]}}
 */
function buildPatchPayload(side, commands) {
  const offset = getSideOffset(side);
  const patchArray = [];

  commands.forEach(command => {
    const { index, color } = command;
    const globalIndex = offset + index; // 0-indexed global
    const hexColor = color.replace(/^#/, '');
    patchArray.push(globalIndex, hexColor);
  });
  return { seg: { i: patchArray } };
}

/**
 * Send a patch update to the WLED instance.
 * Payload format: {"seg":{"i":[globalIndex, "HEX", ...]}}
 */
async function updateWLEDPatch(payload) {
  console.log("Sending patch payload:", payload);
  try {
    await axios.post(process.env.WLED_API_URL, payload);
  } catch (error) {
    console.error("Error updating WLED:", error.message);
    throw error;
  }
}

/**
 * GET /api/status
 * Returns the current LED configuration and in-memory state.
 */
app.get('/api/status', (req, res) => {
  res.json({ config: ledConfig, states: ledStates });
});

/**
 * POST /api/config
 * Update LED configuration (number of LEDs per side).
 * Resets the corresponding LED state.
 */
app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  ['left', 'top', 'right', 'bottom'].forEach(side => {
    if (newConfig[side] !== undefined) {
      ledConfig[side] = newConfig[side];
      const newArray = Array(newConfig[side]).fill({ color: '#000000' });
      if (ledStates[side]) {
        for (let i = 0; i < Math.min(newArray.length, ledStates[side].length); i++) {
          newArray[i] = ledStates[side][i];
        }
      }
      ledStates[side] = newArray;
    }
  });
  res.json({ config: ledConfig, states: ledStates });
});

/**
 * POST /api/led/:side
 * Update a given side with an array of LED commands.
 * Validates that each LED index is within range.
 */
app.post('/api/led/:side', async (req, res) => {
  const side = req.params.side;
  const commands = req.body.leds;

  if (!ledStates.hasOwnProperty(side)) {
    return res.status(400).json({ error: 'Invalid side specified.' });
  }
  if (!Array.isArray(commands)) {
    return res.status(400).json({ error: 'LED commands should be an array.' });
  }

  // Validate each command's index.
  for (const command of commands) {
    const { index } = command;
    if (typeof index !== 'number' || index < 0 || index >= ledStates[side].length) {
      return res.status(400).json({ error: `Invalid LED index ${index} for side "${side}".` });
    }
  }

  // Update in-memory state.
  commands.forEach(command => {
    const { index, color } = command;
    ledStates[side][index] = { color };
  });

  const patchPayload = buildPatchPayload(side, commands);
  try {
    await updateWLEDPatch(patchPayload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update WLED instance.' });
  }

  res.json({ message: `Updated ${side} side`, states: ledStates[side] });
});

// --- New U Route for Left and Right Only --- //

/**
 * We'll define a constant offset for the U mapping.
 * Adjust U_OFFSET until the physical mapping is correct.
 */
const U_OFFSET = 6;

/**
 * Compute the local LED block (array of 3 indices) for a given U number on the left side.
 * The first U (U=1) should start at local LED index 1, then subtract U_OFFSET.
 * So: left block = [1 + (unum - 1)*3 - U_OFFSET, ...]
 */
function getUBlockLeft(unum) {
  const start = 1 + (unum - 1) * 3 - U_OFFSET;
  return [start, start + 1, start + 2];
}

/**
 * Compute the local LED block for a given U number on the right side.
 * The right side is inverted compared to the left.
 * We first compute the corresponding left side block and then map each left index L to:
 *   right_local = (LED_RIGHT - 1) - L - 3
 * (The subtraction of 3 comes from the empirical mapping: left index 50 corresponds to right index 63.)
 */
function getUBlockRight(unum) {
  const leftBlock = getUBlockLeft(unum);
  return leftBlock.map(L => (ledConfig.right - 1) - L - 3);
}

/**
 * POST /api/u/:unum
 * Lights up a specific U (rack unit) across only the left and right sides with a given color.
 * Expects JSON body with a "color" property (e.g., "#0000FF").
 *
 * For each of the left and right sides, calculates the corresponding block of 3 LEDs,
 * validates indices, updates in-memory state, and sends a combined patch update.
 */
app.post('/api/u/:unum', async (req, res) => {
  const unum = parseInt(req.params.unum, 10);
  const { color } = req.body;
  if (!color) {
    return res.status(400).json({ error: 'Missing "color" in request body.' });
  }
  let combinedPatch = [];

  // Process only left and right sides.
  const sides = ['left', 'right'];
  for (const side of sides) {
    let block;
    if (side === 'left') {
      block = getUBlockLeft(unum);
    } else if (side === 'right') {
      block = getUBlockRight(unum);
    }
    // Validate that all block indices are within range.
    for (const idx of block) {
      if (idx < 0 || idx >= ledConfig[side]) {
        return res.status(400).json({ error: `U number ${unum} is out-of-range for side "${side}".` });
      }
    }
    // Update in-memory state.
    block.forEach(idx => {
      ledStates[side][idx] = { color };
    });
    // Compute global indices.
    const offset = getSideOffset(side);
    block.forEach(localIdx => {
      combinedPatch.push(offset + localIdx, color.replace(/^#/, ''));
    });
  }

  const patchPayload = { seg: { i: combinedPatch } };

  try {
    await updateWLEDPatch(patchPayload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update WLED instance.' });
  }

  res.json({
    message: `Updated U number ${unum} with color ${color} on left and right sides.`,
    states: { left: ledStates.left, right: ledStates.right }
  });
});

app.listen(port, () => {
  console.log(`LED control server is running on http://localhost:${port}`);
});

console.log(`Server is running on port ${port}`);
