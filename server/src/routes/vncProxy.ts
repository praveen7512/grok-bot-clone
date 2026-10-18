import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Logger } from '../lib/logger.js';
import { parseCookies } from '../lib/tokens.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';
import { SESSION_COOKIE, type AuthService } from '../services/authService.js';
import type { BotService } from '../services/botService.js';
import type { ScreenService } from '../services/screenService.js';

/**
 * WebSocket endpoint /vnc/:botId?token=...  -> raw RFB bytes to that bot's x11vnc.
 * Requires BOTH the owner session cookie and a valid short-lived screen token bound to the bot.
 * View tokens are routed to the -viewonly VNC server, so view-only is enforced server-side.
 */
export function attachVncProxy(server: Server, d: { auth: AuthService; screen: ScreenService; bots: BotService; orchestrator: Orchestrator; log: Logger }) {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
    maxPayload: 16 * 1024 * 1024,
  });

  const reject = (socket: Duplex, code: number, msg: string) => {
    socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = url.pathname.match(/^\/vnc\/([0-9a-f-]{36})$/i);
    if (!m) return reject(socket, 404, 'Not Found');
    const botId = m[1]!;
    if (!d.auth.verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE])) return reject(socket, 401, 'Unauthorized');
    const grant = d.screen.verify(url.searchParams.get('token'), botId);
    if (!grant) return reject(socket, 403, 'Forbidden');

    let bot;
    try {
      bot = d.bots.get(botId);
    } catch {
      return reject(socket, 404, 'Not Found');
    }

    d.orchestrator
      .openVnc(botId, bot.sandboxKind, grant.mode)
      .then((tunnel) => {
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          d.log.info({ botId, mode: grant.mode }, 'screen session opened');
          const expiry = setTimeout(() => ws.close(4001, 'token expired'), Math.max(0, grant.exp * 1000 - Date.now()));
          ws.on('message', (data: Buffer) => tunnel.write(data));
          tunnel.on('data', (chunk: Buffer) => ws.readyState === ws.OPEN && ws.send(chunk, { binary: true }));
          const cleanup = () => {
            clearTimeout(expiry);
            tunnel.destroy();
            if (ws.readyState === ws.OPEN) ws.close();
            d.log.info({ botId }, 'screen session closed');
          };
          ws.on('close', cleanup);
          ws.on('error', cleanup);
          tunnel.on('end', cleanup);
          tunnel.on('error', cleanup);
        });
      })
      .catch((err) => {
        d.log.warn({ err, botId }, 'could not open VNC tunnel');
        reject(socket, 502, 'Bad Gateway');
      });
  });
  return wss;
}
