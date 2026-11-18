/**
 * 대기실 그리기에 쓰는 순수 함수 (DOM 없음): 자리 4칸, 규칙 요약, 방 링크.
 * main.ts가 이 결과로 대기실을 그린다
 */
import { ARCADE, MAX_PLAYERS, PRESETS, RULES, matchPreset, type CoopLevel, type PlayerState, type RoomRules } from '@color-burst/shared';

export type Slot =
  | { kind: 'human'; p: PlayerState; me: boolean; isHost: boolean }
  | { kind: 'bot'; p: PlayerState; canEdit: boolean }
  | { kind: 'empty'; team?: 0 | 1; canAdd: boolean; canJoin: boolean };

/** 늘 4칸. 팀전이면 [팀0, 팀0, 팀1, 팀1] (팀 안에서는 들어온 순서, 빈 칸은 뒤) */
export function lobbySlots(players: readonly PlayerState[], hostId: string, myId: string, team: boolean): Slot[] {
  const host = hostId === myId;
  const slot = (p: PlayerState): Slot => p.bot
    ? { kind: 'bot', p, canEdit: host }
    : { kind: 'human', p, me: p.id === myId, isHost: p.id === hostId };
  if (!team) {
    const filled = players.slice(0, MAX_PLAYERS).map(slot);
    while (filled.length < MAX_PLAYERS) filled.push({ kind: 'empty', canAdd: host, canJoin: false });
    return filled;
  }
  const myTeam = players.find((p) => p.id === myId)?.team;
  return ([0, 1] as const).flatMap((t) => {
    const ms = players.filter((p) => p.team === t).slice(0, RULES.team.size).map(slot);
    while (ms.length < RULES.team.size) ms.push({ kind: 'empty', team: t, canAdd: host, canJoin: myTeam !== undefined && myTeam !== t });
    return ms;
  });
}

const COOP_NAME: Record<CoopLevel, string> = { easy: '이지', normal: '노말', hard: '하드', expert: '엑스퍼트' };

/** 규칙 요약 두 줄: 인원 모드 · 클래식/아케이드 · 프리셋, 그리고 시간·피버·켜진 요소 */
export function rulesSummary(r: RoomRules): { title: string; detail: string } {
  const who = r.coop ? `협력전 · ${COOP_NAME[r.coopLevel]}` : r.team ? '팀전 2:2' : r.survival ? '서바이벌' : '개인전';
  const preset = matchPreset(r);
  // 협력전은 클래식·아케이드·프리셋 구분이 없다
  const title = r.coop ? who : `${who} · ${r.mode === 'arcade' ? '아케이드' : '클래식'} · ${preset ? PRESETS[preset].name : '커스텀'}`;
  // 판 길이: 아케이드는 라운드, 클래식 서바이벌은 인원에 따라 길어지므로 탈락 간격, 협력전은 고정 시간
  const time = r.mode === 'arcade' ? `${ARCADE.rounds}라운드 · 라운드 ${r.arcadeRoundSec}초`
    : r.coop ? `${RULES.coop.timeSec}초`
    : r.survival ? `${RULES.survival.everyMs / 1000}초마다 꼴찌 탈락` : `${r.roundSec}초`;
  // 협력전은 일반 보스·레이저·맵 패턴을 끈다 (toGameRules)
  if (r.coop) return { title, detail: time };
  const on = [r.boss && '보스', r.items && '아이템', r.laser && '레이저', r.mapPct > 0 && '맵 패턴'].filter(Boolean);
  return { title, detail: [time, `피버 ×${r.feverMult} ${r.feverSec}초`, ...on].join(' · ') };
}

export type RuleChipIcon = 'coop' | 'timer' | 'fever' | 'speed' | 'mark' | 'miss' | 'boss' | 'item' | 'laser' | 'map' | 'rainbow' | 'up';
export interface RuleChip { icon: RuleChipIcon; text: string; off?: boolean }

/** 대기실 규칙 칩: 판 시간·피버·속도·견제·빈 곳·요소 켜짐/꺼짐 (꺼진 것은 off로 흐리게). 협력전은 쓰지 않는 것을 뺀다 */
export function rulesChips(r: RoomRules): RuleChip[] {
  const time = r.mode === 'arcade' ? `${ARCADE.rounds}라운드 × ${r.arcadeRoundSec}초`
    : r.coop ? `${RULES.coop.timeSec}초` : r.survival ? `${RULES.survival.everyMs / 1000}초마다 꼴찌 탈락` : `${r.roundSec}초`;
  // 협력전은 난이도와 제한 시간만
  if (r.coop) return [{ icon: 'coop', text: `협력전 · ${COOP_NAME[r.coopLevel]}` }, { icon: 'timer', text: time }];
  const chips: RuleChip[] = [{ icon: 'timer', text: time }];
  chips.push({ icon: 'fever', text: `피버 ×${r.feverMult} · ${r.feverSec}초` });
  chips.push({ icon: 'speed', text: `속도 ×${r.speed} · 원 개수 ×${r.density}` });
  chips.push({ icon: 'mark', text: r.stealPenalty ? `견제 페널티 · 표적 ${r.markSec}초` : '견제 페널티 없음' });
  chips.push({ icon: 'miss', text: '빈 곳 감점', off: !r.missPenalty });
  chips.push({ icon: 'boss', text: '보스', off: !r.boss });
  chips.push({ icon: 'item', text: '아이템', off: !r.items });
  const freq = (r.laserFreq ?? 1) < 1 ? '드물게' : (r.laserFreq ?? 1) > 1 ? '자주' : '보통';
  chips.push(r.laser ? { icon: 'laser', text: `레이저 · ${r.chaos ? `카오스 · ${freq}` : freq}` } : { icon: 'laser', text: '레이저', off: true });
  chips.push(r.mapPct > 0 ? { icon: 'map', text: `맵 패턴 ${r.mapPct}%` } : { icon: 'map', text: '맵 패턴', off: true });
  chips.push(r.rainbowPct > 0 ? { icon: 'rainbow', text: `무지개 ${r.rainbowPct}%` } : { icon: 'rainbow', text: '무지개', off: true });
  chips.push({ icon: 'up', text: '꼴찌 보정', off: !r.comeback });
  return chips;
}

/** 친구에게 보낼 방 링크 (열면 그 방으로) */
export function roomLink(origin: string, pathname: string, code: string): string {
  return `${origin}${pathname}#${code}`;
}
