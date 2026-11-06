import { io, type Socket } from 'socket.io-client';
import {
  COLORS, DEFAULT_RULES, ITEMS, RULES, THEMES, bossState, cursorActive, holdCircles, isStunned, magnetOf, rangeTargets, circlePos, feverMultOf, feverMsOf, isFever, toGameRules, isHit, isMarked, isOut, reachOf,
  type Zone, type LaserShot, type Pull, type ArcadeOffer, type ArcadeState, type RoundEffect, type BotLevel, type Circle, type PlayPayload, type RoomRules, type ClientToServer, type ColorIndex, type PlayerState, type RoomSnapshot, type ServerToClient,
} from '@color-burst/shared';
import { Renderer, shapeSVG } from './render.ts';
import { renderRules } from './rulesUI.ts';
import { renderResult } from './results.ts';
import { pickChips, renderPick } from './arcadeUI.ts';
import { UI, icon } from './icons.ts';
import { buffChips, renderBuffBar, showRandomEvent, showItemPop } from './effectsUI.ts';
import { GameCursor, startCursorSync } from './cursor.ts';
import { ensureMusic, initAudio, sfx, startMusic, stopMusic } from './audio.ts';
import { initSettingsPanel, isTyping, onSettingsChange, settings } from './settings.ts';

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
// ---------- 아이템 ----------
let zones: Zone[] = [];
/** 시간 정지가 끝나는 서버 시각 */
let frozenUntil = 0;
/** 마지막 클릭 위치 (자석 끌림 선) */
let lastClick = { x: 0, y: 0 };
/** 마지막 폭죽·필드 클리어: 연쇄 폭발 순서 계산용 */
let blast = { x: 800, y: 450, R: 1000 };
let startAt = 0, endAt = 0, playing = false, lastCount = -1;
/** 지금 판(또는 대기실)의 방 규칙 */
let rules: RoomRules = DEFAULT_RULES;
/** 일시정지 중이면 멈춘 순간의 서버 시각. 화면은 이 시각에 멈춰 있다 */
let pausedView = 0;
const viewNow = () => (pausedView || serverNow());
/** 혼자 하기는 본인, 멀티는 방장만 일시정지 가능 */
const canPause = () => !!room && (room.solo || room.hostId === myId());

// ---------- 아케이드 ----------
let arcade: ArcadeState | null = null;
let offer: ArcadeOffer | null = null;
let picked = false;
/** 방금 끝난 라운드의 저주 결과 */
let effects: RoundEffect[] = [];
const picking = () => arcade?.phase === 'pick';

// 카드 연출이 끝날 때까지 다시 그리기를 미룬다
let animUntil = 0, renderQueued = false, dealtKey = '', renderedSig = '';
const fxOn = () => !settings.reduceFx && !matchMedia('(prefers-reduced-motion: reduce)').matches;
function holdRender(ms: number) {
  if (!fxOn()) return;
  animUntil = performance.now() + ms;
  setTimeout(() => { if (renderQueued) { renderQueued = false; showPick(); } }, ms + 20);
}
/** 랜덤 이벤트 룰렛이 도는 동안은 카드를 고를 수 없다 */
let eventShowing = false;
function chooseCard(i: number) {
  if (eventShowing || picked || !offer?.options[i] || performance.now() < animUntil) return;
  const cards = $('pickOv').querySelector('.acards');
  cards?.classList.add('choosing');
  cards?.querySelectorAll('.acard')[i]?.classList.add('picked');
  sfx.pickChoose();
  holdRender(700);
  socket.emit('arcade:choose', i);
}
function rerollCards() {
  if (eventShowing || picked || !offer?.rerollLeft || performance.now() < animUntil) return;
  $('pickOv').querySelector('.acards')?.classList.add('out');
  holdRender(280);
  socket.emit('arcade:reroll');
}
function showPick() {
  if (!arcade || arcade.phase !== 'pick') { $('pickOv').hidden = true; return; }
  if (performance.now() < animUntil) { renderQueued = true; return; }
  picked = !arcade.waiting.includes(myId());
  const key = offer ? JSON.stringify(offer.options) : '';
  // 내가 고르는 중에는 다른 사람의 선택 현황이 바뀌어도 다시 그리지 않는다 (카드 연출 유지)
  const sig = JSON.stringify([key, picked, effects.length, offer?.rerollLeft, picked ? arcade.waiting : 0, me()?.picks.length]);
  if (sig === renderedSig && !$('pickOv').hidden) return;
  renderedSig = sig;
  const deal = !!offer && !picked && key !== dealtKey;
  if (deal) dealtKey = key;
  const opening = $('pickOv').hidden;
  renderPick($('pickOv'), { state: arcade, offer, me: me(), players, chosen: picked, effects, deal, opening }, {
    choose: chooseCard,
    reroll: rerollCards,
  });
  $('pickOv').hidden = false;
}
// 라운드 종료: 능력 선택이 열리기 전까지 "라운드 종료!"를 보여 주고 클릭을 막는다
let roundOver = false;
let roundEndTimer = 0;
socket.on('round:end', () => {
  roundOver = true;
  circles.clear(); pending.clear(); zones = [];
  $('roundEnd').hidden = false;
  stopMusic();
  sfx.roundEnd();
  clearTimeout(roundEndTimer);
  roundEndTimer = window.setTimeout(() => { $('roundEnd').hidden = true; }, RULES.roundEndMs);
});
socket.on('arcade:pick', (st) => {
  roundOver = false;
  $('roundEnd').hidden = true;
  const opening = !picking();
  arcade = st;
  if (opening) { offer = null; stopMusic(); sfx.pickOpen(); circles.clear(); pending.clear(); }
  showPick();
});
socket.on('arcade:effects', (e) => { effects = e; if (picking()) showPick(); });
socket.on('arcade:event', (r) => {
  eventShowing = true;
  sfx.event();
  showRandomEvent($('stage'), r, players, myId(), !fxOn(), (result) => (result ? sfx.eventResult() : sfx.eventTick())).then(() => { eventShowing = false; });
});
socket.on('arcade:offer', (o) => {
  offer = o;
  if (o.options.some((x) => x.tier === 3)) sfx.legend();
  showPick();
});
document.addEventListener('keydown', (e) => {
  if (!picking() || picked || !offer || isTyping(e)) return;
  if (['1', '2', '3', '4'].includes(e.key)) chooseCard(Number(e.key) - 1);
  if (e.key === 'r' || e.key === 'R') rerollCards();
});
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
$('soloBtn').onclick = () => { initAudio(); socket.emit('room:solo', { name: getName(), key: KEY }, entered); };
const join = () => socket.emit('room:join', { code: codeInput.value, name: getName(), key: KEY }, entered);
$('joinBtn').onclick = join;
codeInput.onkeydown = (e) => { if (e.key === 'Enter') join(); };
// 주소에 #ABCD 처럼 방 코드를 붙여 공유할 수 있게
if (location.hash.length === 5) codeInput.value = location.hash.slice(1).toUpperCase();

// ---------- 대기실 ----------
const LEVELS = ['쉬움', '보통', '어려움'];
socket.on('room:state', (s) => {
  room = s;
  if (!playing) rules = s.rules;
  if (!playing) players = s.players;
  $('roomTag').hidden = false;
  $('roomTag').textContent = s.solo ? '혼자 하기' : `방 ${s.code}`;
  history.replaceState(null, '', s.solo ? location.pathname : `#${s.code}`);
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

  $('codeBlock').hidden = room.solo;
  $('soloTitle').hidden = !room.solo;
  $('fillBotsRow').hidden = room.solo;
  $('leaveBtn').textContent = room.solo ? '처음으로' : '방 나가기';
  $('hostOpts').hidden = !host;
  $<HTMLInputElement>('fillBots').checked = room.fillBots;
  $('botLevel').innerHTML = LEVELS.map((l, i) => `<button type="button" data-l="${i}" aria-pressed="${room!.botLevel === i}">${i === 0 ? icon(UI.bot, 15) : ''}${i === 0 ? '봇 ' : ''}${l}</button>`).join('');
  $('botLevel').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => socket.emit('lobby:options', { botLevel: Number(b.dataset.l) as BotLevel });
  });

  renderRules($('rulesBox'), room.rules, host, {
    preset: (preset) => socket.emit('lobby:rules', { preset }),
    change: (patch) => socket.emit('lobby:rules', { rules: patch }),
  });

  const humans = room.players.filter((p) => !p.bot).length;
  $<HTMLButtonElement>('startBtn').hidden = !host;
  $('lobbyHint').textContent = room.solo ? '봇 3명과 대결해요' : host
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
$('ver').textContent = `v${__APP_VERSION__}`;
// 1.0.0-beta.1 → BETA, 1.0.0-rc.1 → RC
const pre = __APP_VERSION__.split('-')[1]?.split('.')[0];
if (pre) { $('stageBadge').textContent = pre.toUpperCase(); $('stageBadge').hidden = false; }
}
$('leaveBtn').onclick = () => { socket.emit('room:leave'); store('cb-room', null); resetToHome(); };
$('rematchBtn').onclick = () => { initAudio(); socket.emit('game:start', (r) => { $('resultHint').textContent = r.ok ? '' : r.error; }); };
$('toLobbyBtn').onclick = () => { show('lobby'); renderLobby(); };



// ---------- 게임 ----------
function applyPlay(d: PlayPayload, fresh: boolean) {
  roundOver = false;
  $('roundEnd').hidden = true;
  startAt = d.startAt; endAt = d.endAt; players = d.players; rules = d.rules;
  arcade = d.arcade;
  if (!picking()) { offer = null; effects = []; }
  circles.clear(); pending.clear();
  if (fresh) lastCount = -1;
  // 테마 라운드: 카운트다운 동안 테마 이름을 크게
  if (fresh && d.theme) renderer.text(800, 330, THEMES[d.theme].name, '#ffd43b', 1.8);
  for (const c of d.circles) circles.set(c.id, c);
  zones = d.zones ?? [];
  pulls.clear();
  for (const pl of d.pulls ?? []) pulls.set(pl.circleId, pl);
  setLaser(d.laser ?? null);
  // 재접속: 원에 남아 있는 정지 구간으로 시간 정지 상태 복원
  frozenUntil = Math.max(0, ...d.circles.flatMap((c) => (c.holds ?? []).map(([a, ms]) => a + ms)));
  playing = true;
  show(null);
  renderScores();
  initAudio();
  if (picking()) { stopMusic(); showPick(); return; }
  // 고른 카드 연출이 끝난 뒤에 선택 화면을 닫는다 (카운트다운 3초 동안이라 게임에는 영향 없음)
  const wait = Math.max(0, animUntil - performance.now());
  setTimeout(() => { if (!picking()) { $('pickOv').hidden = true; renderedSig = ''; } }, wait);
  setPaused(d.pausedBy);
}
socket.on('game:start', (d) => applyPlay(d, true));
socket.on('game:sync', (d) => applyPlay(d, false));
socket.on('game:pause', ({ by }) => setPaused(by));

function setPaused(by: string | null) {
  if (by) {
    if (!pausedView) pausedView = serverNow();
    stopMusic();
    const who = players.find((p) => p.id === by);
    $('pauseWho').textContent = room?.solo ? '' : `${by === myId() ? '내가' : `${who?.name ?? '방장'}님이`} 멈췄어요`;
    $<HTMLButtonElement>('resumeBtn').hidden = !canPause();
    $('pauseOv').hidden = false;
  } else {
    pausedView = 0;
    $('pauseOv').hidden = true;
    startMusic(() => { const m = me(); return !!m && isFever(m, serverNow()); });
  }
}
function togglePause() {
  if (!playing || !canPause() || picking()) return;
  socket.emit(pausedView ? 'game:resume' : 'game:pause');
}
$('pauseBtn').innerHTML = `${icon(UI.pause, 16)}<span class="bt">일시정지</span>`;
$('pauseBtn').onclick = togglePause;
$('resumeBtn').onclick = () => { initAudio(); socket.emit('game:resume'); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settingsPanel').hidden) return; // Esc는 설정 창 닫기가 먼저
  if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && !isTyping(e)) togglePause();
});
// 혼자 하기: 다른 탭으로 가면 자동으로 멈춤
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing && room?.solo && !pausedView) socket.emit('game:pause');
});
const BOSS_NAME = { normal: '보스', guard: '방어형 보스', rage: '공격형 보스', runner: '이동형 보스' } as const;
/** 같은 틱에 여러 마리가 나오면 알림을 한 번만 */
let bossAnnouncedAt = 0;
socket.on('circle:spawn', (c) => {
  circles.set(c.id, c);
  if (c.kind !== 'boss') return;
  const now = performance.now();
  if (now - bossAnnouncedAt < 300) return;
  bossAnnouncedAt = now;
  sfx.bossAppear();
  const n = [...circles.values()].filter((x) => x.kind === 'boss' && serverNow() - x.born < 300).length;
  renderer.text(800, 300, n > 1 ? `보스 ${n}마리 등장!` : `${BOSS_NAME[c.boss ?? 'normal']} 등장!`, '#ffc23a', 1.8);
});
const nameOf = (id: string | null) => players.find((p) => p.id === id);
const GOLD = '#ffd166';
/** 잭팟 숫자는 배율이 클수록 크게 */
const jackpotSize = (mult: number, base = 1) => base * (1 + (mult - 1) * 0.5);
socket.on('boss:hit', ({ circleId, by, hp, gained, jackpot, blocked, enraged }) => {
  const c = circles.get(circleId);
  if (c) c.hp = hp;
  if (by === myId() && c && (blocked || enraged)) {
    const p = circlePos(c, serverNow());
    // 방어형 보호막에 막힘 / 붉은 공격형을 때려 감점
    if (blocked) { sfx.bossBlock(); renderer.text(p.x + 60, p.y - 70, '막힘!', '#7fd3ff', 0.9); }
    else { sfx.comboBroken(); renderer.text(p.x + 60, p.y - 70, `${gained}`, '#ff5d73', 1.1); }
    return;
  }
  if (blocked || enraged) return;
  renderer.bossPoke(circleId);
  if (by === myId() && c) {
    const p = circlePos(c, serverNow());
    if (jackpot > 1) { renderer.jackpot(p.x, p.y, jackpot, true); sfx.jackpot(jackpot); }
    renderer.text(p.x + 60, p.y - 70, `+${gained}`, jackpot > 1 ? GOLD : '#fff', jackpotSize(jackpot, 0.7));
  }
});
/** 마지막으로 보스가 터진 서버 시각 */
let bossKilledAt = 0;
socket.on('boss:killed', ({ circleId, by, gained, mvp, mvpGained, x, y, jackpot }) => {
  bossKilledAt = serverNow();
  circles.delete(circleId);
  const killer = nameOf(by), mvpP = nameOf(mvp);
  renderer.burst(x, y, '#ffc23a', true); renderer.burst(x, y, '#fff', true);
  sfx.bossKill();
  if (jackpot > 1) { renderer.jackpot(x, y, jackpot, true); if (by === myId()) sfx.jackpot(jackpot); }
  if (killer) renderer.text(x, y, `${by === myId() ? '내' : killer.name} 막타! +${gained}`, jackpot > 1 ? GOLD : by === myId() ? '#ffc23a' : COLORS[killer.color].hex, jackpotSize(jackpot, 1.3));
  if (mvpP && mvpGained) renderer.text(x, y + 50, `최다 타격 ${mvp === myId() ? '나' : mvpP.name} +${mvpGained}`, '#fff', 0.85);
});
socket.on('boss:escaped', ({ circleId }) => {
  circles.delete(circleId);
  renderer.text(800, 300, '보스가 도망갔어요', '#9ca2d6', 1.1);
});
socket.on('click:rejected', ({ circleId }) => pending.delete(circleId));
socket.on('players', (p) => { players = p; renderScores(); if (picking()) showPick(); });
socket.on('circle:claimed', ({ circleId, by, result, x, y }) => {
  const claimedKind = circles.get(circleId)?.kind;
  circles.delete(circleId); pending.delete(circleId); pulls.delete(circleId);
  const who = players.find((p) => p.id === by);
  if (!who) return;
  // 견제 반사: 원 주인이 반사해서 주인이 잡은 것으로 처리됨
  if (result.reflectedTo && result.reflected) {
    const owner = nameOf(result.reflectedTo);
    if (owner) renderer.burst(x, y, COLORS[owner.color].hex, true);
    renderer.shockwave(x, y, 70);
    if (result.reflectedTo === myId()) { sfx.own(); renderer.text(x, y, `반사! +${result.reflected.gained}`, '#4d9bff', 1.1); }
    else if (by === myId()) { sfx.comboBroken(); renderer.text(x, y, '반사당함! 콤보 끊김', '#ff5d73', 1); if (result.marked) renderer.text(x, y + 45, `${rules.markSec}초간 표적!`, '#ff5d73', 0.9); }
    else if (owner) renderer.text(x, y, `${owner.name} 반사!`, COLORS[owner.color].hex, 0.75);
    return;
  }
  const mine = by === myId();
  const blasted = result.via === 'blast';
  // 폭죽·필드 클리어: 폭발 중심에서 가까운 원부터 충격파를 따라 차례로 터진다
  if (blasted) renderer.burstDelayed(x, y, COLORS[who.color].hex, (Math.hypot(x - blast.x, y - blast.y) / blast.R) * 350);
  else renderer.burst(x, y, COLORS[who.color].hex, mine);
  if (result.jackpot > 1) { renderer.jackpot(x, y, result.jackpot, false); if (mine) sfx.jackpot(result.jackpot); }
  if (mine) {
    const label = blasted ? '' : (result.type === 'counter' ? ' 반격' : result.type === 'feverSteal' ? ' 견제' : '') + (result.plundered ? ' 강탈' : '');
    const col = result.jackpot > 1 ? GOLD : isFever(who, serverNow()) ? '#ff9f1c' : '#fff';
    renderer.text(x, y, `+${result.gained}${label}${result.comboBonus ? ' 콤보!' : ''}`, col, jackpotSize(result.jackpot));
    if (!blasted) ({ own: sfx.own, yellow: sfx.yellow, rainbow: sfx.rainbow, steal: sfx.steal, feverSteal: sfx.steal, counter: sfx.rainbow })[result.type]();
    if (result.marked) renderer.text(x, y + 45, `${rules.markSec}초간 표적!`, '#ff5d73', 0.9);
    if (result.feverStarted) { sfx.fever(); renderer.text(800, 400, 'FEVER!', '#ff9f1c', 2); }
  } else {
    renderer.text(x, y, who.name, COLORS[who.color].hex, 0.75);
  }
  if (result.brokeComboOf === myId()) { sfx.comboBroken(); renderer.text(x, y - 45, '콤보 끊김!', '#ff5d73', 1.1); }
  if (result.shielded && claimedKind === me()?.color) renderer.text(x, y - 45, '방패!', '#4d9bff', 1.1);
});
socket.on('item:got', ({ circleId, by, item, tier, x, y }) => {
  circles.delete(circleId); pending.delete(circleId);
  const who = nameOf(by);
  if (by === myId()) {
    const sp = renderer.toScreen(x, y);
    showItemPop($('itemPops'), sp.x, sp.y, item, tier, !fxOn());
    sfx.item(tier);
  } else if (who) renderer.text(x, y, `${who.name} ${ITEMS[item].name}`, COLORS[who.color].hex, 0.75);
  if (item === 'bomb') { blast = { x, y, R: RULES.items.bombR }; renderer.shockwave(x, y, RULES.items.bombR); sfx.bomb(); }
  if (item === 'fieldClear') { blast = { x: 800, y: 450, R: 1000 }; renderer.flash(); renderer.shockwave(800, 450, 1000); sfx.clear(); }
});
socket.on('zone:add', (z) => { zones.push(z); if (z.by === myId()) sfx.zone(); });
// ---------- 게임 커서: 레이저·스턴·자석 끌기 ----------
const gameCursor = new GameCursor();
/** 커서 자석으로 끌려가는 원 */
const pulls = new Map<number, Pull>();
let laser: LaserShot | null = null;
let laserFireTimer = 0;
function setLaser(l: LaserShot | null) {
  laser = l;
  clearTimeout(laserFireTimer);
  if (l && l.at > serverNow()) laserFireTimer = window.setTimeout(() => sfx.laserFire(), l.at - serverNow());
}
socket.on('laser:warn', (l) => { setLaser(l); sfx.laserWarn(); });
socket.on('stun', ({ playerId }) => {
  const p = nameOf(playerId);
  if (playerId === myId()) {
    sfx.stun();
    const c = gameCursor.pos ?? { x: 800, y: 450 };
    renderer.text(c.x, c.y - 40, '스턴!', '#9ca2d6', 1.2);
  } else if (p) renderer.text(800, 120, `${p.name} 스턴!`, COLORS[p.color].hex, 0.8);
});
socket.on('circle:pull', (pl) => { pulls.set(pl.circleId, pl); if (pl.by === myId()) sfx.pull(); });
// 커서 위치는 게임 중에만 보낸다 (캔버스 밖·탭 전환이면 서버가 판정에서 뺀다)
const cursorOn = () => cursorActive({ playing, picking: picking(), roundOver, paused: !!pausedView, hidden: document.hidden, focused: document.hasFocus() });
startCursorSync(() => (cursorOn() ? gameCursor.pos : null), (p) => socket.emit('cursor:move', p));
// 탭을 바꾸거나 다른 창으로 가면 커서를 지운다 (돌아와서 마우스를 움직이면 다시 생김)
document.addEventListener('visibilitychange', () => { if (document.hidden) gameCursor.leave(); });
window.addEventListener('blur', () => gameCursor.leave());
socket.on('wave:warn', ({ at }) => { renderer.waveWarn(Math.max(100, at - serverNow())); sfx.wave(); });
socket.on('circles:hold', ({ ids, at, ms }) => {
  // 서버와 같은 방식으로 붙인다 (정지 중 또 정지하면 이어 붙임)
  holdCircles(ids.map((id) => circles.get(id)).filter((c): c is Circle => !!c), at, ms);
  frozenUntil = Math.max(frozenUntil, at + ms);
  sfx.freeze();
});
socket.on('game:over', (d) => {
  const { ranking } = d;
  playing = false;
  arcade = null; offer = null;
  $('pickOv').hidden = true;
  pausedView = 0;
  $('pauseOv').hidden = true;
  stopMusic();
  $('stage').classList.remove('feverOn');
  const pos = ranking.findIndex((p) => p.id === myId()) + 1;
  $('resTitle').textContent = pos === 1 ? '1등!' : `${pos}등`;
  const r = renderResult(d, myId(), effects);
  $('rank').innerHTML = r.rank;
  $('titleList').innerHTML = r.titles;
  $('graphBox').innerHTML = r.graph;
  if (room) room.wins = d.wins;
  (pos === 1 ? sfx.win : sfx.lose)();
  const again = canPause();
  $<HTMLButtonElement>('rematchBtn').hidden = !again;
  $('toLobbyBtn').textContent = room?.solo ? '규칙 바꾸기' : '대기실로';
  $('resultHint').textContent = again ? '' : '방장이 한 판 더를 누르면 바로 시작해요';
  show('result');
});

// 게임 커서: 진짜 마우스 위치와 이동량으로 움직인다 (1차는 효과 없음 → 마우스 위치 그대로)
const moveCursor = (e: PointerEvent) => {
  const real = renderer.toField(e.clientX, e.clientY);
  const prev = renderer.toField(e.clientX - e.movementX, e.clientY - e.movementY);
  gameCursor.move(real, { x: real.x - prev.x, y: real.y - prev.y }, null);
};
$('cv').addEventListener('pointermove', moveCursor);
$('cv').addEventListener('pointerleave', () => gameCursor.leave());
$('cv').addEventListener('pointerdown', (e) => {
  if (!playing || pausedView || picking() || roundOver) return;
  ensureMusic();
  const now = serverNow();
  if (now < startAt) return;
  // 클릭은 게임 커서 위치로 판정한다 (터치는 누른 자리로 커서를 옮긴 뒤)
  moveCursor(e);
  const { x, y } = gameCursor.pos ?? renderer.toField(e.clientX, e.clientY);
  lastClick = { x, y };
  const meNow = me();
  if (meNow && isStunned(meNow, now)) { renderer.miss(x, y, true); return; }
  const m = me();
  const reach = m ? reachOf(m, now) : 0;
  if (reach > 0) renderer.reachRing(x, y, reach);
  // 위에 그려진(나중에 나온) 원부터, 보스는 맨 마지막에 판정
  const list = [...circles.values()].reverse();
  // 자석에 끌려가는 원은 누를 수 없다
  const hit = list.find((c) => c.kind !== 'boss' && !pending.has(c.id) && !pulls.has(c.id) && isHit(c, now, x, y))
    ?? list.find((c) => c.kind === 'boss' && isHit(c, now, x, y));
  if (hit?.kind === 'boss') {
    // 보호막·붉은 상태면 서버 응답(막힘·감점)으로만 연출한다
    const st = bossState(hit, now);
    if (!st.shielded && !st.enraged) { renderer.bossPoke(hit.id); sfx.bossHit(); }
    socket.emit('game:click', { circleId: hit.id, x, y });
  } else if (hit) {
    pending.add(hit.id);
    socket.emit('game:click', { circleId: hit.id, x, y });
  } else {
    // 넓은 손·자석으로 잡힐 원이 있으면 빗나간 표시를 하지 않는다 (서버가 잡아서 알려 준다)
    // 넓은 손 범위로 같이 잡힐 원이 있으면 빗나간 게 아니다
    const saved = !!m && rangeTargets(circles.values(), m.color, x, y, now, reach, pending, RULES.lagWindowMs).length > 0;
    // 빈 곳 페널티가 꺼져 있으면 흔들림·소리 없이 표시만
    // 보스가 막 터진 직후의 빈 곳 클릭은 서버도 페널티를 주지 않으므로 가볍게만 표시
    const grace = now - bossKilledAt < RULES.boss.killGraceMs;
    if (!saved) {
      if (rules.missPenalty && !grace) { renderer.miss(x, y); sfx.miss(); } else renderer.miss(x, y, true);
    }
    socket.emit('game:click', { circleId: null, x, y });
  }
});

initSettingsPanel();

// 핑 표시: 3초마다 서버 왕복 시간 측정
let pingTimer: number | null = null;
function updatePing() {
  if (pingTimer !== null) clearInterval(pingTimer);
  pingTimer = null;
  $('ping').hidden = !settings.showPing;
  if (!settings.showPing) return;
  const measure = () => {
    if (!socket.connected) { $('ping').textContent = '연결 끊김'; return; }
    const t0 = performance.now();
    socket.emit('time:ping', () => {
      const ms = Math.round(performance.now() - t0);
      $('ping').innerHTML = `${icon(UI.ping, 14)} ${ms}ms`;
      $('ping').classList.toggle('bad', ms > 150);
    });
  };
  measure();
  pingTimer = window.setInterval(measure, 3000);
}
onSettingsChange(updatePing);
updatePing();

// ---------- HUD ----------
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!); }

function renderScores() {
  $('scores').innerHTML = players.map((p) => `<div class="chip${p.id === myId() ? ' me' : ''}${p.connected ? '' : ' off'}" data-id="${p.id}">${shapeSVG(p.color, 26)}<div class="meta"><span class="nm">${esc(p.name)}${p.id === myId() ? ' (나)' : ''}${room?.wins[p.id] ? ` · ${room.wins[p.id]}승` : ''}</span><span class="sc">${p.score}</span></div><span class="cb">${p.combo ? p.combo + '콤보' : ''}</span>${pickChips(p.picks ?? [])}${buffChips(p, serverNow())}</div>`).join('');
}

let lastBuffSec = 0;
function updateHud(now: number) {
  const m = me();
  const fever = !!m && isFever(m, now);
  const G = toGameRules(rules);
  const fill = !m ? 0 : fever ? ((m.feverUntil - now) / feverMsOf(m, G)) * 100 : m.fever;
  $('meterFill').style.width = `${Math.max(0, fill)}%`;
  const after = !!m && !fever && now < m.afterUntil;
  const fl = fever && m ? `×${feverMultOf(m, G)}` : after ? '여운' : '피버';
  if ($('flabel').dataset.v !== fl) { $('flabel').dataset.v = fl; $('flabel').innerHTML = `${icon(UI.fever, 16)}<span>${fl}</span>`; }
  $('combo').textContent = `${m?.combo ?? 0} 콤보`;
  renderBuffBar($('buffs'), playing && !picking() ? m : undefined, now, (id) => RULES.items.ms[id]);
  // 점수판의 버프 아이콘은 1초마다 다시 그려 끝난 것을 지운다
  const sec = Math.floor(now / 1000);
  if (playing && sec !== lastBuffSec) { lastBuffSec = sec; renderScores(); }
  $('stage').classList.toggle('feverOn', playing && !picking() && fever);
  document.querySelectorAll<HTMLElement>('.chip').forEach((el) => {
    const p = players.find((x) => x.id === el.dataset.id);
    const live = playing && !picking() && !!p;
    el.classList.toggle('marked', live && isMarked(p!, now));
    el.classList.toggle('fever', live && isFever(p!, now));
  });

  $('roundTag').hidden = !arcade;
  if (arcade) $('roundTag').innerHTML = `${icon(UI.arcade, 14)} ${arcade.round}/${arcade.rounds}`;
  const pickLeft = picking() ? Math.max(0, arcade!.pickEndsAt - serverNow()) : 0;
  const pt = document.getElementById('pickTimer');
  if (pt) pt.textContent = `${Math.ceil(pickLeft / 1000)}초`;
  const left = picking() ? 0 : playing ? Math.max(0, endAt - Math.max(now, startAt)) : toGameRules(rules).roundMs;
  $('timer').textContent = String(Math.ceil(left / 1000));
  $('timer').classList.toggle('hot', playing && left <= RULES.finalRushMs);

  const cd = Math.ceil((startAt - now) / 1000);
  const showCd = playing && !picking() && cd > 0;
  $('countdown').hidden = !showCd;
  if (showCd && cd !== lastCount) { $('countdown').textContent = String(cd); sfx.tick(); lastCount = cd; }
}

function frame() {
  const now = viewNow();
  $('pauseBtn').hidden = !(playing && canPause() && !picking());
  // 게임 중에는 진짜 마우스 커서를 숨기고 게임 커서를 그린다
  $('stage').classList.toggle('gamecursor', playing && !picking() && !roundOver && !pausedView);
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
    blurred: !!m && now < m.blurUntil,
    zones: zones.filter((z) => z.until > now).map((z) => ({ ...z, color: nameOf(z.by)?.color ?? 0 })),
    frozen: now < frozenUntil,
    cursor: gameCursor.pos && playing && !picking() && !roundOver
      ? { ...gameCursor.pos, stunned: !!m && isStunned(m, now), reach: m ? reachOf(m, now) : 0, magnet: m ? magnetOf(m, now) : 0 }
      : null,
    laser,
    pulls: new Map([...pulls].map(([id, pl]) => [id, { from: pl.from, to: pl.by === myId() ? gameCursor.pos : null, at: pl.at, ms: pl.ms }])),
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
show('home');
$('ver').textContent = `v${__APP_VERSION__}`;
// 1.0.0-beta.1 → BETA, 1.0.0-rc.1 → RC
const pre = __APP_VERSION__.split('-')[1]?.split('.')[0];
if (pre) { $('stageBadge').textContent = pre.toUpperCase(); $('stageBadge').hidden = false; }
