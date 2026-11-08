import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD, PATTERN_IDS, RULES, barSegment, blockedAt, iceStep, inRingDanger, makePattern, moverAt, pushOut, ringE, rollPatternAt,
  shiftPattern, spikeHit, eyeOf, trapIn, vortexAlive, vortexBend, vortexWarned, type MapPattern,
} from '../src/index.ts';

const R = RULES.patterns;

test('rollPatternAt: 라운드 시작 5초 뒤 ~ 끝나기 12초 전 안, 너무 짧은 라운드면 −1', () => {
  assert.equal(rollPatternAt(1000, 31_000, () => 0), 6000);
  assert.equal(rollPatternAt(1000, 31_000, () => 1), 19_000);
  assert.equal(rollPatternAt(0, 10_000, () => 0.5), -1);
});

test('makePattern: 경고 3초 전, 패턴별 유지 시간, 벽은 중앙을 피하고 서로 안 겹침', () => {
  for (const id of PATTERN_IDS) {
    const p = makePattern(id, 10_000, Math.random);
    assert.deepEqual([p.warnAt, p.until], [10_000 - R.warnMs, 10_000 + R[id].ms], id);
  }
  for (let n = 0; n < 50; n++) {
    const w = makePattern('walls', 0, Math.random).walls!;
    assert.ok(w.length >= 1 && w.length <= 3);
    for (const r of w) {
      const cx = FIELD.w / 2, cy = FIELD.h / 2;
      const nx = Math.max(r.x, Math.min(cx, r.x + r.w)), ny = Math.max(r.y, Math.min(cy, r.y + r.h));
      assert.ok(Math.hypot(cx - nx, cy - ny) >= R.walls.centerClear, '중앙 비움');
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= FIELD.w && r.y + r.h <= FIELD.h);
    }
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
      const a = w[i], b = w[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), '벽끼리 안 겹침');
    }
  }
});

test('moverAt: 벽에서 튕겨 필드 안에 머묾', () => {
  const m = { x: 1500, y: 100, vx: 260, vy: -260 };
  for (let t = 0; t <= 20_000; t += 137) {
    const q = moverAt(m, 0, t, 28);
    assert.ok(q.x >= 28 && q.x <= FIELD.w - 28 && q.y >= 28 && q.y <= FIELD.h - 28);
  }
  assert.equal(moverAt(m, 0, 1000, 28).x, FIELD.w - 28 - (1500 + 260 - (FIELD.w - 28)));
});

const spikes = (): MapPattern => ({ id: 'spikes', warnAt: -1500, at: 0, until: 10_000, balls: [{ x: 400, y: 400, vx: 0, vy: 0 }, { x: 900, y: 400, vx: 0, vy: 0 }] });

test('spikeHit: 반지름 안이면 번호, 사라진 공은 무시, 시간 밖이면 −1', () => {
  const p = spikes();
  assert.equal(spikeHit(p, { x: 420, y: 400 }, 100, new Set()), 0);
  assert.equal(spikeHit(p, { x: 400 + R.spikes.r + 1, y: 400 }, 100, new Set()), -1);
  assert.equal(spikeHit(p, { x: 420, y: 400 }, 100, new Set([0])), -1);
  assert.equal(spikeHit(p, { x: 900, y: 400 }, 100, new Set([0])), 1);
  assert.equal(spikeHit(p, { x: 420, y: 400 }, -10, new Set()), -1, '경고 중');
  assert.equal(spikeHit(p, { x: 420, y: 400 }, 10_000, new Set()), -1, '끝남');
});

test('blockedAt·pushOut: 벽 안 점은 가장 가까운 변 밖으로, 막대는 돌아간 각도 기준', () => {
  const w: MapPattern = { id: 'walls', warnAt: -1500, at: 0, until: 10_000, walls: [{ x: 100, y: 100, w: 300, h: 40 }] };
  assert.equal(blockedAt(w, { x: 200, y: 110 }, 100), true);
  assert.equal(blockedAt(w, { x: 200, y: 110 }, -100), false, '경고 중에는 안 막힘');
  assert.deepEqual(pushOut(w, { x: 200, y: 110 }, 100), { x: 200, y: 99 });
  assert.deepEqual(pushOut(w, { x: 200, y: 135 }, 100), { x: 200, y: 141 });
  assert.deepEqual(pushOut(w, { x: 50, y: 50 }, 100), { x: 50, y: 50 });
  const bar: MapPattern = { id: 'bar', warnAt: -1500, at: 0, until: 9000, bar: { cx: 800, cy: 450, a0: 0 } };
  assert.equal(blockedAt(bar, { x: 1000, y: 450 }, 0), true);
  // 2초 뒤 90° 돌아 세로: 가로 위치는 비고 세로 위치가 막힘
  assert.equal(blockedAt(bar, { x: 1000, y: 450 }, 2000), false);
  assert.equal(blockedAt(bar, { x: 800, y: 700 }, 2000), true);
  const s = barSegment(bar, 2000);
  assert.ok(Math.abs(s.a.x - 800) < 1e-6);
  const q = pushOut(bar, { x: 1000, y: 455 }, 0);
  assert.equal(blockedAt(bar, q, 0), false);
  assert.ok(q.y > 455 && Math.abs(q.x - 1000) < 1e-6);
});

test('ringE: 1.5에서 6초 동안 0.7까지 줄고 유지, 가장자리 점은 위험', () => {
  const p: MapPattern = { id: 'ring', warnAt: -1500, at: 0, until: 10_000 };
  assert.equal(ringE(p, 0), 1.5);
  assert.ok(Math.abs(ringE(p, 3000) - 1.1) < 1e-9);
  assert.equal(ringE(p, 6000), 0.7);
  assert.equal(ringE(p, 9000), 0.7);
  assert.equal(inRingDanger(p, { x: 20, y: 450 }, 0), false, '처음엔 안전');
  assert.equal(inRingDanger(p, { x: 20, y: 450 }, 7000), true);
  assert.equal(inRingDanger(p, { x: 800, y: 450 }, 7000), false);
  assert.equal(inRingDanger(p, { x: 20, y: 450 }, 10_000), false, '끝나면 안전');
});

const vort = (): MapPattern => ({ id: 'vortex', warnAt: -3000, at: 0, until: 10_000, vortices: [{ x: 400, y: 400 }, { x: 1200, y: 450 }] });

test('소용돌이: 첫 번째는 바로, 두 번째는 4초 뒤에 생기고 그 3초 전부터 미리보기', () => {
  const p = vort();
  assert.deepEqual(vortexAlive(p, 100), [0]);
  assert.deepEqual(vortexWarned(p, 1000), [1]);
  assert.deepEqual(vortexWarned(p, 999), []);
  assert.deepEqual(vortexAlive(p, R.vortex.secondAfterMs), [0, 1]);
  assert.deepEqual(vortexAlive(p, 10_000), [], '끝나면 없음');
});

test('소용돌이 끌림: 구역 안이면 중심 쪽으로(가까울수록 많이, 최대 120), 밖이면 그대로, 중심을 넘지 않음', () => {
  const p = vort();
  const at = (x: number) => vortexBend(p, { x, y: 400 }, 100).x;
  assert.equal(at(400 + R.vortex.r + 10), 400 + R.vortex.r + 10);
  assert.ok(Math.abs(at(400 + 190) - (590 - R.vortex.maxBend * (1 - 190 / R.vortex.r))) < 1e-9);
  assert.equal(at(420), 400, '가까우면 중심까지');
  assert.equal(vortexBend(p, { x: 1100, y: 450 }, 100).x, 1100, '두 번째는 아직 안 생김');
});

test('소용돌이 눈: 안이면 그 번호, 갇히면 테두리 안쪽으로', () => {
  const p = vort();
  assert.equal(eyeOf(p, { x: 450, y: 400 }, 100), 0);
  assert.equal(eyeOf(p, { x: 400 + R.vortex.eye + 5, y: 400 }, 100), -1);
  assert.equal(eyeOf(p, { x: 1200, y: 450 }, 100), -1);
  assert.equal(eyeOf(p, { x: 1200, y: 450 }, R.vortex.secondAfterMs), 1);
  assert.deepEqual(trapIn(p, 0, { x: 900, y: 400 }), { x: 400 + R.vortex.eye - 1, y: 400 });
  assert.deepEqual(trapIn(p, 0, { x: 450, y: 400 }), { x: 450, y: 400 });
});

test('makePattern 소용돌이: 두 개, 중앙을 피하고 서로 멀리', () => {
  for (let n = 0; n < 50; n++) {
    const v = makePattern('vortex', 0, Math.random).vortices!;
    assert.equal(v.length, 2);
    assert.ok(Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) >= R.vortex.r + R.vortex.eye);
    for (const c of v) assert.ok(Math.hypot(c.x - FIELD.w / 2, c.y - FIELD.h / 2) >= R.vortex.centerClear);
  }
});

test('iceStep: 목표를 한 번 지나쳤다가 결국 목표에 닿음', () => {
  let pos = { x: 0, y: 0 }, vel = { x: 0, y: 0 }, maxX = 0;
  for (let i = 0; i < 300; i++) { ({ pos, vel } = iceStep(pos, vel, { x: 500, y: 0 }, 16)); maxX = Math.max(maxX, pos.x); }
  assert.ok(maxX > 520, `지나침 ${maxX}`);
  assert.ok(Math.abs(pos.x - 500) < 2);
});

test('shiftPattern: 모든 시각이 같이 밀림', () => {
  const p = shiftPattern(spikes(), 2500);
  assert.deepEqual([p.warnAt, p.at, p.until], [1000, 2500, 12_500]);
  assert.equal(spikes().at, 0, '원본은 그대로');
});
