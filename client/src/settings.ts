/** 내 화면에만 적용되는 설정: 음량, 효과 줄이기, 핑 표시. 브라우저에 저장된다 */
import { setVolume } from './audio.ts';
import { setReduceFx } from './render.ts';

export interface Settings {
  music: number;
  sfx: number;
  muted: boolean;
  reduceFx: boolean;
  showPing: boolean;
}

const KEY = 'cb-settings';

/** 글자를 입력하는 중이면 단축키를 무시한다 (체크박스·슬라이더는 해당 없음) */
export function isTyping(e: KeyboardEvent) {
  const t = e.target;
  return (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'search')) || t instanceof HTMLTextAreaElement;
}
const DEFAULTS: Settings = { music: 0.6, sfx: 0.8, muted: false, reduceFx: false, showPing: false };

export const settings: Settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
})();

const listeners: (() => void)[] = [];
export const onSettingsChange = (fn: () => void) => listeners.push(fn);

export function update(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  apply();
}

function apply() {
  setVolume({ music: settings.music, sfx: settings.sfx, muted: settings.muted });
  setReduceFx(settings.reduceFx);
  listeners.forEach((f) => f());
}

/** 설정 패널 연결. 열고 닫기, 각 입력, M 키 음소거 */
export function initSettingsPanel() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $('settingsPanel');
  const music = $<HTMLInputElement>('setMusic'), sfx = $<HTMLInputElement>('setSfx');
  const mute = $<HTMLInputElement>('setMute'), fx = $<HTMLInputElement>('setFx'), ping = $<HTMLInputElement>('setPing');

  const sync = () => {
    music.value = String(Math.round(settings.music * 100));
    sfx.value = String(Math.round(settings.sfx * 100));
    mute.checked = settings.muted; fx.checked = settings.reduceFx; ping.checked = settings.showPing;
    $('setMusicVal').textContent = `${music.value}%`;
    $('setSfxVal').textContent = `${sfx.value}%`;
    $('settingsBtn').textContent = settings.muted ? '설정 · 음소거' : '설정';
  };
  onSettingsChange(sync);

  $('settingsBtn').onclick = () => { panel.hidden = !panel.hidden; };
  $('settingsClose').onclick = () => { panel.hidden = true; };
  music.oninput = () => update({ music: Number(music.value) / 100 });
  sfx.oninput = () => update({ sfx: Number(sfx.value) / 100 });
  mute.onchange = () => update({ muted: mute.checked });
  fx.onchange = () => update({ reduceFx: fx.checked });
  ping.onchange = () => update({ showPing: ping.checked });

  const fsBtn = $<HTMLButtonElement>('setFullscreen');
  const fsLabel = () => { fsBtn.textContent = document.fullscreenElement ? '전체 화면 끄기' : '전체 화면'; };
  fsBtn.hidden = !document.fullscreenEnabled;
  fsBtn.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* 지원하지 않는 환경 */ }
  };
  document.addEventListener('fullscreenchange', fsLabel);
  fsLabel();

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !isTyping(e)) update({ muted: !settings.muted });
    if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
  });
  apply();
}
