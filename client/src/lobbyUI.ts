/**
 * 대기실 그리기에 쓰는 순수 함수 (DOM 없음): 자리 4칸, 규칙 요약, 방 링크.
 * main.ts가 이 결과로 대기실을 그린다
 */
import { ARCADE, DEFAULT_RULES, MAX_PLAYERS, PRESETS, RULES, matchPreset, type CoopLevel, type PlayerState, type RoomRules } from '@color-burst/shared';

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
  if (r.coop) return { title, detail: `${time} · 체력 ${RULES.coop.hpMax}` };
  const on = [r.boss && '보스', r.items && '아이템', r.laser && '레이저', r.mapPct > 0 && '맵 패턴'].filter(Boolean);
  return { title, detail: [time, `피버 ×${r.feverMult} ${r.feverSec}초`, ...on].join(' · ') };
}

/** 규칙 아이콘 어휘: 대기실 규칙 패널과 게임 설정 창이 같은 이름을 쓴다 */
export type RuleIconId = 'coop' | 'level' | 'heart' | 'timer' | 'fever' | 'speed' | 'mark' | 'miss' | 'boss' | 'item' | 'special' | 'laser' | 'map' | 'rainbow' | 'up';
export type RuleTileId = 'boss' | 'item' | 'special' | 'laser' | 'map' | 'rainbow' | 'mark' | 'miss' | 'comeback';

/** 핵심 숫자 한 칸: 큰 글자 + 작은 설명. changed: 현재 프리셋(없으면 기본 규칙)과 값이 다름 */
export interface RuleStat { icon: RuleIconId; big: string; small: string; changed?: boolean }
/** 켜짐/꺼짐 타일: badge는 부가값(맵 패턴 35% 등) */
export interface RuleTile { id: RuleTileId; icon: RuleIconId; label: string; on: boolean; badge?: string; changed?: boolean }
export interface RulePanel {
  title: string;
  /** 프리셋 이름, 어느 프리셋도 아니면 '커스텀', 협력전은 빈 문자열 */
  preset: string;
  stats: RuleStat[];
  groups: { label: string; tiles: RuleTile[] }[];
}

/** 값이 다른지 비교할 기준: 지금 규칙이 맞는 프리셋, 없으면 기본 규칙 */
export const baselineOf = (r: RoomRules): RoomRules => {
  const id = matchPreset(r);
  return id ? PRESETS[id].rules : DEFAULT_RULES;
};

const freqText = (r: RoomRules) => ((r.laserFreq ?? 1) < 1 ? '드물게' : (r.laserFreq ?? 1) > 1 ? '자주' : '보통');

/**
 * 대기실 규칙 패널 데이터: 모드 → 핵심 숫자 3칸 → 켜진 요소 타일 두 묶음.
 * 협력전은 난이도·제한 시간·체력 세 칸만 있고 타일이 없다. 화면은 이 데이터를 그리기만 한다 (설정 창 미리보기도 같은 함수)
 */
export function rulePanel(r: RoomRules): RulePanel {
  const title = rulesSummary(r).title;
  if (r.coop) {
    return {
      title, preset: '',
      stats: [
        { icon: 'level', big: COOP_NAME[r.coopLevel], small: '난이도' },
        { icon: 'timer', big: `${RULES.coop.timeSec}초`, small: '제한 시간' },
        { icon: 'heart', big: `${RULES.coop.hpMax}`, small: '체력' },
      ],
      groups: [],
    };
  }
  const b = baselineOf(r);
  const presetId = matchPreset(r);
  const time = r.mode === 'arcade'
    ? { big: `${ARCADE.rounds}라운드`, small: `라운드마다 ${r.arcadeRoundSec}초`, changed: r.arcadeRoundSec !== b.arcadeRoundSec }
    : r.survival
      ? { big: `${RULES.survival.everyMs / 1000}초`, small: '마다 꼴찌 탈락', changed: false }
      : { big: `${r.roundSec}초`, small: '한 판', changed: r.roundSec !== b.roundSec };
  const stats: RuleStat[] = [
    { icon: 'timer', ...time },
    { icon: 'fever', big: `×${r.feverMult}`, small: `${r.feverSec}초 지속`, changed: r.feverMult !== b.feverMult || r.feverSec !== b.feverSec || r.feverGain !== b.feverGain },
    { icon: 'speed', big: `×${r.speed}`, small: `원 개수 ×${r.density}`, changed: r.speed !== b.speed || r.density !== b.density || r.circleScale !== b.circleScale },
  ];
  const appears: RuleTile[] = [
    { id: 'boss', icon: 'boss', label: '보스', on: r.boss, changed: r.boss !== b.boss },
    { id: 'item', icon: 'item', label: '아이템', on: r.items, changed: r.items !== b.items },
    { id: 'special', icon: 'special', label: '특수 원', on: r.specialCircles, changed: r.specialCircles !== b.specialCircles },
    { id: 'laser', icon: 'laser', label: '레이저', on: r.laser, badge: r.laser ? (r.chaos ? `카오스 · ${freqText(r)}` : freqText(r)) : undefined,
      changed: r.laser !== b.laser || r.laserFreq !== b.laserFreq || r.laserWidth !== b.laserWidth || r.chaos !== b.chaos },
    { id: 'map', icon: 'map', label: '맵 패턴', on: r.mapPct > 0, badge: r.mapPct > 0 ? `${r.mapPct}%` : undefined, changed: r.mapPct !== b.mapPct },
    { id: 'rainbow', icon: 'rainbow', label: '무지개', on: r.rainbowPct > 0, badge: r.rainbowPct > 0 ? `${r.rainbowPct}%` : undefined, changed: r.rainbowPct !== b.rainbowPct },
  ];
  const penalty: RuleTile[] = [
    { id: 'mark', icon: 'mark', label: '견제 페널티', on: r.stealPenalty, badge: r.stealPenalty && r.markSec ? `표적 ${r.markSec}초` : undefined, changed: r.stealPenalty !== b.stealPenalty || r.markSec !== b.markSec },
    { id: 'miss', icon: 'miss', label: '빈 곳 감점', on: r.missPenalty, changed: r.missPenalty !== b.missPenalty },
    { id: 'comeback', icon: 'up', label: '꼴찌 보정', on: r.comeback, changed: r.comeback !== b.comeback },
  ];
  return {
    title, preset: presetId ? PRESETS[presetId].name : '커스텀', stats,
    groups: [{ label: '판에 나오는 것', tiles: appears }, { label: '감점 규칙', tiles: penalty }],
  };
}

/** 친구에게 보낼 방 링크 (열면 그 방으로) */
export function roomLink(origin: string, pathname: string, code: string): string {
  return `${origin}${pathname}#${code}`;
}
