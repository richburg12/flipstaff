// Authoritative game server. One HTTP server carries BOTH the built client
// (client/dist) and the WebSocket upgrade, so in production one URL is all
// anyone needs. Rooms own the game state; a fresh socket belongs to no room
// until its first create/join.

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import * as os from 'node:os';
import { serveStatic } from './static.ts';
import { Room, RoomManager } from './rooms.ts';
import type { ClientMessage } from './protocol.ts';

const PORT = Number(process.env.PORT) || 8080;
const manager = new RoomManager();

const httpServer = createServer(serveStatic);
const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[flickfight] listening on 0.0.0.0:${PORT} (http + ws)`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`[flickfight]   LAN: http://${a.address}:5173/ (dev) — server on :${PORT}`);
    }
  }
});

wss.on('connection', (socket: WebSocket) => {
  let room: Room | null = null;
  let myId = -1;

  const fail = (msg: string) => socket.send(JSON.stringify({ type: 'error', msg }));

  socket.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (!room) {
      if (msg.type === 'create') {
        room = manager.create();
        const id = room.addHuman(socket, msg.name, msg.color, msg.face);
        if (id === null) {
          fail('Room is full.');
          room = null;
          return;
        }
        myId = id;
      } else if (msg.type === 'join') {
        const r = manager.get(msg.code);
        if (!r) {
          fail('No room with that code.');
          return;
        }
        const id = r.addHuman(socket, msg.name, msg.color, msg.face);
        if (id === null) {
          fail('That room is full.');
          return;
        }
        room = r;
        myId = id;
      }
      return;
    }

    if (msg.type === 'leave') {
      room.removeHuman(myId);
      room = null;
      myId = -1;
      return;
    }
    room.handle(myId, msg);
  });

  socket.on('close', () => {
    if (room && myId >= 0) room.removeHuman(myId);
  });
  socket.on('error', () => {
    if (room && myId >= 0) room.removeHuman(myId);
  });
});
