/** 확인 창: 제목·본문과 두 버튼. [확인]이면 true, [취소]·Esc·바깥 클릭이면 false (도감과 같은 창 모양) */
let closeCurrent: ((ok: boolean) => void) | null = null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function confirmDialog(host: HTMLElement, o: { title: string; text: string; ok: string; cancel: string }): Promise<boolean> {
  closeCurrent?.(false);
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'overlay confirm';
    el.innerHTML = `<div class="card center" role="alertdialog" aria-modal="true" aria-label="${esc(o.title)}">
      <h1>${esc(o.title)}</h1>
      <p>${esc(o.text)}</p>
      <div class="btnrow">
        <button class="btn ghost danger" type="button" data-ok>${esc(o.ok)}</button>
        <button class="btn" type="button" data-cancel>${esc(o.cancel)}</button>
      </div>
    </div>`;
    host.appendChild(el);
    const close = (ok: boolean) => {
      el.remove();
      window.removeEventListener('keydown', onKey, true);
      if (closeCurrent === close) closeCurrent = null;
      resolve(ok);
    };
    closeCurrent = close;
    // Esc는 일시정지 단축키보다 먼저 받아서 창만 닫는다
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(false); } };
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-ok]')) close(true);
      else if (t === el || t.closest('[data-cancel]')) close(false);
    });
    el.querySelector<HTMLButtonElement>('[data-cancel]')!.focus();
  });
}

/** 열려 있는 확인 창을 닫는다 (취소로) */
export function closeConfirm() { closeCurrent?.(false); }
