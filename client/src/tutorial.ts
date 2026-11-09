/** 튜토리얼 화면: 게임 화면 위쪽 안내 띠, 연습 완료 창. 숫자는 서버(tutorial:step) 값 그대로 */
import type { TutorialStatus, TutorialStep } from '@color-burst/shared';

export const TUTORIAL_TEXT: Record<TutorialStep, { name: string; hint: string }> = {
  own: { name: '원 잡기', hint: '내 색 원을 눌러 잡으세요' },
  combo: { name: '콤보', hint: '놓치지 말고 연달아 잡으면 콤보가 올라요' },
  fever: { name: '피버', hint: '노란 원도 게이지를 채워요. 게이지가 차면 피버!' },
  steal: { name: '견제', hint: '다른 색 원을 잡으면 그 사람 콤보를 끊어요 (대신 잠깐 표적이 돼요)' },
};

let band: HTMLElement | null = null;
let done: HTMLElement | null = null;
let cur: TutorialStatus | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

function flash(text: string, ms: number) {
  const f = band?.querySelector<HTMLElement>('.tut-flash');
  if (!f) return;
  f.textContent = text;
  f.hidden = false;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { f.hidden = true; }, ms);
}

/** 단계 안내 띠를 그린다. 진행 수가 목표에 닿으면 "잘했어요!"를 1초 */
export function showTutorialStep(d: TutorialStatus, onSkip: () => void): void {
  if (!band) {
    band = document.createElement('div');
    band.className = 'tut-band';
    band.innerHTML = `<span class="tut-step"></span><span class="tut-hint"></span><b class="tut-count"></b>
      <span class="tut-flash" hidden></span><button class="btn ghost small tut-skip" type="button">건너뛰기</button>`;
    document.getElementById('stage')!.appendChild(band);
  }
  band.querySelector<HTMLButtonElement>('.tut-skip')!.onclick = onSkip;
  const t = TUTORIAL_TEXT[d.step];
  band.querySelector('.tut-step')!.textContent = `${d.index + 1}/${d.total} ${t.name}`;
  band.querySelector('.tut-hint')!.textContent = t.hint;
  band.querySelector('.tut-count')!.textContent = `${d.count}/${d.goal}`;
  const reached = d.count >= d.goal && !(cur && cur.index === d.index && cur.count >= cur.goal);
  cur = d;
  if (reached) flash('잘했어요!', 1000);
}

/** 콤보 단계에서 콤보가 끊기면 잠깐 안내 */
export function noteTutorialCombo(before: number, after: number): void {
  if (cur?.step === 'combo' && cur.count < cur.goal && before > 0 && after === 0) flash('다시 이어 보세요', 1200);
}

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
  document.getElementById('stage')!.appendChild(done);
}

export function hideTutorial(): void {
  band?.remove(); band = null;
  done?.remove(); done = null;
  cur = null;
  if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
}
