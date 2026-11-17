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

const COOP_NAME: Record<CoopLevel, string> = { easy: '이지', normal: '노말', hard: '하드' };

/** 규칙 요약 두 줄: 인원 모드 · 클래식/아케이드 · 프리셋, 그리고 시간·피버·켜진 요소 */
export function rulesSummary(r: RoomRules): { title: string; detail: string } {
  const who = r.coop ? `협력전 ${COOP_NAME[r.coopLevel]}` : r.team ? '팀전 2:2' : r.survival ? '서바이벌' : '개인전';
  const preset = matchPreset(r);
  const title = `${who} · ${r.mode === 'arcade' ? '아케이드' : '클래식'} · ${preset ? PRESETS[preset].name : '커스텀'}`;
  const time = r.mode === 'arcade' ? `${ARCADE.rounds}라운드 · 라운드 ${r.arcadeRoundSec}초` : `${r.coop ? RULES.coop.timeSec : r.roundSec}초`;
  const on = [r.boss && '보스', r.items && '아이템', r.laser && '레이저', r.mapPct > 0 && '맵 패턴'].filter(Boolean);
  return { title, detail: [time, `피버 ×${r.feverMult} ${r.feverSec}초`, ...on].join(' · ') };
}

/** 친구에게 보낼 방 링크 (열면 그 방으로) */
export function roomLink(origin: string, pathname: string, code: string): string {
  return `${origin}${pathname}#${code}`;
}
