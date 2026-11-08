import { io, type Socket } from 'socket.io-client';
import {
  ABILITY, ARCADE, COMBOS, COLORS, DEFAULT_RULES, FIELD, ITEMS, RULES, THEMES, auraAt, combosOf, holdLasers, isLast, isMine, isGuarded, modsOf, bossState, cursorActive, cursorModeOf, holdCircles, inAura, isStunned, magnetOf,
  type CursorMode, rangeTargets, circlePos, feverMultOf, feverMsOf, isFever, toGameRules, isHit, isMarked, isOut, reachOf,
  type Zone, type LaserVolley, type Pull, type Pick, type ArcadeOffer, type MapPattern, PATTERNS, moverAt, patternActive, vortexWarned, type ArcadeState, type RoundEffect, type BotLevel, type Circle, type PlayPayload, type RoomRules, type ClientToServer, type ColorIndex, type PlayerState, type RoomSnapshot, type ServerToClient,
} from '@color-burst/shared';
import { closeCodex, openCodex } from './codex.ts';
import { closeConfirm, confirmDialog } from './confirm.ts';
import { closeGuide, openGuide } from './guide.ts';
import { BOSS_HITSTOP_MS, BOSS_SHAKE, FEVER_BURST, Renderer, shapeSVG, type ScoreTier } from './render.ts';
import { renderRules } from './rulesUI.ts';
import { renderResult } from './results.ts';
import { buildCard, pickChips, rankOf, renderPick } from './arcadeUI.ts';
import { UI, icon, itemIcon } from './icons.ts';
import { buffChips, flashCombo, renderComboBar, showPatternBanner, popOnChip, pushFeed, renderBuffBar, showRandomEvent, showItemPop } from './effectsUI.ts';
import { GameCursor, startCursorSync } from './cursor.ts';
import { hideTip, initTips } from './tooltip.ts';
import { ensureMusic, initAudio, sfx, startMusic, stopMusic } from './audio.ts';
import { initSettingsPanel, isTyping, onSettingsChange, settings } from './settings.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
initTips();

/**
 * #app 최대 폭을 게임 상자의 남는 높이(--side)에 맞춘다: 데스크톱에서 상자가 정사각형에 가깝게 되고 위쪽 바·점수판도 같은 폭.
 * 상자는 남는 공간을 다 써서(폰 세로·가로에서도 피버 바가 화면 안), 정사각형 판은 캔버스가 상자 안 가운데에 그린다
 */
function fitStage() {
  const app = $('app'), cs = getComputedStyle(app);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const gap = parseFloat(cs.rowGap) || 0;
  const others = ([...app.children] as HTMLElement[]).filter((e) => e.id !== 'stage' && e.offsetParent !== null);
  const used = others.reduce((sum, e) => sum + e.offsetHeight, 0) + gap * others.length;
  const side = Math.max(0, Math.floor(app.clientHeight - padY - used));
  if (document.documentElement.style.getPropertyValue('--side') !== `${side}px`) document.documentElement.style.setProperty('--side', `${side}px`);
}
addEventListener('resize', fitStage);
// 창 크기 이벤트가 안 오는 경우(확대·기기 회전 등)도 문서 크기가 바뀌면 다시 계산
new ResizeObserver(fitStage).observe(document.documentElement);
new ResizeObserver(fitStage).observe($('scores'));
new ResizeObserver(fitStage).observe(document.querySelector('.top')!);
fitStage();
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
/** 판 중앙과 중앙에서 구석까지 거리 (화면 문구·폭죽 위치) */
const CX = FIELD.w / 2, CY = FIELD.h / 2, CORNER = Math.hypot(CX, CY);
let blast = { x: CX, y: CY, R: CORNER };
let startAt = 0, endAt = 0, playing = false, lastCount = -1;
/** 지금 판(또는 대기실)의 방 규칙 */
let rules: RoomRules = DEFAULT_RULES;
/** 일시정지 중이면 멈춘 순간의 서버 시각. 화면은 이 시각에 멈춰 있다 */
let pausedView = 0;
const viewNow = () => (pausedView || serverNow());
/** 혼자 하기는 본인, 멀티는 방장만 일시정지 가능 */
/** 한 판 더·규칙 바꾸기 권한: 혼자 하기는 본인, 멀티는 방장 */
const isHost = () => !!room && (room.solo || room.hostId === myId());
/** 일시정지: 혼자 하기는 언제나, 멀티는 남은 횟수가 있을 때 */
const canPause = () => { const m = me(); return !!room && !!m && (room.solo || m.pausesLeft > 0); };
/** 맵 패턴 (경고 중이거나 나와 있는 것)과 사라진 가시 공 */
let mapPattern: MapPattern | null = null;
let popped = new Set<number>();
/** 두 번째 소용돌이 경고음을 냈는지 */
let vortexWarnHeard = false;
/** 일시정지가 저절로 풀리기 시작하는 시각, 풀려서 다시 시작하는 시각 (카운트다운 중) */
let pauseUntil = 0, resumeAt = 0;

// ---------- 아케이드 ----------
let arcade: ArcadeState | null = null;
let offer: ArcadeOffer | null = null;
/** 내가 완성한 조합 (새로 완성되면 알림). 처음 받은 상태(새로고침·재접속)에서는 알리지 않는다 */
let myCombos = new Set<string>();
let combosReady = false;
/** 지난번 내 콤보 (철옹성 발동 표시: 콤보가 0이 아니라 일부만 줄었을 때) */
let lastCombo: number | null = null;
let ironNoticeAt = 0;
/** 방을 나가면 조합 알림 기준을 비운다 (다른 방에 들어가 받은 첫 상태는 알리지 않음) */
function resetComboNotice() { myCombos = new Set(); combosReady = false; lastCombo = null; }
/** 점수판 칩 빌드 카드: 보고 있는 사람, 눌러서 고정했는지 */
let popFor: string | null = null, popPinned = false;
const chipPop = document.createElement('div');
chipPop.className = 'chippop';
chipPop.hidden = true;
document.body.appendChild(chipPop);
let picked = false;
/** 방금 끝난 라운드의 저주 결과 */
let effects: RoundEffect[] = [];
const picking = () => arcade?.phase === 'pick';

// 카드 연출이 끝날 때까지 다시 그리기를 미룬다
let animUntil = 0, renderQueued = false, dealtKey = '', renderedSig = '';
/** 마지막으로 깔아 준 카드들 (두 장 고르기에서 첫 장을 고른 뒤 남은 카드는 다시 깔지 않으려고) */
let dealtCards: string[] = [];
const cardKeys = (opts: readonly Pick[]) => opts.map((o) => `${o.id}:${o.tier}`);
/** 이번 카드들이 방금 깔아 준 카드에서 고른 것만 빠진 것인지 */
const isLeftover = (opts: readonly Pick[]) => {
  const k = cardKeys(opts);
  return k.length > 0 && k.length < dealtCards.length && k.every((x) => dealtCards.includes(x));
};
const fxOn = () => !settings.reduceFx && !matchMedia('(prefers-reduced-motion: reduce)').matches;
function holdRender(ms: number) {
  if (!fxOn()) return;
  animUntil = performance.now() + ms;
  setTimeout(() => { if (renderQueued) { renderQueued = false; showPick(); } }, ms + 20);
}
/** 랜덤 이벤트 룰렛이 도는 동안은 카드를 고를 수 없다 */
let eventShowing = false;
/** 카드를 골라 서버 답을 기다리는 중 (겹친 클릭 방지, 다음 arcade:offer·선택 종료 때 풀림) */
let choosePending = false;
function chooseCard(i: number) {
  if (eventShowing || picked || choosePending || !offer?.options[i] || performance.now() < animUntil) return;
  choosePending = true;
  const cards = $('pickOv').querySelector('.acards');
  cards?.classList.add('choosing');
  cards?.querySelectorAll('.acard')[i]?.classList.add('picked');
  sfx.pickChoose();
  holdRender(700);
  socket.emit('arcade:choose', i, offer.options[i].id);
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
  if (picked) choosePending = false;
  const key = offer ? JSON.stringify(offer.options) : '';
  // 내가 고르는 중에는 다른 사람의 선택 현황이 바뀌어도 다시 그리지 않는다 (카드 연출 유지)
  const sig = JSON.stringify([key, picked, effects.length, offer?.rerollLeft, picked ? arcade.waiting : 0, me()?.picks.length]);
  if (sig === renderedSig && !$('pickOv').hidden) return;
  renderedSig = sig;
  const deal = !!offer && !picked && key !== dealtKey && !isLeftover(offer.options);
  if (offer && key !== dealtKey) { dealtKey = key; dealtCards = cardKeys(offer.options); }
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
  // 남은 카드만 다시 온 것이면 레전드 소리도 다시 내지 않는다
  if (o.options.some((x) => x.tier === 3) && !isLeftover(o.options)) sfx.legend();
  offer = o;
  choosePending = false;
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
/** 도감 열기: 방 규칙(점수표)과 내 증강(조합 진행도)을 넘긴다 */
const openCodexHere = () => openCodex($('stage'), { rules: room ? rules : DEFAULT_RULES, picks: me()?.picks });
$('codexBtn').onclick = $('codexBtn2').onclick = $('codexTop').onclick = openCodexHere;
$('codexTop').innerHTML = `${icon(UI.codex, 16)}<span class="bt">도감</span>`;
$('codexBtn').innerHTML = $('codexBtn2').innerHTML = `${icon(UI.codex, 16)}<span>도감</span>`;
// 게임 방법: 방 안이면 그 방 규칙 숫자로
$('guideBtn').onclick = $('guideBtn2').onclick = () => openGuide($('stage'), room ? rules : DEFAULT_RULES, !!room);
$('guideBtn').innerHTML = $('guideBtn2').innerHTML = `${icon(UI.guide, 16)}<span>게임 방법</span>`;
/** 처음 접속한 사람에게 한 번만 자동으로 (브라우저에 저장, 저장이 안 되는 환경이면 띄우지 않음) */
function firstGuide() {
  try {
    if (localStorage.getItem('cb-guide-seen')) return;
    localStorage.setItem('cb-guide-seen', '1');
  } catch { return; }
  if (!room) openGuide($('stage'), DEFAULT_RULES, false);
}
$('settingsClose').innerHTML = icon(UI.close, 18);
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
  $('leaveBtn').innerHTML = `${icon(UI.leave, 16)}<span>${room.solo ? '처음으로' : '방 나가기'}</span>`;
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
  closeConfirm();
  room = null; players = []; playing = false; circles.clear(); pending.clear();
  resetComboNotice();
  closeChipPop();
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
const leaveRoom = () => { socket.emit('room:leave'); store('cb-room', null); resetToHome(); };
$('leaveBtn').onclick = leaveRoom;
/** 게임 중 나가기: 확인 창 뒤 나간다 (여럿이면 봇이 이어받음, 혼자 하기는 게임 끝) */
async function askLeave() {
  const ok = await confirmDialog($('stage'), {
    title: '게임에서 나갈까요?',
    text: room?.solo ? '게임이 끝나요.' : '봇이 이어서 플레이하고, 다시 들어올 수 없어요.',
    ok: '나가기', cancel: '계속하기',
  });
  if (ok && playing) leaveRoom();
}
$('leaveTop').onclick = $('pauseLeaveBtn').onclick = () => { void askLeave(); };
$('leaveTop').innerHTML = `${icon(UI.leave, 16)}<span class="bt">나가기</span>`;
socket.on('player:left', ({ name }) => pushFeed($('feed'), icon(UI.leave, 18), `${name}님이 나갔어요. 봇이 이어받아요.`, '#9ca2d6'));
$('rematchBtn').onclick = () => { initAudio(); socket.emit('game:start', (r) => { $('resultHint').textContent = r.ok ? '' : r.error; }); };
$('toLobbyBtn').onclick = () => { show('lobby'); renderLobby(); };



// ---------- 게임 ----------
function applyPlay(d: PlayPayload, fresh: boolean) {
  closeCodex();
  closeGuide();
  roundOver = false;
  $('roundEnd').hidden = true;
  startAt = d.startAt; endAt = d.endAt; players = d.players; rules = d.rules;
  renderer.laserHalf = toGameRules(rules).laserHalf;
  arcade = d.arcade;
  if (!picking()) { offer = null; effects = []; }
  circles.clear(); pending.clear();
  if (fresh) lastCount = -1;
  // 테마 라운드: 카운트다운 동안 테마 이름을 크게
  if (fresh && d.theme) renderer.text(CX, CY + -120, THEMES[d.theme].name, '#ffd43b', 1.8);
  for (const c of d.circles) circles.set(c.id, c);
  zones = d.zones ?? [];
  pulls.clear();
  for (const pl of d.pulls ?? []) pulls.set(pl.circleId, pl);
  setLasers(d.lasers ?? []);
  mapPattern = d.pattern ?? null;
  popped = new Set(d.popped ?? []);
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
  setPaused(d.pausedBy, d.pauseUntil, d.resumeAt);
}
socket.on('game:start', (d) => { hideTip(); applyPlay(d, true); });
socket.on('game:sync', (d) => applyPlay(d, false));
socket.on('game:pause', ({ by, until }) => setPaused(by, until, 0));
// 일시정지가 풀림: 일시정지 화면을 닫고 at까지 카운트다운 (게임은 그때까지 멈춰 있음)
socket.on('game:resuming', ({ at }) => { resumeAt = at; lastCount = -1; $('pauseOv').hidden = true; });

function setPaused(by: string | null, until = 0, resuming = 0) {
  pauseUntil = by ? until : 0;
  resumeAt = by ? resuming : 0;
  if (by) {
    // 멈춰 있는 동안 레이저 발사음이 나지 않게 (다시 시작하면 game:sync로 다시 예약)
    laserFireTimers.forEach(clearTimeout); laserFireTimers = [];
    if (!pausedView) pausedView = serverNow();
    stopMusic();
    const who = players.find((p) => p.id === by);
    $('pauseWho').textContent = room?.solo ? '' : `${by === myId() ? '내가' : `${who?.name ?? '방장'}님이`} 멈췄어요`;
    // 멀티는 누구나 풀 수 있다
    $<HTMLButtonElement>('resumeBtn').hidden = !room;
    $('pauseOv').hidden = !!resumeAt;
    renderPauseLeft();
  } else {
    pausedView = 0;
    $('pauseOv').hidden = true;
    startMusic(() => { const m = me(); return !!m && isFever(m, serverNow()); });
  }
}
/** 일시정지 화면: 저절로 풀릴 때까지 남은 시간 */
function renderPauseLeft() {
  const sec = pauseUntil ? Math.max(0, Math.ceil((pauseUntil - serverNow()) / 1000)) : 0;
  const el = $('pauseLeft');
  el.hidden = !pauseUntil;
  if (pauseUntil) el.textContent = `${sec}초 뒤 자동으로 다시 시작해요`;
}
function togglePause() {
  if (!playing || picking()) return;
  if (pausedView) { if (!resumeAt) socket.emit('game:resume'); return; }
  if (canPause()) socket.emit('game:pause');
  else if (room && !room.solo) pushFeed($('feed'), icon(UI.pause, 18), '남은 일시정지가 없어요', '#ff5d73');
}
/** 맵 패턴이 나와 있는 동안 위쪽 작은 띠: "가시 공 6" */
function renderPatternTag(now: number) {
  const el = $('patternTag');
  const on = playing && !picking() && patternActive(mapPattern, now);
  el.hidden = !on;
  if (!on) return;
  const txt = `${PATTERNS[mapPattern!.id].name} ${Math.ceil((mapPattern!.until - now) / 1000)}`;
  if (el.textContent !== txt) { el.textContent = txt; el.classList.toggle('danger', PATTERNS[mapPattern!.id].danger); }
}

/** 위쪽 일시정지 버튼: 멀티는 남은 횟수 "2/3", 다 쓰면 흐리게 */
let pauseBtnSig = '';
function renderPauseBtn() {
  const m = me();
  const b = $<HTMLButtonElement>('pauseBtn');
  b.hidden = !(playing && room && m && !picking());
  $('leaveTop').hidden = !(playing && room);
  const multi = !!room && !room.solo;
  const sig = multi && m ? `${m.pausesLeft}` : 'solo';
  if (sig === pauseBtnSig) return;
  pauseBtnSig = sig;
  b.innerHTML = `${icon(UI.pause, 16)}<span class="bt">일시정지${multi && m ? ` ${m.pausesLeft}/${RULES.pause.perGame}` : ''}</span>`;
  b.classList.toggle('used', multi && !!m && m.pausesLeft <= 0);
}
$('pauseBtn').onclick = togglePause;
$('resumeBtn').onclick = () => { initAudio(); socket.emit('game:resume'); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settingsPanel').hidden) return; // Esc는 설정 창 닫기가 먼저
  if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && !isTyping(e)) togglePause();
});
// 혼자 하기: 다른 탭으로 가면 자동으로 멈춤
document.addEventListener('visibilitychange', () => {
  // 다시 시작 카운트다운 중이어도 다시 멈춘다 (서버가 카운트다운을 취소)
  if (document.hidden && playing && room?.solo && (!pausedView || resumeAt)) socket.emit('game:pause');
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
  renderer.text(CX, CY + -150, n > 1 ? `보스 ${n}마리 등장!` : `${BOSS_NAME[c.boss ?? 'normal']} 등장!`, '#ffc23a', 1.8);
});
const nameOf = (id: string | null) => players.find((p) => p.id === id);
const GOLD = '#ffd166';
/** 잭팟 숫자는 배율이 클수록 크게 */
/** 아래쪽 큰 콤보 숫자: 오르면 살짝 커졌다 돌아오고, 끊기면 빨갛게 흔들림. 색은 콤보 크기 등급 */
let shownCombo = 0;
function renderCombo(n: number) {
  if (n === shownCombo) return;
  const el = $('combo'), num = el.querySelector('b')!;
  num.textContent = String(n);
  const tier = n >= 50 ? 5 : n >= 30 ? 4 : n >= 20 ? 3 : n >= 10 ? 2 : 1;
  el.className = `combo c${tier}`;
  const anim = n > shownCombo ? 'bump' : shownCombo > 0 ? 'broke' : '';
  shownCombo = n;
  if (!anim) return;
  void el.offsetWidth; // 같은 애니메이션을 다시 시작
  el.classList.add(anim);
}
/** 헛손질 보정: 빈 곳 클릭 반경 안에 내 일반 원이 있으면 서버가 대신 잡아 준다 (빗나감 표시 안 함) */
function missSaveNear(m: PlayerState, x: number, y: number, now: number) {
  const r = modsOf(m.picks).missSave;
  if (r <= 0) return false;
  for (const c of circles.values()) {
    if (!isMine(c.kind, m.color) || isGuarded(c, now) || pending.has(c.id) || pulls.has(c.id)) continue;
    const q = circlePos(c, now);
    if (Math.hypot(q.x - x, q.y - y) - c.r <= r) return true;
  }
  return false;
}
/** 점수 글자 단계: 잭팟 ×3·보스 막타 5, 잭팟·황금 원 4, 피버 3, 콤보 보너스·반격 2, 평소 1 */
const scoreTier = (o: { jackpot?: number; fever?: boolean; special?: boolean; kill?: boolean; gold?: boolean }): ScoreTier =>
  o.kill || (o.jackpot ?? 1) >= 3 ? 5 : o.gold || (o.jackpot ?? 1) > 1 ? 4 : o.fever ? 3 : o.special ? 2 : 1;
socket.on('boss:hit', ({ circleId, by, hp, gained, jackpot, blocked, enraged, feverStarted, comboBonus }) => {
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
  if (by === myId()) flashCombo($('comboBar'), 'bossHunter');
  renderer.bossPoke(circleId);
  if (by === myId() && c) {
    const p = circlePos(c, serverNow());
    if (jackpot > 1) { renderer.jackpot(p.x, p.y, jackpot, true); sfx.jackpot(jackpot); }
    const mm = me();
    if (gained > 0) renderer.scoreText(p.x + 60, p.y - 70, `+${gained}${comboBonus ? ' 콤보!' : ''}`, scoreTier({ jackpot, fever: !!mm && isFever(mm, serverNow()), special: comboBonus }), 0.7);
  }
  if (by === myId()) bossFeedback(!!feverStarted, !!comboBonus);
});
/** 보스 타격으로 콤보 보너스·피버가 터졌을 때 (원 획득과 같은 표시) */
function bossFeedback(feverStarted: boolean, comboBonus: boolean) {
  const bar = $('comboBar');
  if (comboBonus) flashCombo(bar, 'comboMachine');
  if (feverStarted) { sfx.fever(); renderer.text(CX, CY + -50, 'FEVER!', '#ff9f1c', 2); flashCombo(bar, 'feverMaster'); }
}
/** 마지막으로 보스가 터진 서버 시각 */
let bossKilledAt = 0;
socket.on('boss:killed', ({ circleId, by, gained, mvp, mvpGained, x, y, jackpot, solo, soloFever, feverStarted, comboBonus }) => {
  bossKilledAt = serverNow();
  circles.delete(circleId);
  const killer = nameOf(by), mvpP = nameOf(mvp);
  // 타격감: 멈칫 → 강한 흔들림 → 큰 파편 + 충격파 → 처치한 사람 색 배너
  renderer.hitstop(BOSS_HITSTOP_MS);
  renderer.shakeFor(BOSS_SHAKE.sec, BOSS_SHAKE.amp);
  renderer.burst(x, y, '#ffc23a', true, 2.5); renderer.burst(x, y, '#fff', true, 2);
  renderer.shockwave(x, y, 260);
  if (killer) renderer.banner(by === myId() ? `내가 보스 처치! +${gained}` : `${killer.name} 보스 처치! +${gained}`, COLORS[killer.color].hex);
  sfx.bossKill();
  if (jackpot > 1) { renderer.jackpot(x, y, jackpot, true); if (by === myId()) sfx.jackpot(jackpot); }
  if (killer) renderer.scoreText(x, y, `${by === myId() ? '내' : killer.name} 막타! +${gained}`, 5, 0.8);
  if (mvpP && mvpGained) renderer.text(x, y + 50, `최다 타격 ${mvp === myId() ? '나' : mvpP.name} +${mvpGained}`, '#fff', 0.85);
  // 독식: 체력 절반 이상을 깎은 사람 (막타와 따로, 정확히 절반씩이면 둘)
  solo.forEach((id, i) => {
    const s = nameOf(id);
    if (s) renderer.text(x, y + 95 + i * 45, `${id === myId() ? '내' : s.name} 독식!`, COLORS[s.color].hex, 1.15);
  });
  if (by === myId()) bossFeedback(feverStarted, comboBonus);
  // 막타를 안 친 독식자도 보스 헌터 게이지로 피버가 터졌으면 표시
  else if (soloFever.includes(myId())) bossFeedback(true, false);
});
socket.on('boss:escaped', ({ circleId }) => {
  circles.delete(circleId);
  renderer.text(CX, CY + -150, '보스가 도망갔어요', '#9ca2d6', 1.1);
});
socket.on('click:rejected', ({ circleId }) => pending.delete(circleId));
socket.on('players', (p) => {
  players = p; renderScores(); if (picking()) showPick();
  const m = me();
  const now = combosOf(m?.picks);
  for (const id of now) if (!myCombos.has(id)) {
    const c = COMBOS.find((x) => x.id === id)!;
    if (combosReady) { sfx.legend(); pushFeed($('feed'), icon(UI.up, 18), `조합 완성! ${c.name} · ${c.text}`, '#ffd43b'); }
  }
  myCombos = now;
  combosReady = !!m;
  // 철옹성 조합: 콤보가 끊길 때 0이 아니라 일부만 줄었으면 (라운드 시작의 0은 제외)
  // (오오라처럼 계속 줄어들 때 1.5초에 한 번만)
  if (m && lastCombo !== null && m.combo < lastCombo && m.combo > 0 && now.has('ironWall') && performance.now() - ironNoticeAt > 1500) {
    ironNoticeAt = performance.now();
    sfx.bossBlock(); renderer.text(CX, CY + -120, '철옹성! 콤보 유지', '#ffd43b', 1.1);
    flashCombo($('comboBar'), 'ironWall');
  }
  lastCombo = m ? m.combo : null;
});
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
  else renderer.burst(x, y, COLORS[who.color].hex, mine, isFever(who, serverNow()) ? FEVER_BURST : 1);
  if (result.jackpot > 1) { renderer.jackpot(x, y, result.jackpot, false); if (mine) sfx.jackpot(result.jackpot); }
  if (mine) {
    const label = blasted ? '' : (result.type === 'counter' ? ' 반격' : result.type === 'feverSteal' ? ' 견제' : '') + (result.plundered ? ' 강탈' : '');
    // 점수 글자는 특별한 순간일수록 높은 단계 (0점이면 글자 없음)
    const tier = scoreTier({ jackpot: result.jackpot, fever: isFever(who, serverNow()), special: result.comboBonus || result.type === 'counter' });
    if (result.gained > 0) renderer.scoreText(x, y, `+${result.gained}${label}${result.comboBonus ? ' 콤보!' : ''}`, tier);
    // 소리: 견제는 그대로, 나머지는 점수 단계 소리(콤보가 쌓일수록 높아짐). 잭팟은 잭팟 소리가 따로 난다
    if (!blasted) {
      if (result.type === 'steal' || result.type === 'feverSteal') sfx.steal();
      else if (result.jackpot <= 1) sfx.hit(tier, (me()?.combo ?? 0) + 1);
      if (result.type === 'rainbow') sfx.rainbow();
    }
    if (result.marked) renderer.text(x, y + 45, `${rules.markSec}초간 표적!`, '#ff5d73', 0.9);
    if (result.feverStarted) { sfx.fever(); renderer.text(CX, CY + -50, 'FEVER!', '#ff9f1c', 2); }
    // 조합 발동 반짝임 (그 조합이 없으면 아무 일 없음)
    const bar = $('comboBar');
    if (!blasted && (result.type === 'steal' || result.type === 'feverSteal' || result.type === 'counter')) flashCombo(bar, 'stealKing');
    if (result.comboBonus) flashCombo(bar, 'comboMachine');
    if (result.feverStarted) flashCombo(bar, 'feverMaster');
    if (result.jackpot > 1) flashCombo(bar, 'lucky');
    if (claimedKind === 'y' && !blasted) flashCombo(bar, 'gourmet');
  } else {
    renderer.text(x, y, who.name, COLORS[who.color].hex, 0.75);
  }
  if (result.brokeComboOf === myId()) { sfx.comboBroken(); renderer.text(x, y - 45, '콤보 끊김!', '#ff5d73', 1.1); }
  if (result.shielded && claimedKind === me()?.color) renderer.text(x, y - 45, '방패!', '#4d9bff', 1.1);
  // 방패 레전드: 견제한 사람 점수를 빼앗음
  if (result.drained) {
    if (mine) renderer.text(x, y + 45, `방패 반격 −${result.drained}`, '#ff5d73', 0.9);
    else if (claimedKind === me()?.color) renderer.text(x, y + 45, `방패 반격 +${result.drained}`, '#4d9bff', 0.9);
  }
});
socket.on('special:gain', ({ playerId, id, delta }) => {
  if (playerId !== myId()) return;
  renderer.text(CX, CY + -250, `${ABILITY[id].name} +${delta}`, '#ffd166', 0.9);
});
socket.on('gold:got', ({ circleId, by, gained, x, y, jackpot }) => {
  circles.delete(circleId); pending.delete(circleId);
  const who = nameOf(by);
  renderer.burst(x, y, GOLD, true, 2); renderer.burst(x, y, '#fff', false);
  if (jackpot > 1) { renderer.jackpot(x, y, jackpot, false); if (by === myId()) sfx.jackpot(jackpot); }
  if (by === myId()) { sfx.hit(4); renderer.scoreText(x, y, `+${gained} 황금!`, scoreTier({ gold: true })); }
  else if (who) {
    renderer.text(x, y, `${who.name} 황금`, COLORS[who.color].hex, 0.75);
    pushFeed($('feed'), icon(UI.gold, 18), `${who.name}: 황금 원 +${gained}`, COLORS[who.color].hex);
  }
  popOnChip($('scores'), by, icon(UI.gold, 22));
});
socket.on('item:got', ({ circleId, by, item, tier, x, y }) => {
  circles.delete(circleId); pending.delete(circleId);
  const who = nameOf(by);
  // 방해 아이템: 잡은 사람 뺀 모두에게 걸림 (저격은 stun 알림에서)
  if (ITEMS[item].sabotage && item !== 'snipe' && by !== myId() && who) {
    sfx.sabotage();
    renderer.text(CX, CY + -150, `${who.name}의 ${ITEMS[item].name}!`, '#ff5d73', 1.3);
  }
  if (by === myId()) {
    const sp = renderer.toScreen(x, y);
    showItemPop($('itemPops'), sp.x, sp.y, item, tier, !fxOn());
    sfx.item(tier);
  } else if (who) {
    renderer.text(x, y, `${who.name} ${ITEMS[item].name}`, COLORS[who.color].hex, 0.75);
    pushFeed($('feed'), itemIcon(item, 18), `${who.name}: ${ITEMS[item].name}`, COLORS[who.color].hex);
  }
  popOnChip($('scores'), by, itemIcon(item, 22));
  if (item === 'bomb') { blast = { x, y, R: RULES.items.bombR }; renderer.shockwave(x, y, RULES.items.bombR); sfx.bomb(); }
  if (item === 'fieldClear') { blast = { x: CX, y: CY, R: CORNER }; renderer.flash(); renderer.shockwave(CX, CY, CORNER); sfx.clear(); }
});
socket.on('zone:add', (z) => { zones.push(z); if (z.by === myId()) sfx.zone(); });
// ---------- 게임 커서: 레이저·스턴·자석 끌기 ----------
const gameCursor = new GameCursor();
/** 커서 자석으로 끌려가는 원 */
const pulls = new Map<number, Pull>();
/** 예고·발사 중인 레이저 볼리들 (발사가 끝난 것은 그릴 때 거른다) */
let lasers: LaserVolley[] = [];
let laserFireTimers: number[] = [];
/** 볼리 발사음 예약 */
const scheduleLaserFire = (l: LaserVolley) => {
  if (l.at > serverNow()) laserFireTimers.push(window.setTimeout(() => sfx.laserFire(), l.at - serverNow()));
};
function setLasers(ls: LaserVolley[]) {
  lasers = ls;
  laserFireTimers.forEach(clearTimeout); laserFireTimers = [];
  ls.forEach(scheduleLaserFire);
}
socket.on('laser:warn', (l) => {
  lasers = lasers.filter((x) => serverNow() < x.at + RULES.laser.fireMs);
  lasers.push(l); scheduleLaserFire(l); sfx.laserWarn();
});
// 맵 패턴: 경고와 함께 현수막·경고음, 나타나면 그림 (끝나는 시각이 지나면 그리지 않음)
socket.on('map:warn', (p) => {
  mapPattern = p; popped = new Set();
  showPatternBanner($('stage'), p.id, p.at - serverNow(), !fxOn());
  sfx.patternWarn();
});
socket.on('map:pop', ({ index, by }) => {
  popped.add(index);
  const p = mapPattern;
  if (!p?.balls?.[index]) return;
  const q = moverAt(p.balls[index], p.at, serverNow(), RULES.patterns.spikes.r);
  renderer.burst(q.x, q.y, '#ff5d73', by === myId());
});
socket.on('stun', ({ playerId, by }) => {
  const p = nameOf(playerId);
  const snipe = by === 'snipe';
  if (playerId === myId()) {
    if (snipe) { sfx.snipe(); renderer.snipe(); renderer.text(CX, CY + -70, '저격당했다!', '#ff5d73', 1.6); }
    else sfx.stun();
    const c = gameCursor.pos ?? { x: CX, y: CY };
    renderer.text(c.x, c.y - 40, '스턴!', '#9ca2d6', 1.2);
  } else if (p) {
    if (snipe) sfx.snipe();
    renderer.text(CX, CY + -330, snipe ? `${p.name} 저격!` : `${p.name} 스턴!`, COLORS[p.color].hex, snipe ? 1.1 : 0.8);
  }
});
socket.on('aura:hit', ({ by, x, y }) => {
  if (by !== myId()) return;
  sfx.aura();
  renderer.text(x, y, `오오라 · 피버 −${RULES.aura.feverLoss} · 콤보 −${100 - RULES.aura.comboKeepPct}%`, '#c39bff', 0.9);
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
  // 예고 중인 레이저도 서버처럼 늦춘다 (발사음도 다시 예약)
  holdLasers(lasers, at, ms);
  setLasers(lasers);
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
  $('srcBox').innerHTML = r.sources;
  if (room) room.wins = d.wins;
  (pos === 1 ? sfx.win : sfx.lose)();
  const again = isHost();
  $<HTMLButtonElement>('rematchBtn').hidden = !again;
  $('toLobbyBtn').textContent = room?.solo ? '규칙 바꾸기' : '대기실로';
  $('resultHint').textContent = again ? '' : '방장이 한 판 더를 누르면 바로 시작해요';
  closeChipPop();
  show('result');
});

// 게임 커서: 진짜 마우스 위치에서 정한다 (반대는 거울 위치, 감도 감소는 늦게 따라옴)
/** 지금 커서 효과: 감도 감소·반대, 오오라 안이면 끌려간 만큼 유지되도록 상대 이동 */
let cursorMode: CursorMode | null = null;
const moveCursor = (e: PointerEvent) => {
  const real = renderer.toField(e.clientX, e.clientY);
  const prev = renderer.toField(e.clientX - e.movementX, e.clientY - e.movementY);
  gameCursor.move(real, { x: real.x - prev.x, y: real.y - prev.y });
};
/** 이 점을 덮는 이동형 보스 오오라 */
const auraUnder = (pt: { x: number; y: number }, t: number) => {
  for (const c of circles.values()) { const a = auraAt(c, t); if (a && inAura(pt, a)) return a; }
  return null;
};
let lastFrameAt = performance.now();
// 캔버스 밖으로 나가도 계속 받는다: 게임 커서는 사라지지 않고 가장자리에 붙어 있다 (창 밖이면 마지막 위치)
window.addEventListener('pointermove', moveCursor);
$('cv').addEventListener('pointerdown', (e) => {
  // 고정한 빌드 카드가 열려 있으면 이 클릭은 닫기만 한다 (빈 곳 감점이 되지 않게)
  if (popPinned) { closeChipPop(); return; }
  if (!playing || pausedView || picking() || roundOver) return;
  ensureMusic();
  const now = serverNow();
  if (now < startAt) return;
  // 클릭은 게임 커서 위치로 판정한다 (터치는 누른 자리로 커서를 옮긴 뒤)
  moveCursor(e);
  gameCursor.snap(cursorMode);
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
    const saved = !!m && (rangeTargets(circles.values(), m.color, x, y, now, reach, pending, RULES.lagWindowMs).length > 0 || missSaveNear(m, x, y, now));
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
  $('scores').innerHTML = players.map((p) => `<div class="chip${p.id === myId() ? ' me' : ''}${p.connected ? '' : ' off'}${p.id === popFor ? ' open' : ''}" data-id="${p.id}">${shapeSVG(p.color, 26)}<div class="meta"><span class="nm">${esc(p.name)}${p.id === myId() ? ' (나)' : ''}${room?.wins[p.id] ? ` · ${room.wins[p.id]}승` : ''}</span><span class="sc">${p.score}</span></div><span class="cb">${p.combo ? p.combo + '콤보' : ''}</span>${pickChips(p.picks ?? [])}${buffChips(p, serverNow())}</div>`).join('');
  renderChipPop();
}

// 점수판 칩 빌드 카드: 마우스를 올리면 보이고, 누르면 고정 (다시 누르거나 바깥을 누르면 닫힘). 점수판을 다시 그려도 열린 채로
function renderChipPop() {
  const p = popFor ? players.find((x) => x.id === popFor) : undefined;
  const chip = p ? $('scores').querySelector<HTMLElement>(`.chip[data-id="${p.id}"]`) : null;
  if (!p || !chip) { closeChipPop(); return; }
  // 내용이 같으면 다시 그리지 않는다 (타일에 마우스를 올려 보는 설명이 1초마다 꺼지지 않게)
  const html = buildCard(p, rankOf(p, players), myId());
  if (chipPop.dataset.html !== html) { chipPop.innerHTML = html; chipPop.dataset.html = html; }
  chipPop.hidden = false;
  const r = chip.getBoundingClientRect();
  chipPop.style.left = `${Math.max(8, Math.min(innerWidth - chipPop.offsetWidth - 8, r.left))}px`;
  chipPop.style.top = `${r.bottom + 6}px`;
}
function closeChipPop() {
  const had = popFor !== null;
  popFor = null; popPinned = false; chipPop.hidden = true;
  if (had) $('scores').querySelector('.chip.open')?.classList.remove('open');
}
$('scores').addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
  if (!chip) return;
  e.stopPropagation();
  if (popPinned && popFor === chip.dataset.id) { closeChipPop(); return; }
  popFor = chip.dataset.id!; popPinned = true;
  renderScores();
});
$('scores').addEventListener('pointerover', (e) => {
  if (popPinned) return;
  const id = (e.target as HTMLElement).closest<HTMLElement>('.chip')?.dataset.id;
  if (id && id !== popFor) { popFor = id; renderScores(); }
});
$('scores').addEventListener('pointerleave', () => { if (!popPinned && popFor) { closeChipPop(); } });
document.addEventListener('click', (e) => { if (popPinned && !chipPop.contains(e.target as Node)) closeChipPop(); });

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
  renderCombo(m?.combo ?? 0);
  const cbMult = m?.comeback && isLast(m, players) ? ARCADE.comeback.roomMult[players.length] ?? 0 : 0;
  renderBuffBar($('buffs'), playing && !picking() ? m : undefined, now, (id) => RULES.items.ms[id], (id) => (id === 'slow' ? RULES.sabotage.slowMs : id === 'invert' ? RULES.sabotage.invertMs : RULES.sabotage.blindMs), cbMult);
  // 점수판의 버프 아이콘은 1초마다 다시 그려 끝난 것을 지운다
  const sec = Math.floor(now / 1000);
  if (playing && sec !== lastBuffSec) { lastBuffSec = sec; renderScores(); }
  $('stage').classList.toggle('feverOn', playing && !picking() && fever);
  document.querySelectorAll<HTMLElement>('.chip').forEach((el) => {
    const p = players.find((x) => x.id === el.dataset.id);
    const live = playing && !picking() && !!p;
    el.classList.toggle('marked', live && isMarked(p!, now));
    el.classList.toggle('stunned', live && isStunned(p!, now));
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

  // 시작 카운트다운, 일시정지가 풀린 뒤 다시 시작 카운트다운
  const cd = resumeAt ? Math.ceil((resumeAt - serverNow()) / 1000) : Math.ceil((startAt - now) / 1000);
  const showCd = playing && !picking() && cd > 0;
  if (pausedView && pauseUntil && !resumeAt) renderPauseLeft();
  $('countdown').hidden = !showCd;
  if (showCd && cd !== lastCount) { $('countdown').textContent = String(cd); sfx.tick(); lastCount = cd; }
}

function frame() {
  const now = viewNow();
  renderPauseBtn();
  renderPatternTag(now);
  renderComboBar($('comboBar'), playing && !picking() && !roundOver ? me() : undefined);
  // 위쪽 도감 버튼: 게임이 실제로 진행 중일 때만 숨김 (증강 선택·일시정지·대기실에서는 열 수 있음)
  $('codexTop').hidden = playing && !picking() && !pausedView && !roundOver;
  // 게임 중에는 진짜 마우스 커서를 숨기고 게임 커서를 그린다
  $('stage').classList.toggle('gamecursor', playing && !picking() && !roundOver && !pausedView);
  // 자석에 끌려오는 원은 화면 밖으로 나가도 잡힐 때까지 그린다
  for (const [id, c] of circles) if (isOut(c, now) && !pulls.has(id)) { circles.delete(id); pending.delete(id); }
  const m = me();
  // 커서 효과: 방해 디버프, 오오라 끌림 (효과가 끝나면 진짜 마우스 위치로 미끄러져 돌아옴)
  const fnow = performance.now(), dt = Math.min(0.05, (fnow - lastFrameAt) / 1000);
  lastFrameAt = fnow;
  const live = playing && !picking() && !roundOver && !pausedView;
  const aura = live && gameCursor.pos ? auraUnder(gameCursor.pos, now) : null;
  cursorMode = live && m ? cursorModeOf(m, now) ?? (aura ? {} : null) : null;
  const fx = live && mapPattern ? { pattern: mapPattern, t: now } : null;
  const wasTrapped = gameCursor.trapped;
  gameCursor.frame(cursorMode, dt * 1000, !!aura, fx);
  // 소용돌이에 갇힘: 글자·소리
  if (wasTrapped < 0 && gameCursor.trapped >= 0 && gameCursor.pos) { sfx.aura(); renderer.text(gameCursor.pos.x, gameCursor.pos.y - 40, '갇힘!', '#d4bcff', 1.1); }
  // 두 번째 소용돌이 미리보기가 시작되면 작은 경고음
  const vw = live && mapPattern ? vortexWarned(mapPattern, now).includes(1) : false;
  if (vw && !vortexWarnHeard) sfx.laserWarn();
  vortexWarnHeard = vw;
  if (aura) gameCursor.pull(aura, RULES.aura.pullSpeed * dt);
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
    cursor: gameCursor.pos && playing && !picking() && !roundOver && !pausedView
      ? { ...gameCursor.pos, stunned: !!m && isStunned(m, now), reach: m ? reachOf(m, now) : 0, magnet: m ? magnetOf(m, now, gameCursor.pos) : 0 }
      : null,
    lasers: lasers.filter((l) => now < l.at + RULES.laser.fireMs),
    blind: live && m?.blind && (m.debuffs.blind ?? 0) > now ? { ...m.blind, until: m.debuffs.blind! } : null,
    myAura: !!aura,
    pattern: mapPattern,
    popped,
    trapped: gameCursor.trapped,
    pulls: new Map([...pulls].map(([id, pl]) => [id, { from: pl.from, to: pl.by === myId() ? gameCursor.pos : null, at: pl.at, ms: pl.ms }])),
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
show('home');
// 저장된 방으로 다시 들어가는 중이 아니면 첫 접속 안내
if (!store('cb-room')) firstGuide();
$('ver').textContent = `v${__APP_VERSION__}`;
// 1.0.0-beta.1 → BETA, 1.0.0-rc.1 → RC
const pre = __APP_VERSION__.split('-')[1]?.split('.')[0];
if (pre) { $('stageBadge').textContent = pre.toUpperCase(); $('stageBadge').hidden = false; }
