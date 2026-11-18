import type { CoopPhase } from './coop.ts';
import type { BulletShape } from './coopBullets.ts';

export type CoopSkill = 'laser' | 'threat' | 'slam' | 'safe' | 'seal' | 'wall' | 'beam';

export interface CoopBoss {
  id: 'core'; name: string;
  /** 단계별 테두리 색 */
  rims: [string, string, string];
  body: string;
  bullets: Record<CoopPhase, BulletShape[]>;
  /** [첫 보호막, 두 번째 보호막] 수정 구간에서 쓰는 무늬 */
  shieldBullets: [BulletShape[], BulletShape[]];
  skills: Record<CoopPhase, CoopSkill[]>;
}

const PHASE2: CoopSkill[] = ['laser', 'threat', 'slam', 'seal', 'wall', 'beam'];

export const COOP_BOSSES: { core: CoopBoss } = {
  core: {
    id: 'core', name: '코어',
    rims: ['#f4f4f8', '#ffb3a0', '#ff2d3d'],
    body: '#1c1830',
    bullets: {
      1: ['ring', 'scatter'],
      2: ['ring', 'scatter', 'aimed', 'spiral'],
      3: ['ring', 'scatter', 'aimed', 'spiral'],
    },
    shieldBullets: [['spiral', 'ring'], ['spiral', 'ring', 'aimed']],
    skills: { 1: ['laser', 'threat'], 2: PHASE2, 3: [...PHASE2, 'safe'] },
  },
};
