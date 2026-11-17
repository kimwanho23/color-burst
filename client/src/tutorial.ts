/**
 * 튜토리얼 화면: 위쪽 안내 띠, 짚기 표시(판을 어둡게 덮고 짚은 원만 밝게) + 말풍선, 설명 카드, 연습 완료 창.
 * 장면 진행은 서버(tutorial:beat)가 정하고, 화면은 장면 id로 문구를 찾는다. 문구에는 점수·배율 숫자를 쓰지 않는다
 */
import { circlePos, type Circle, type TutorialBeatInfo, type TutorialStatus, type TutorialStep } from '@color-burst/shared';

export const TUTORIAL_TEXT: Record<TutorialStep, { name: string }> = {
  own: { name: '원 잡기' },
  combo: { name: '콤보' },
  steal: { name: '견제' },
  fever: { name: '피버' },
  zones: { name: '점수 구역' },
};

/** 장면 id → 문구. combo.tenCard의 {base}·{bonus}는 그 판에서 실제로 받은 점수로 채운다 */
export const BEAT_TEXT: Record<string, string> = {
  'own.mine': '이게 내 색 원이에요. 눌러 보세요',
  'own.mineCard': '내 색 원은 나만 잡을 수 있어요. 잡으면 점수가 오르고 피버 게이지가 차요',
  'own.yellow': '노란 원은 누구나 잡을 수 있어요. 눌러 보세요',
  'own.yellowCard': '노란 원은 내 색보다 점수가 조금 적지만, 먼저 잡는 사람이 가져가요. 피버 게이지도 채워요',
  'combo.intro': '쉬지 않고 연달아 잡으면 콤보가 올라요. 지금 콤보는 9예요',
  'combo.ten': '하나 더 잡아 콤보 10을 만들어 보세요',
  'combo.tenCard': '콤보 10! 원 점수 {base}에 콤보 보너스 {bonus}가 더 붙었어요. 콤보가 10씩 쌓일 때마다 보너스 점수가 붙어요',
  'combo.empty': '이번엔 빈 곳을 눌러 보세요',
  'combo.emptyCard': '빈 곳을 누르면 콤보가 끊겨요. 실제 게임에서는 피버 게이지도 줄어요',
  'steal.intro': '다른 색 원은 다른 사람 원이에요. 잡으면 견제가 돼요',
  'steal.do': '봇 원을 잡아 견제해 보세요',
  'steal.doCard': '봇 콤보가 끊겼어요! 대신 내 콤보도 끊기고 피버 게이지가 줄어요. 잠깐 내가 표적이 돼요',
  'steal.wait': '표적이 풀릴 때까지 내 원을 잡아 보세요',
  'steal.botCard': '봇이 내 원을 가져가 내 콤보를 끊었어요. 이제 봇이 표적이에요',
  'steal.counter': '표적이 된 사람의 원을 잡으면 반격! 점수를 더 받아요',
  'steal.sumCard': '견제하면 표적이 되고, 표적은 반격당해요',
  'fever.intro': '원을 잡으면 피버 게이지가 차요. 가득 차면 피버!',
  'fever.go': '원 하나만 더 잡으면 피버예요. 눌러 보세요',
  'fever.onCard': '피버 중에는 점수가 크게 늘어나요. 노란 원도 내 색이 되고, 남의 색 원을 잡아도 페널티가 없어요',
  'fever.play': '피버가 끝날 때까지 원을 잡아 보세요',
  'zones.intro': '판은 가운데 · 사이 · 가장자리로 나뉘어요. 바깥쪽에서 잡을수록 점수가 커져요',
  'zones.edge': '가장자리에서 잡아 보세요',
  'zones.play': '사이나 가장자리에서 원을 잡아 보세요',
};

/**
 * 튜토리얼 중 판 클릭 처리: 'send' 서버로 보냄, 'hint' 아무 효과 없이 짚은 곳만 다시 깜빡임, 'pass' 평소 처리.
 * hitId: 클릭한 자리의 원 (없으면 null)
 */
export function holdAccepts(d: TutorialBeatInfo | null, hitId: number | null): 'send' | 'hint' | 'pass' {
  if (!d || d.kind === 'free') return 'pass';
  if (d.kind === 'card') return 'hint';
  if (d.accept === 'empty') return hitId === null ? 'send' : 'hint';
  return hitId !== null && hitId === d.circleId ? 'send' : 'hint';
}

/** 점수 구역 그림 (숫자 없이 세 겹 고리) */
const ZONES_SVG = `<svg viewBox="0 0 160 160" width="160" height="160" aria-hidden="true">
  <circle cx="80" cy="80" r="76" fill="none" stroke="currentColor" stroke-opacity=".9" stroke-width="3"/>
  <circle cx="80" cy="80" r="52" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width="3"/>
  <circle cx="80" cy="80" r="28" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="3"/>
  <text x="80" y="84" text-anchor="middle" font-size="12" fill="currentColor">가운데</text>
  <text x="80" y="44" text-anchor="middle" font-size="12" fill="currentColor">사이</text>
  <text x="80" y="20" text-anchor="middle" font-size="12" fill="currentColor">가장자리</text>
</svg>`;

export interface BeatHost {
  /** 설명 카드 넘기기 (tutorial:next) */
  onNext: () => void;
  /** 필드 좌표 → #stage 화면 좌표, 필드 1단위의 화면 크기 */
  toScreen: (x: number, y: number) => { x: number; y: number };
  scale: () => number;
  circle: (id: number) => Circle | undefined;
}

let band: HTMLElement | null = null;
let done: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let beat: TutorialBeatInfo | null = null;
let host: BeatHost | null = null;
let sentNext = false;

const stage = () => document.getElementById('stage')!;

/** 단계 안내 띠: "2/5 콤보", 자유 연습이면 문구와 진행 수, [건너뛰기] */
export function showTutorialStep(d: TutorialStatus, onSkip: () => void): void {
  if (!band) {
    band = document.createElement('div');
    band.className = 'tut-band';
    band.innerHTML = `<span class="tut-step"></span><span class="tut-hint"></span><b class="tut-count"></b>
      <button class="btn ghost small tut-skip" type="button">건너뛰기</button>`;
    stage().appendChild(band);
  }
  band.querySelector<HTMLButtonElement>('.tut-skip')!.onclick = onSkip;
  band.querySelector('.tut-step')!.textContent = `${d.index + 1}/${d.total} ${TUTORIAL_TEXT[d.step].name}`;
  renderBand();
}

function renderBand() {
  if (!band) return;
  const free = beat?.kind === 'free';
  band.querySelector('.tut-hint')!.textContent = free && beat ? BEAT_TEXT[beat.beat] ?? '' : '';
  band.querySelector('.tut-count')!.textContent = free && beat?.goal ? `${beat.count ?? 0}/${beat.goal}` : '';
}

/** 지금 장면 (멈춤 중 클릭 판단용) */
export const currentBeat = () => beat;

/** 장면을 그린다: 짚기 표시·말풍선, 설명 카드, 자유 연습이면 띠 문구만 */
export function showBeat(d: TutorialBeatInfo, h: BeatHost): void {
  const same = beat?.beat === d.beat && beat.step === d.step;
  beat = d; host = h;
  if (!same) sentNext = false;
  renderBand();
  document.body.dataset.tutPoint = d.kind === 'card' && d.point ? d.point : '';
  clearLayer();
  if (d.kind === 'free') return;
  layer = document.createElement('div');
  layer.className = 'tut-layer';
  if (d.kind === 'card') {
    layer.classList.add('dim');
    const card = document.createElement('div');
    card.className = 'tut-card tut-explain';
    card.setAttribute('role', 'dialog');
    const text = (BEAT_TEXT[d.beat] ?? '').replace('{base}', String(d.gain?.base ?? 0)).replace('{bonus}', String(d.gain?.bonus ?? 0));
    card.innerHTML = `${d.point === 'zones' ? `<div class="tut-art">${ZONES_SVG}</div>` : ''}<p>${text}</p>
      <button class="btn tut-next" type="button">계속</button>`;
    card.onclick = next;
    layer.appendChild(card);
  } else if (d.accept === 'empty') {
    layer.classList.add('dim');
    layer.appendChild(bubble(BEAT_TEXT[d.beat] ?? '', null));
  } else if (d.at !== undefined && d.circleId !== undefined) {
    // 멈췄을 때만 짚는다 (멈추기 전에는 원이 날아오는 중)
    const c = h.circle(d.circleId);
    if (c) {
      const p = circlePos(c, d.at), q = h.toScreen(p.x, p.y), r = (c.r + 10) * h.scale();
      const spot = document.createElement('div');
      spot.className = 'tut-spot';
      Object.assign(spot.style, { left: `${q.x - r}px`, top: `${q.y - r}px`, width: `${r * 2}px`, height: `${r * 2}px` });
      layer.appendChild(spot);
      layer.appendChild(bubble(BEAT_TEXT[d.beat] ?? '', { x: q.x, y: q.y + r + 12 }));
    }
  }
  stage().appendChild(layer);
}

function bubble(text: string, at: { x: number; y: number } | null) {
  const b = document.createElement('div');
  b.className = 'tut-bubble';
  b.textContent = text;
  if (at) Object.assign(b.style, { left: `${at.x}px`, top: `${at.y}px` });
  else b.classList.add('center');
  return b;
}

function next() {
  if (sentNext || beat?.kind !== 'card') return;
  sentNext = true;
  host?.onNext();
}

/** 잘못 누름: 효과 없이 짚은 곳만 한 번 깜빡인다 */
export function hintBeat(): void {
  const el = layer?.querySelector<HTMLElement>('.tut-spot, .tut-bubble, .tut-explain');
  if (!el) return;
  el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge');
}

/** 설명 카드: Enter·Space로 넘기기 (처리했으면 true) */
export function tutorialKey(e: KeyboardEvent): boolean {
  if (beat?.kind !== 'card' || (e.key !== 'Enter' && e.key !== ' ')) return false;
  e.preventDefault();
  next();
  return true;
}

/** 창 크기가 바뀌면 짚기 표시 위치를 다시 잡는다 */
if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (beat && host && beat.kind === 'focus') showBeat(beat, host); });

function clearLayer() { layer?.remove(); layer = null; }

/** 연습 완료 창 */
export function showTutorialDone(onSolo: () => void, onHome: () => void): void {
  hideTutorial();
  done = document.createElement('div');
  done.className = 'tut-done';
  done.setAttribute('role', 'dialog');
  done.innerHTML = `<div class="tut-card"><b>연습 완료!</b><p>이제 실제 게임을 해 보세요</p>
    <div class="row"><button class="btn grow" type="button" data-solo>혼자 하기 시작</button>
    <button class="btn ghost grow" type="button" data-home>처음으로</button></div></div>`;
  done.querySelector<HTMLButtonElement>('[data-solo]')!.onclick = () => { hideTutorial(); onSolo(); };
  done.querySelector<HTMLButtonElement>('[data-home]')!.onclick = () => { hideTutorial(); onHome(); };
  stage().appendChild(done);
}

export function hideTutorial(): void {
  band?.remove(); band = null;
  done?.remove(); done = null;
  clearLayer();
  beat = null; host = null; sentNext = false;
  delete document.body.dataset.tutPoint;
}
