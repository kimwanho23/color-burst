import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES, COMBOS, DEFAULT_RULES, UNIQUES, newPlayer, type Pick } from '../src/index.ts';
import { abilityTab, comboTab, rulesTabHTML, uniqueTab } from '../../client/src/codex.ts';
import { renderPick } from '../../client/src/arcadeUI.ts';

test('도감 규칙 탭: 방 규칙과 상관없이 기본 규칙 숫자와 안내', () => {
  const h = rulesTabHTML();
  assert.ok(h.includes(`피버 중 (×${DEFAULT_RULES.feverMult}, ${DEFAULT_RULES.feverSec}초)`));
  assert.ok(h.includes('방 규칙과 증강에 따라 달라질 수 있어요'));
  assert.ok(h.includes('이 방의 점수는 대기실에서 볼 수 있어요'));
  assert.ok(!h.includes('×5,'));
});

function installSvgDom(t: TestContext) {
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
}

test('도감은 일반 증강·유니크·조합 이름과 아이콘을 표시한다', (t) => {
  installSvgDom(t);
  for (const [entries, html] of [[ABILITIES, abilityTab()], [UNIQUES, uniqueTab()], [COMBOS, comboTab({})]] as const) {
    for (const entry of entries) assert.ok(html.includes(entry.name), entry.name);
    assert.ok(html.includes('<svg'));
  }
  for (const removed of ['연쇄 콤보', '수집가', '방해 전파']) assert.ok(!abilityTab().includes(removed));
});

test('증강 선택 화면은 독주 활성과 연결·지정 조합에 의한 비활성을 미리 보여 준다', (t) => {
  installSvgDom(t);
  const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const me = newPlayer('a', 'A', 0);
  const options = (id: Pick['id']) => {
    renderPick(el as unknown as HTMLElement, {
      me, players: [me], chosen: false, effects: [], deal: false, opening: false,
      state: { phase: 'pick', round: 2, rounds: 5, waiting: [], pickEndsAt: 0, theme: null, event: null },
      offer: { options: [{ id, tier: 0 }], rerollLeft: 0, pickEndsAt: 0, lastPlace: false, need: 1, comeback: false, deal: 1 },
    }, { choose() {}, reroll() {} });
    return el.innerHTML;
  };
  assert.match(options('spacing'), /독주 켜짐/);
  me.picks = [{ id: 'spacing', tier: 0 }, { id: 'shield', tier: 0 }];
  assert.match(options('synergyLink'), /선택하면 독주 꺼짐/);
  assert.match(options('autoGuard'), /선택하면 독주 꺼짐/);
  assert.doesNotMatch(options('spacing'), /선택하면 독주 꺼짐/);
});
