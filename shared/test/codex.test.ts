import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES } from '../src/index.ts';
import { rulesTabHTML } from '../../client/src/codex.ts';

test('도감 규칙 탭: 방 규칙과 상관없이 기본 규칙 숫자와 안내', () => {
  const h = rulesTabHTML();
  assert.ok(h.includes(`피버 중 (×${DEFAULT_RULES.feverMult}, ${DEFAULT_RULES.feverSec}초)`));
  assert.ok(h.includes('방 규칙과 증강에 따라 달라질 수 있어요'));
  assert.ok(h.includes('이 방의 점수는 대기실에서 볼 수 있어요'));
  assert.ok(!h.includes('×5,'));
});
