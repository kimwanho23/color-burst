import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { ClientToServer, ColorIndex, ServerToClient } from '@color-burst/shared';
import { Room } from './room.ts';

const PORT = Number(process.env.PORT ?? 3001);
const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version;
const DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json',
};

// 배포 시: client를 빌드하면(client/dist) 이 서버가 화면까지 같이 제공한다.
const http = createServer(async (req, res) => {
  // 배포 서비스가 서버 상태를 확인하는 주소
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: VERSION, rooms: rooms.size }));
    return;
  }
  if (!existsSync(DIST)) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Color Burst 서버 실행 중. 개발 중에는 http://localhost:5173 으로 접속하세요.'); return; }
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(DIST, url === '/' ? 'index.html' : url));
  if (!file.startsWith(DIST) || !existsSync(file)) file = join(DIST, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});

// 재접속은 클라이언트가 다시 연결될 때마다 같은 키로 room:join을 보내는 방식으로 처리한다.
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: true } });
const rooms = new Map<string, Room>();
/** 소켓 id → 들어가 있는 방과 내 플레이어 id */
const seat = new Map<string, { room: Room; id: string }>();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(code));
  return code;
}

const validKey = (k: unknown): k is string => typeof k === 'string' && k.length >= 8 && k.length <= 64;

io.on('connection', (socket) => {
  const here = () => seat.get(socket.id);

  const leaveCurrent = () => {
    const s = here();
    if (!s) return;
    seat.delete(socket.id);
    socket.leave(s.room.code);
    s.room.leave(s.id, socket.id);
  };

  const enter = (room: Room, key: string, name: string) => {
    const cur = here();
    if (cur && cur.room !== room) leaveCurrent();
    const r = room.join(socket.id, key, name);
    if ('error' in r) return r;
    seat.set(socket.id, { room, id: r.id });
    socket.emit('room:state', room.snapshot());
    return r;
  };

  socket.on('time:ping', (ack) => typeof ack === 'function' && ack(Date.now()));

  socket.on('room:create', ({ name, key }, ack) => {
    if (!validKey(key)) return ack({ ok: false, error: '접속 정보가 올바르지 않아요. 새로고침해 주세요.' });
    leaveCurrent();
    const code = makeCode();
    const room = new Room(io, code, () => rooms.delete(code));
    rooms.set(code, room);
    const r = enter(room, key, String(name ?? ''));
    ack('error' in r ? { ok: false, error: r.error } : { ok: true, code, you: r.id });
  });

  socket.on('room:solo', ({ name, key }, ack) => {
    if (!validKey(key)) return ack({ ok: false, error: '접속 정보가 올바르지 않아요. 새로고침해 주세요.' });
    leaveCurrent();
    const code = makeCode();
    const room = new Room(io, code, () => rooms.delete(code), true);
    rooms.set(code, room);
    const r = enter(room, key, String(name ?? ''));
    ack('error' in r ? { ok: false, error: r.error } : { ok: true, code, you: r.id });
  });

  socket.on('room:join', ({ code, name, key }, ack) => {
    if (!validKey(key)) return ack({ ok: false, error: '접속 정보가 올바르지 않아요. 새로고침해 주세요.' });
    const room = rooms.get(String(code ?? '').toUpperCase().trim());
    if (!room) return ack({ ok: false, error: '방 코드를 찾을 수 없어요.' });
    const r = enter(room, key, String(name ?? ''));
    ack('error' in r ? { ok: false, error: r.error } : { ok: true, code: room.code, you: r.id });
  });

  socket.on('room:leave', leaveCurrent);
  socket.on('lobby:color', (c) => { const s = here(); if (s && [0, 1, 2, 3].includes(c)) s.room.setColor(s.id, c as ColorIndex); });
  socket.on('lobby:options', (o) => { const s = here(); if (s) s.room.setOptions(s.id, o ?? {}); });
  socket.on('lobby:rules', (d) => { const s = here(); if (s && d && typeof d === 'object') s.room.setRules(s.id, d); });
  socket.on('game:start', (ack) => {
    const s = here();
    const err = s ? s.room.start(s.id) : '방에 들어가 있지 않아요.';
    if (typeof ack === 'function') ack(err ? { ok: false, error: err } : { ok: true });
  });
  socket.on('game:pause', () => { const s = here(); if (s) s.room.pause(s.id); });
  socket.on('game:resume', () => { const s = here(); if (s) s.room.resume(s.id); });
  socket.on('arcade:choose', (i) => { const s = here(); if (s && Number.isInteger(i)) s.room.choose(s.id, i); });
  socket.on('arcade:reroll', () => { const s = here(); if (s) s.room.reroll(s.id); });
  socket.on('cursor:move', (d) => {
    const s = here();
    if (s && d && Number.isFinite(d.x) && Number.isFinite(d.y)) s.room.cursor(s.id, { x: d.x, y: d.y });
  });
  socket.on('game:click', (d) => {
    const s = here();
    if (!s || !d || typeof d.x !== 'number' || typeof d.y !== 'number') return;
    s.room.click(s.id, { circleId: typeof d.circleId === 'number' ? d.circleId : null, x: d.x, y: d.y });
  });
  socket.on('disconnect', () => {
    const s = here();
    if (!s) return;
    seat.delete(socket.id);
    s.room.disconnect(s.id, socket.id);
  });
});

http.listen(PORT, () => console.log(`[color-burst] v${VERSION} server on http://localhost:${PORT}`));
