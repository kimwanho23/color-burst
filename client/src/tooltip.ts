/**
 * 설명 카드: data-tip 속성(카드 HTML)이 있는 요소에 마우스를 올리면 바로 뜬다. 터치는 누르면 뜨고 다른 곳을 누르면 닫힌다.
 * 화면을 다시 그려도 마우스 아래에 data-tip 요소가 있으면 그 내용으로 이어서 보여 준다 (점수판처럼 1초마다 다시 그리는 곳).
 */
const GAP = 8;
let tipEl: HTMLDivElement | null = null;
let anchor: HTMLElement | null = null;
let last = { x: -1, y: -1 };

function el() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tipcard';
    tipEl.hidden = true;
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function show(target: HTMLElement) {
  const t = el();
  const html = target.dataset.tip ?? '';
  if (t.dataset.html !== html) { t.innerHTML = html; t.dataset.html = html; }
  t.hidden = false;
  anchor = target;
  // 아래에 자리가 있으면 아래, 없으면 위. 가로는 화면 안으로
  const r = target.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight;
  const left = Math.max(GAP, Math.min(innerWidth - w - GAP, r.left + r.width / 2 - w / 2));
  const below = r.bottom + GAP + h <= innerHeight;
  t.style.left = `${left}px`;
  t.style.top = `${below ? r.bottom + GAP : Math.max(GAP, r.top - GAP - h)}px`;
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
  anchor = null;
}

const tipAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-tip]') ?? null;

/** 한 번만 부른다: 문서 전체에서 data-tip 요소를 지켜본다 */
export function initTips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    last = { x: e.clientX, y: e.clientY };
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (t) show(t); else hideTip();
  });
  document.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') last = { x: e.clientX, y: e.clientY }; }, { passive: true });
  // 터치: 누르면 그 요소의 카드, 같은 요소를 다시 누르거나 다른 곳을 누르면 닫힘
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') { hideTip(); return; }
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (t && t !== anchor) show(t); else hideTip();
  });
  document.addEventListener('scroll', hideTip, true);
  // 다시 그려져 원래 요소가 사라지면 마우스 아래의 새 요소로 이어 가거나 닫는다
  window.setInterval(() => {
    if (!anchor || anchor.isConnected) return;
    const t = last.x >= 0 ? tipAt(last.x, last.y) : null;
    if (t) show(t); else hideTip();
  }, 200);
}
