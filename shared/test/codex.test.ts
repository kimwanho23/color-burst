import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES, COMBOS, DEFAULT_RULES, UNIQUES } from '../src/index.ts';
import { abilityTab, comboTab, rulesTabHTML, uniqueTab } from '../../client/src/codex.ts';

test('도감 규칙 탭: 방 규칙과 상관없이 기본 규칙 숫자와 안내', () => {
  const h = rulesTabHTML();
  assert.ok(h.includes(`피버 중 (×${DEFAULT_RULES.feverMult}, ${DEFAULT_RULES.feverSec}초)`));
  assert.ok(h.includes('방 규칙과 증강에 따라 달라질 수 있어요'));
  assert.ok(h.includes('이 방의 점수는 대기실에서 볼 수 있어요'));
  assert.ok(!h.includes('×5,'));
});

test('도감은 일반 증강·유니크·조합 이름과 아이콘을 표시한다', (t) => {
  class SvgNode {
    attrs = new Map<string, string>();
    nodes: SvgNode[] = [];
    constructor(readonly tag: string) {}
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    appendChild(child: SvgNode) { this.nodes.push(child); }
    get outerHTML() { return '<' + this.tag + '>' + this.nodes.map((node) => node.outerHTML).join('') + '</' + this.tag + '>'; }
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElementNS: (_namespace: string, tag: string) => new SvgNode(tag) },
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'document'));
  for (const [entries, html] of [[ABILITIES, abilityTab()], [UNIQUES, uniqueTab()], [COMBOS, comboTab({})]] as const) {
    for (const entry of entries) assert.ok(html.includes(entry.name), entry.name);
    assert.ok(html.includes('<svg'));
  }
  for (const removed of ['연쇄 콤보', '수집가', '방해 전파']) assert.ok(!abilityTab().includes(removed));
});
