import { io, type Socket } from 'socket.io-client';
import {
  COLORS, RULES, isFever, isHit, isMarked, isOut,
  type BotLevel, type Circle, type ClientToServer, type ColorIndex, type PlayerState, type RoomSnapshot, type ServerToClient,
} from '@color-burst/shared';
import { Renderer, shapeSVG } from './render.ts';
import { ensureMusic, initAudio, sfx, startMusic, stopMusic, toggleMusic } from './audio.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const socket: Socket<ServerToClient, ClientToServer> = io();

// ---------- 서버 시각 맞추기 ----------
let offset = 0;
const serverNow = () => Date.now() + offset;
async function syncTime() {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const s = await new Promise<number>((res) => socket.emit('time:ping', res));
    const rtt = Date.now() - t0;
    if (rtt < best) { best = rtt; offset = s + rtt / 2 - Date.now(); }
  }
}

// ---------- 내 자리 기억 (새로고침해도 유지, 탭마다 따로) ----------
function store(k: string, v?: string | null) {
  try {
    if (v === undefined) return sessionStorage.getItem(k);
    if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
  } catch {}
  return null;
}
const KEY = store('cb-key') ?? (() => { const k = crypto.randomUUID(); store('cb-key', k); return k; })();
let myPlayerId = '';

socket.on('connect', async () => {
  $('netBanner').hidden = true;
  await syncTime();
  // 방에 있던 중이면 같은 키로 자동 복귀
  const code = store('cb-room');
  if (code) {
    socket.emit('room:join', { code, name: getName(), key: KEY }, (r) => {
      if (r.ok) { myPlayerId = r.you; return; }
      store('cb-room', null);
      resetToHome(r.error);
    });
  }
});
socket.on('disconnect', () => { if (store('cb-room')) $('netBanner').hidden = false; });

// ---------- 상태 ----------
let room: RoomSnapshot | null = null;
let players: PlayerState[] = [];
const circles = new Map<number, Circle>();
const pending = new Set<number>();
let startAt = 0, endAt = 0, playing = false, lastCount = -1;
const myId = () => myPlayerId;
const me = () => players.find((p) => p.id === myId());

const renderer = new Renderer($<HTMLCanvasElement>('cv'), $('stage'));

// ---------- 화면 전환 ----------
function show(id: 'home' | 'lobby' | 'result' | null) {
  for (const s of ['home', 'lobby', 'result']) $(s).hidden = s !== id;
}

// ---------- 처음 화면 ----------
const nameInput = $<HTMLInputElement>('nameInput');
const codeInput = $<HTMLInputElement>('codeInput');
try { nameInput.value = localStorage.getItem('cb-name') ?? ''; } catch {}
const getName = () => {
  const n = nameInput.value.trim() || '플레이어';
  try { localStorage.setItem('cb-name', n); } catch {}
  return n;
};
const entered = (r: { ok: true; code: string; you: string } | { ok: false; error: string }) => {
  $('homeErr').textContent = r.ok ? '' : r.error;
  if (r.ok) { myPlayerId = r.you; store('cb-room', r.code); renderScores(); renderLobby(); }
};
$('createBtn').onclick = () => socket.emit('room:create', { name: getName(), key: KEY }, entered);
const join = () => socket.emit('room:join', { code: codeInput.value, name: getName(), key: KEY }, entered);
$('joinBtn').onclick = join;
codeInput.onkeydown = (e) => { if (e.key === 'Enter') join(); };
// 주소에 #ABCD 처럼 방 코드를 붙여 공유할 수 있게
if (location.hash.length === 5) codeInput.value = location.hash.slice(1).toUpperCase();

// ---------- 대기실 ----------
const LEVELS = ['쉬움', '보통', '어려움'];
socket.on('room:state', (s) => {
  room = s;
  if (!playing) players = s.players;
  $('roomTag').hidden = false;
  $('roomTag').textContent = `방 ${s.code}`;
  history.replaceState(null, '', `#${s.code}`);
  renderScores();
  renderLobby();
  if (s.phase === 'lobby' && !playing && $('result').hidden) show('lobby');
});

function renderLobby() {
  if (!room) return;
  const host = room.hostId === myId();
  $('lobbyCode').textContent = room.code;
  $('picks').innerHTML = COLORS.map((c, i) => {
    const owner = room!.players.find((p) => p.color === i && !p.bot);
    const mine = owner?.id === myId();
    return `<button type="button" class="pick" data-c="${i}" aria-pressed="${mine}" ${owner && !mine ? 'disabled' : ''}>${shapeSVG(i as ColorIndex, 34)}${c.name}<span class="who">${owner ? (mine ? '나' : owner.name) : ''}</span></button>`;
  }).join('');
  $('picks').querySelectorAll<HTMLButtonElement>('.pick').forEach((b) => {
    b.onclick = () => socket.emit('lobby:color', Number(b.dataset.c) as ColorIndex);
  });

  $('hostOpts').hidden = !host;
  $<HTMLInputElement>('fillBots').checked = room.fillBots;
  $('botLevel').innerHTML = LEVELS.map((l, i) => `<button type="button" data-l="${i}" aria-pressed="${room!.botLevel === i}">봇 ${l}</button>`).join('');
  $('botLevel').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => socket.emit('lobby:options', { botLevel: Number(b.dataset.l) as BotLevel });
  });

  const humans = room.players.filter((p) => !p.bot).length;
  $<HTMLButtonElement>('startBtn').hidden = !host;
  $('lobbyHint').textContent = host
    ? `참가자 ${humans}명${room.fillBots ? ` · 빈 자리 ${4 - humans}개는 봇` : ''}`
    : `방장이 시작하기를 기다리는 중 · 참가자 ${humans}명`;
}
$<HTMLInputElement>('fillBots').onchange = (e) => socket.emit('lobby:options', { fillBots: (e.target as HTMLInputElement).checked });
$('startBtn').onclick = () => { initAudio(); socket.emit('game:start', (r) => { $('lobbyErr').textContent = r.ok ? '' : r.error; }); };
function resetToHome(err = '') {
  room = null; players = []; playing = false; circles.clear(); pending.clear();
  stopMusic();
  $('roomTag').hidden = true;
  $('netBanner').hidden = true;
  history.replaceState(null, '', location.pathname);
  $('homeErr').textContent = err;
  renderScores();
  show('home');
}
$('leaveBtn').onclick = () => { socket.emit('room:leave'); store('cb-room', null); resetToHome(); };
$('toLobbyBtn').onclick = () => { show('lobby'); renderLobby(); };

$('ruleTable').innerHTML = `
  <tr><th>대상</th><th>평상시</th><th>피버 중 (×${RULES.feverMult})</th></tr>
  <tr><td>${shapeSVG(0, 16)} 내 색</td><td>+${RULES.points.own}</td><td>+${RULES.points.own * RULES.feverMult}</td></tr>
  <tr><td>${shapeSVG('y', 16)} 노란색</td><td>+${RULES.points.yellow}</td><td>내 색 취급 +${RULES.points.own * RULES.feverMult}</td></tr>
  <tr><td>${shapeSVG('rainbow', 16)} 무지개</td><td>+${RULES.points.rainbow}</td><td>+${RULES.points.rainbow * RULES.feverMult}</td></tr>
  <tr><td>남의 색 (견제)</td><td>+${RULES.points.stealCalm}, 내 콤보 끊김, ${RULES.markMs / 1000}초 표적</td><td>+${RULES.points.stealCalm * RULES.feverMult}, 페널티 없음</td></tr>
  <tr><td>표적의 색 (반격)</td><td>+${RULES.points.counter}</td><td>+${RULES.points.counter * RULES.feverMult}</td></tr>
  <tr><td>빈 공간</td><td>콤보 끊김, 피버 감소</td><td>콤보 끊김</td></tr>`;

// ---------- 게임 ----------
socket.on('game:start', (d) => {
  startAt = d.startAt; endAt = d.endAt; players = d.players;
  circles.clear(); pending.clear(); lastCount = -1;
  for (const c of d.circles) circles.set(c.id, c);
  playing = true;
  show(null);
  renderScores();
  initAudio();
  startMusic(() => { const m = me(); return !!m && isFever(m, serverNow()); });
});
socket.on('circle:spawn', (c) => circles.set(c.id, c));
socket.on('click:rejected', ({ circleId }) => pending.delete(circleId));
socket.on('players', (p) => { players = p; renderScores(); });
socket.on('circle:claimed', ({ circleId, by, result, x, y }) => {
  circles.delete(circleId); pending.delete(circleId);
  const who = players.find((p) => p.id === by);
  if (!who) return;
  const mine = by === myId();
  renderer.burst(x, y, COLORS[who.color].hex, mine);
  if (mine) {
    const label = result.type === 'counter' ? ' 반격' : result.type === 'feverSteal' ? ' 견제' : '';
    renderer.text(x, y, `+${result.gained}${label}${result.comboBonus ? ' 콤보!' : ''}`, isFever(who, serverNow()) ? '#ff9f1c' : '#fff');
    ({ own: sfx.own, yellow: sfx.yellow, rainbow: sfx.rainbow, steal: sfx.steal, feverSteal: sfx.steal, counter: sfx.rainbow })[result.type]();
    if (result.marked) renderer.text(x, y + 45, `${RULES.markMs / 1000}초간 표적!`, '#ff5d73', 0.9);
    if (result.feverStarted) { sfx.fever(); renderer.text(800, 400, 'FEVER!', '#ff9f1c', 2); }
  } else {
    renderer.text(x, y, who.name, COLORS[who.color].hex, 0.75);
  }
  if (result.brokeComboOf === myId()) { sfx.comboBroken(); renderer.text(x, y - 45, '콤보 끊김!', '#ff5d73', 1.1); }
});
socket.on('game:over', ({ ranking }) => {
  playing = false;
  stopMusic();
  $('stage').classList.remove('feverOn');
  const pos = ranking.findIndex((p) => p.id === myId()) + 1;
  $('resTitle').textContent = pos === 1 ? '1등!' : `${pos}등`;
  $('rank').innerHTML = ranking.map((p, i) => `<div><span class="pos">${i + 1}</span>${shapeSVG(p.color, 24)}<span>${esc(p.name)}${p.id === myId() ? ' (나)' : ''}</span><span class="v">${p.score}</span></div>`).join('');
  (pos === 1 ? sfx.win : sfx.lose)();
  show('result');
});

$('cv').addEventListener('pointerdown', (e) => {
  if (!playing) return;
  ensureMusic();
  const now = serverNow();
  if (now < startAt) return;
  const { x, y } = renderer.toField(e.clientX, e.clientY);
  // 위에 그려진(나중에 나온) 원부터 판정
  const hit = [...circles.values()].reverse().find((c) => !pending.has(c.id) && isHit(c, now, x, y));
  if (hit) {
    pending.add(hit.id);
    socket.emit('game:click', { circleId: hit.id, x, y });
  } else {
    renderer.miss(x, y); sfx.miss();
    socket.emit('game:click', { circleId: null, x, y });
  }
});

$('musicBtn').onclick = () => { $('musicBtn').textContent = toggleMusic(playing) ? '음악 켜짐' : '음악 꺼짐'; };

// ---------- HUD ----------
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!); }

function renderScores() {
  $('scores').innerHTML = players.map((p) => `<div class="chip${p.id === myId() ? ' me' : ''}${p.connected ? '' : ' off'}" data-id="${p.id}">${shapeSVG(p.color, 26)}<div class="meta"><span class="nm">${esc(p.name)}${p.id === myId() ? ' (나)' : ''}</span><span class="sc">${p.score}</span></div><span class="cb">${p.combo ? p.combo + '콤보' : ''}</span></div>`).join('');
}

function updateHud(now: number) {
  const m = me();
  const fever = !!m && isFever(m, now);
  const fill = !m ? 0 : fever ? ((m.feverUntil - now) / RULES.feverMs) * 100 : m.fever;
  $('meterFill').style.width = `${Math.max(0, fill)}%`;
  $('flabel').textContent = fever ? `×${RULES.feverMult}` : '피버';
  $('combo').textContent = `${m?.combo ?? 0} 콤보`;
  $('stage').classList.toggle('feverOn', playing && fever);
  document.querySelectorAll<HTMLElement>('.chip').forEach((el) => {
    const p = players.find((x) => x.id === el.dataset.id);
    el.classList.toggle('marked', playing && !!p && isMarked(p, now));
    el.classList.toggle('fever', playing && !!p && isFever(p, now));
  });

  const left = playing ? Math.max(0, endAt - Math.max(now, startAt)) : RULES.roundMs;
  $('timer').textContent = String(Math.ceil(left / 1000));
  $('timer').classList.toggle('hot', playing && left <= RULES.finalRushMs);

  const cd = Math.ceil((startAt - now) / 1000);
  const showCd = playing && cd > 0;
  $('countdown').hidden = !showCd;
  if (showCd && cd !== lastCount) { $('countdown').textContent = String(cd); sfx.tick(); lastCount = cd; }
}

function frame() {
  const now = serverNow();
  for (const [id, c] of circles) if (isOut(c, now)) { circles.delete(id); pending.delete(id); }
  const m = me();
  updateHud(now);
  renderer.draw({
    circles: circles.values(),
    hidden: pending,
    myColor: m?.color ?? null,
    myFever: !!m && isFever(m, now),
    markedColors: new Set(players.filter((p) => isMarked(p, now)).map((p) => p.color)),
    now,
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
show('home');
