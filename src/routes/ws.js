// src/routes/ws.js
const WebSocket = require('ws');
const url = require('url');

// Configure your WLED endpoint (80 is typical for WLED WS)
const WLED_LAN_IP = process.env.WLED_LAN_IP;
const WLED_WS_PORT = Number(process.env.WLED_WS_PORT || 80);
const WLED_WS_PATH = process.env.WLED_WS_PATH || '/ws';

// Path clients connect to on your server
const PROXY_PATH = '/api/wled-ws';

function setupWledWsProxy(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = url.parse(request.url || '');
    if (!pathname || !pathname.startsWith(PROXY_PATH)) {
      return; // not our WS endpoint
    }

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      // Connect to the real WLED device
      const targetUrl = `ws://${WLED_LAN_IP}:${WLED_WS_PORT}${WLED_WS_PATH}`;
      const wledWs = new WebSocket(targetUrl, {
        // Compression can sometimes cause weird fragmentation with small frames
        perMessageDeflate: false,
        // Be explicit; some firmwares are sensitive to timeouts
        handshakeTimeout: 5000,
        // If needed, you can spoof an Origin:
        // headers: { Origin: `http://$YOUR_HOST` },
      });

      // Heartbeat to keep connections alive (optional but helps)
      let hbTimerClient, hbTimerWled;

      const startHeartbeat = () => {
        // Ping client every 30s (ws auto-pongs)
        hbTimerClient = setInterval(() => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();
        }, 30000);
        // Ping WLED every 30s
        hbTimerWled = setInterval(() => {
          if (wledWs.readyState === WebSocket.OPEN) wledWs.ping();
        }, 30000);
      };

      const stopHeartbeat = () => {
        if (hbTimerClient) clearInterval(hbTimerClient);
        if (hbTimerWled) clearInterval(hbTimerWled);
      };

      // Queue client messages until WLED is OPEN
      const queue = [];
      let wledOpen = false;

      wledWs.on('open', () => {
        wledOpen = true;
        // Flush any queued frames
        for (const { data, isBinary } of queue) {
          if (wledWs.readyState === WebSocket.OPEN) {
            wledWs.send(data, { binary: isBinary });
          }
        }
        queue.length = 0;
        startHeartbeat();
      });

      // Client -> WLED
      clientWs.on('message', (data, isBinary) => {
        if (wledOpen && wledWs.readyState === WebSocket.OPEN) {
          wledWs.send(data, { binary: isBinary });
        } else {
          // Buffer until upstream is ready
          queue.push({ data, isBinary });
        }
      });

      // WLED -> Client
      wledWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      // Mirror close codes/reasons cleanly
      const closeBoth = (code, reason) => {
        try { if (clientWs.readyState !== WebSocket.CLOSED) clientWs.close(code, reason); } catch {}
        try { if (wledWs.readyState !== WebSocket.CLOSED) wledWs.close(code, reason); } catch {}
        stopHeartbeat();
      };

      clientWs.on('close', (code, reason) => closeBoth(code, reason));
      wledWs.on('close', (code, reason) => closeBoth(code, reason));

      // If either side errors, terminate the other
      clientWs.on('error', () => { try { wledWs.terminate(); } catch {} stopHeartbeat(); });
      wledWs.on('error', () => { try { clientWs.terminate(); } catch {} stopHeartbeat(); });

      // Safety: if upstream never opens and client goes away, cleanup
      clientWs.on('close', () => stopHeartbeat());
    });
  });
}

module.exports = { setupWledWsProxy };
