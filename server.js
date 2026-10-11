// ヤニブ オンライン版サーバー（依存パッケージなし）
// 起動: node server.js  → http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');
const rooms = new Map(); // code -> {game, tokens: Map<token, seat>, clients: Set<{res, seat}>, touched}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join(''); } while (rooms.has(c));
  return c;
}
function cleanName(n) {
  return String(n || '').trim().slice(0, 12);
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((ok, ng) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch (e) { ng(e); } });
    req.on('error', ng);
  });
}
function onlineSeats(room) {
  return [...room.clients].map(c => c.seat);
}
function broadcast(room) {
  room.touched = Date.now();
  const online = onlineSeats(room);
  for (const c of room.clients) c.res.write(`data: ${JSON.stringify(room.game.view(c.seat, online))}\n\n`);
}
function addPlayer(room, name) {
  const seat = room.game.addPlayer(name);
  const token = crypto.randomBytes(16).toString('hex');
  room.tokens.set(token, seat);
  return token;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const room = rooms.get(url.searchParams.get('room'));
    const seat = room && room.tokens.get(url.searchParams.get('token'));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (seat === undefined) { res.end('event: gone\ndata: {}\n\n'); return; }
    const client = { res, seat };
    room.clients.add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); room.clients.delete(client); broadcast(room); });
    broadcast(room);
    return;
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: '不正なリクエストです' }); }

  if (url.pathname === '/api/create') {
    const name = cleanName(body.name);
    if (!name) return json(res, 400, { error: '名前を入れてください' });
    const code = newCode();
    const room = { game: new Game(), tokens: new Map(), clients: new Set(), touched: Date.now() };
    rooms.set(code, room);
    return json(res, 200, { room: code, token: addPlayer(room, name) });
  }

  const code = String(body.room || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return json(res, 404, { error: '部屋が見つかりません' });

  try {
    if (url.pathname === '/api/join') {
      const name = cleanName(body.name);
      if (!name) return json(res, 400, { error: '名前を入れてください' });
      const token = addPlayer(room, name);
      broadcast(room);
      return json(res, 200, { room: code, token });
    }
    if (url.pathname === '/api/action') {
      const seat = room.tokens.get(body.token);
      if (seat === undefined) return json(res, 403, { error: 'この部屋の参加者ではありません' });
      const g = room.game;
      switch (body.type) {
        case 'start': g.start(seat); break;
        case 'play': g.play(seat, body.ids); break;
        case 'undo': g.undo(seat); break;
        case 'draw': g.draw(seat, body.from, body.idx); break;
        case 'yaniv': g.yaniv(seat); break;
        case 'next': g.next(); break;
        default: return json(res, 400, { error: '不明な操作です' });
      }
      broadcast(room);
      return json(res, 200, { ok: true });
    }
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(e => { console.error(e); json(res, 500, { error: 'サーバーエラー' }); });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html が読めません'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

// 誰もいない状態で6時間たった部屋を片付ける
setInterval(() => {
  const limit = Date.now() - 6 * 3600 * 1000;
  for (const [code, room] of rooms) if (!room.clients.size && room.touched < limit) rooms.delete(code);
}, 3600 * 1000);

server.listen(PORT, () => console.log(`ヤニブ サーバー起動: http://localhost:${PORT}`));
