// src/wled.js
const axios = require('axios');

async function updateWLEDPatch(payload) {
  if (!process.env.WLED_API_URL) {
    throw new Error('WLED_API_URL is not set in environment.');
  }
  await axios.post(process.env.WLED_API_URL, payload);
}

module.exports = { updateWLEDPatch };
