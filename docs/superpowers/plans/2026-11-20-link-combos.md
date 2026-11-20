# 연결·3장 조합·행운 축적·아이템 애호가 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연결을 "3장 조합을 2장으로 완성"으로 바꾸고, 3장 조합 6개를 추가하고, 행운 축적·아이템 애호가가 혼자서도 동작하게 한다.

**Architecture:** 조합 판정은 `shared/src/arcade.ts`의 `combosOf` 한 곳에서 바꾸고, 효과는 기존 조합처럼 `combosFor(p).has(id)`로 각 판정 지점(`shared/src/rules.ts`의 `resolveClaim`·`settleFever`·`goldGain`, `shared/src/bossScore.ts`, `server/src/room.ts`)에 넣는다. 새 수치는 `RULES.combos`와 `RULES.itemLoverDelayMs`에 둔다.

**Tech Stack:** TypeScript, Node `node:test` (`npm test`), tsx

**Spec:** `docs/superpowers/specs/2026-11-20-link-combos-design.md`

## Global Constraints

- 연결은 `needs.length === 3`인 조합만 2장으로 완성한다. 2장 조합과 분류 시너지는 영향 없음.
- 새 조합 이름: 타짜, 앙코르, 명사수, 토벌대, 만능 손, 역습. id: `gambit`, `encore`, `marksman`, `raidParty`, `allHandsCombo`, `riposteCombo`.
- 새 규칙 수치는 `shared/src/rules.ts`의 `RULES`에만 둔다 (`CLAUDE.md`).
- 조합이 주는 피버 게이지는 고정값: `addFever(..., raw = true)`.
- 커밋 메시지는 `<타입>(<범위>): <한국어 요약>` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 한 커밋 한 목적.
- 커밋 전 `npm run typecheck`, `npm run build`, `npm test` 통과.
- 푸시하지 않는다.

## Review Focus

1. 연결 + 3장 조합 중 2장일 때, 빠진 카드 때문에 효과가 비지 않는지 (조합마다 "2장일 때" 테스트) → Task 3~6
2. 자석 증강·자석 아이템으로 끌어온 원이 만능 손 때문에 콤보·피버를 채우면 안 됨 → Task 5
3. 역습: 반격·폭죽·보호막에 막힌 견제는 게이지를 주지 않음 → Task 6
4. 아이템 애호가 라운드 시작 아이템이 일시정지 중에 터지지 않고, 아이템이 꺼진 방·여러 장 보유에서도 라운드당 1개 → Task 7
5. 행운 축적: 무지개를 잡고 잭팟도 터진 획득은 1칸만 → Task 3

---

### Task 1: 연결을 3장 조합 완성으로 변경

**Files:**
- Modify: `shared/src/arcade.ts` (`combosOf` 260, `comboProgress` 266, `buildWeight` 281, `synergyProgress` 475, 연결 설명 363)
- Modify: `client/src/codex.ts:37` (독주 규칙 문장은 그대로, 연결 언급 확인)
- Test: `shared/test/synergy.test.ts` (기존 연결 테스트 23~40행 교체), `shared/test/combos.test.ts`

**Interfaces:**
- Produces: `combosOf(picks)`가 연결 보유 시 `needs.length === 3` 조합을 2장으로 완성. `comboProgress`의 `need`도 2. `synergyProgress`에 연결 보너스 없음.

- [ ] **Step 1: 실패하는 테스트**

`synergy.test.ts`의 `'연결: 모든 분류에 한 종류를 더하고…'` 테스트를 아래로 교체:

```ts
test('연결: 분류 시너지에는 영향 없음', () => {
  assert.deepEqual(synergyProgress(P('synergyLink')), []);
  assert.ok(!synergiesOf(P('synergyLink', 'overtime')).has('피버'));
});
```

`combos.test.ts`에 추가:

```ts
test('연결: 3장 조합은 2장으로 완성, 2장 조합은 그대로', () => {
  assert.ok(combosOf(P('synergyLink', 'hammer', 'hunter')).has('bossHunter'));
  assert.ok(!combosOf(P('hammer', 'hunter')).has('bossHunter'));
  assert.ok(!combosOf(P('synergyLink', 'hammer')).has('bossHunter'));
  assert.ok(!combosOf(P('synergyLink', 'jackpot')).has('lucky'));
  assert.deepEqual(comboProgress(P('synergyLink', 'hammer')).find((c) => c.id === 'bossHunter'), { id: 'bossHunter', name: '보스 헌터', text: COMBOS.find((c) => c.id === 'bossHunter')!.text, have: 1, need: 2 });
});

test('봇 가중치: 연결로 완성된 3장 조합의 남은 1장에는 조합 가중치 없음', () => {
  assert.equal(buildWeight('crusher', P('synergyLink', 'hammer', 'hunter')), WEIGHT.sameCat);
  assert.equal(buildWeight('crusher', P('hammer', 'hunter')), WEIGHT.sameCat * WEIGHT.comboPart);
});
```

(`P`, `WEIGHT`, `COMBOS`, `comboProgress`, `buildWeight`가 import에 없으면 추가. `WEIGHT`가 export되어 있지 않으면 숫자 2, 3을 직접 쓴다.)

- [ ] **Step 2: `npm test` → 위 테스트 실패 확인**

- [ ] **Step 3: 구현**
- `combosOf`: `const need = (c) => has('synergyLink') && c.needs.length === 3 ? 2 : c.needs.length`; 가진 개수 ≥ need면 완성. `comboProgress`도 같은 `need` 사용 (헬퍼 `comboNeed(c, ids: Set<AbilityId>)`로 공유).
- `synergyProgress`: `linkBonus` 삭제.
- `buildWeight`: "미완성 조합" 판정을 `combosOf(owned)`에 없는 조합으로 바꾼다.
- 연결 설명: `'필요한 증강이 3장인 조합을 2장만 모아도 완성'`.

- [ ] **Step 4: `npm test` 전체 통과.** 다른 테스트가 연결의 시너지 효과를 기대하고 있으면(`synergy.test.ts` 43~78행의 독주 테스트 등) 연결 = 독주 꺼짐 규칙은 유지되므로 기대값만 시너지 관련 부분을 고친다.

- [ ] **Step 5: 커밋** `fix(shared): 연결이 분류 시너지 대신 3장 조합을 2장으로 완성`

---

### Task 2: 새 3장 조합 6개 정의와 수치

**Files:**
- Modify: `shared/src/arcade.ts:243-258` (`ComboId`, `COMBOS`)
- Modify: `shared/src/rules.ts:31` 근처 `RULES`
- Test: `shared/test/combos.test.ts`

**Interfaces:**
- Produces: `ComboId`에 `'gambit' | 'encore' | 'marksman' | 'raidParty' | 'allHandsCombo' | 'riposteCombo'`.
- Produces: `RULES.combos = { gambitFever: 10, gambitRapidMs: 1000, encoreFever: 30, marksmanPct: 15, raidFever: 25, raidCrownMult: 1.5, allHandsPts: 1, riposteFever: 15 }`, `RULES.itemLoverDelayMs = 3000`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('새 3장 조합: 구성과 연결 2장 완성', () => {
  const want: [ComboId, AbilityId[]][] = [
    ['gambit', ['jackpot', 'luckStack', 'rapid']],
    ['encore', ['overcharge', 'afterglow', 'ignite']],
    ['marksman', ['precise', 'centerKing', 'headStart']],
    ['raidParty', ['vanguard', 'crownMark', 'hunter']],
    ['allHandsCombo', ['wideHand', 'missSave', 'autoMagnet']],
    ['riposteCombo', ['laserProof', 'reflect', 'taunt']],
  ];
  for (const [id, needs] of want) {
    assert.deepEqual(COMBOS.find((c) => c.id === id)?.needs, needs);
    assert.ok(combosOf(P(...needs)).has(id));
    assert.ok(combosOf(P('synergyLink', needs[0], needs[2])).has(id));
  }
  assert.deepEqual(['타짜', '앙코르', '명사수', '토벌대', '만능 손', '역습'], want.map(([id]) => COMBOS.find((c) => c.id === id)!.name));
});
```

- [ ] **Step 2: `npm test` → 실패 확인**

- [ ] **Step 3: 구현.** `COMBOS` 끝에 6개 추가. `text`는 수치를 `RULES.combos`에서 읽는 getter(콤보 머신처럼 `get text()`):
  - 타짜: `잭팟이 터지면 피버 게이지 +10, 다음 원 1개는 속사 허용 시간 1초`
  - 앙코르: `피버가 끝날 때 피버 게이지 +30`
  - 명사수: `직접 클릭한 원 점수 +15%, 정밀 사격 판정이면 콤보 +1`
  - 토벌대: `보스가 나오면 피버 게이지 +25, 왕의 증표 기여도 계산에서 내 보스 피해 ×1.5`
  - 만능 손: `자기장으로 끌어온 원도 콤보·피버 게이지를 채움, 넓은 손·헛손질 보정으로 잡은 원 +1점`
  - 역습: `견제당할 때마다 피버 게이지 +15 (반격·폭죽·막힌 견제 제외)`

- [ ] **Step 4: `npm test`, `npm run typecheck` 통과.** (`client/src/icons.ts:91`의 `comboIcon`은 기본 아이콘을 쓰므로 수정 불필요.)

- [ ] **Step 5: 커밋** `feat(shared): 3장 조합 6개 정의 추가`

---

### Task 3: 타짜와 행운 축적

**Files:**
- Modify: `shared/src/rules.ts` (`rollJackpot` 1120, 속사 1774-1779, 무지개 분기 1646, `goldGain` 1866, `PlayerState` 842 근처와 초기화 982·1023, 일시정지 시각 이동 874)
- Modify: `shared/src/bossScore.ts:95,119`
- Modify: `shared/src/arcade.ts:209` (행운 축적 설명)
- Test: `shared/test/growth.test.ts` (행운 축적), `shared/test/combos.test.ts` (타짜)

**Interfaces:**
- Consumes: `RULES.combos.gambitFever`, `RULES.combos.gambitRapidMs` (Task 2)
- Produces: `export function jackpotHit(p: PlayerState, now: number, G: GameRules, players: PlayerState[]): boolean` — 잭팟이 터진 뒤 호출. 타짜면 피버 게이지 +10(raw)과 `p.rapidLongNext = true`. 피버가 시작되면 true.
- Produces: `PlayerState.rapidLongNext: boolean` (기본 false, `startRound`에서 false).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('행운 축적: 황금·무지개 원으로도 1칸, 무지개+잭팟은 1칸만', () => {
  // 잭팟 없이 무지개 → 1칸
  const p = withPicks(P('luckStack'));
  resolveClaim(p, 'rainbow', [p], 1000, G, { rand: () => 0.99 });
  assert.equal(p.stacks.luckStack, 1);
  // 황금 원 → 1칸 더
  goldGain(p, 2000, [p], G, 1, () => 0.99);
  assert.equal(p.stacks.luckStack, 2);
  // 잭팟 확정 + 무지개 → 1칸만
  const q = withPicks(P('jackpot', 'luckStack'));
  resolveClaim(q, 'rainbow', [q], 1000, G, { rand: () => 0 });
  assert.equal(q.stacks.luckStack, 1);
});

test('타짜: 잭팟이 터지면 피버 게이지 +10, 다음 원은 1초 안이면 속사 연속', () => {
  const p = withPicks(P('jackpot', 'rapid', 'luckStack'));
  p.color = 0;
  resolveClaim(p, 0, [p], 1000, G, { rand: () => 0 }); // 잭팟
  assert.ok(p.rapidLongNext);
  const fever = p.fever;
  const r = resolveClaim(p, 0, [p], 1900, G, { rand: () => 0.99 }); // 0.9초 뒤
  assert.equal(p.rapidStreak, 2);
  assert.ok(!p.rapidLongNext);
  assert.ok(fever >= RULES.combos.gambitFever);
});

test('타짜: 연결 + 행운 축적 + 속사 (잭팟 증강 없음)에서도 행운 축적으로 잭팟이 터지면 동작', () => {
  const p = withPicks(P('synergyLink', 'luckStack', 'rapid'));
  p.stacks.luckStack = 5;
  p.color = 0;
  resolveClaim(p, 0, [p], 1000, G, { rand: () => 0 });
  assert.ok(p.rapidLongNext);
});
```

(필드 이름 `p.stacks`, `p.color`는 기존 테스트 `growth.test.ts`의 사용법을 따른다. 다르면 그 이름으로 바꾼다.)

- [ ] **Step 2: `npm test` → 실패 확인**

- [ ] **Step 3: 구현**
  - `jackpotHit`: `combosFor(p).has('gambit')`면 `p.rapidLongNext = true`, `return addFever(p, RULES.combos.gambitFever, now, G, players, true)`. 아니면 false.
  - `resolveClaim`: `rollJackpot` 뒤 `res.jackpot > 1`이면 `if (jackpotHit(...)) res.feverStarted = true`. `kind === 'rainbow' && res.jackpot === 1`이면 `addStack(claimer, 'luckStack')`(행운 축적 보유 여부는 `addStack`이 확인하는지 보고, 아니면 `modsFor`로 확인).
  - 속사: 창 = `claimer.rapidLongNext ? RULES.combos.gambitRapidMs : AUG.rapidMs`. 창 판정 직후 `rapidLongNext = false`.
  - `goldGain`: 잭팟이 안 터졌으면 `addStack(p, 'luckStack')`. 터지면 `jackpotHit` 호출 (반환값은 무시하지 말고 `goldGain` 반환값에 `feverStarted` 추가, `room.ts:1890` 호출부에서 `p.stats.fevers++`).
  - `bossScore.ts` 95·119: 잭팟이 터지면 `jackpotHit`, 피버가 시작되면 기존 `out.feverStarted`에 OR.
  - 행운 축적 설명: `` `잭팟이 터지거나 황금 원·무지개 원을 잡을 때마다 잭팟 확률 +${GROWTH.luckPct}%가 쌓임 (최대 ${v}칸)` ``

- [ ] **Step 4: `npm test` 통과**

- [ ] **Step 5: 커밋** `feat(shared): 타짜 조합과 행운 축적 쌓기 조건 확장`

---

### Task 4: 앙코르와 토벌대

**Files:**
- Modify: `shared/src/rules.ts:1139` (`settleFever`)
- Modify: `shared/src/bossScore.ts:155` (왕의 증표 기여도)
- Modify: `server/src/room.ts:1512` (`spawnBosses`)
- Test: `shared/test/combos.test.ts`, `shared/test/room.test.ts`

**Interfaces:**
- Consumes: `RULES.combos.encoreFever`, `raidFever`, `raidCrownMult`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('앙코르: 피버가 끝나면 게이지 +30 (2장 + 연결로도)', () => {
  for (const picks of [P('overcharge', 'afterglow', 'ignite'), P('synergyLink', 'afterglow', 'ignite')]) {
    const p = withPicks(picks);
    p.feverUntil = 1000; p.fever = 0;
    assert.ok(settleFever(p, 1000));
    assert.equal(p.fever, RULES.combos.encoreFever);
  }
});

test('토벌대: 왕의 증표 기여도에 내 보스 피해 ×1.5', () => {
  // 체력 20 보스에 4 피해(20%) → 기본 25% 미달, 토벌대면 30%로 1칸
  // strikeBoss로 막타를 다른 사람이 치게 하고 me의 crownMark 칸을 확인 (boss-build.test.ts의 보스 설정 방식을 따름)
});
```

`room.test.ts`:

```ts
test('토벌대: 보스가 나오면 피버 게이지 +25', () => {
  const { room, me } = playingRoom();
  me.picks = P('vanguard', 'crownMark', 'hunter');
  me.fever = 0;
  (room as unknown as { spawnBosses(now: number): void }).spawnBosses(1000);
  assert.equal(me.fever, RULES.combos.raidFever);
  room.destroy();
});
```

- [ ] **Step 2: `npm test` → 실패 확인**

- [ ] **Step 3: 구현**
  - `settleFever`: 침묵이 아니고 `combosFor(p).has('encore')`면 `p.fever = Math.min(100, p.fever + RULES.combos.encoreFever)`, 변화가 있으면 true.
  - `bossScore.ts:155`: `contributed * 100 * (combosFor(q).has('raidParty') ? RULES.combos.raidCrownMult : 1) >= maxHp * GROWTH.crown.assistPct`.
  - `spawnBosses`: 보스를 만든 뒤, 탈락하지 않은 플레이어 중 토벌대 보유자에게 `addFever(p, RULES.combos.raidFever, now, this.G, this.players, true)`, 피버가 시작되면 `p.stats.fevers++`. 한 번에 여러 보스가 나와도 호출당 1회.

- [ ] **Step 4: `npm test` 통과**

- [ ] **Step 5: 커밋** `feat: 앙코르·토벌대 조합 효과`

---

### Task 5: 명사수와 만능 손

**Files:**
- Modify: `shared/src/rules.ts` (`resolveClaim` 1619-1640, 1780-1812)
- Test: `shared/test/combos.test.ts`

**Interfaces:**
- Consumes: `RULES.combos.marksmanPct`, `allHandsPts`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('명사수: 직접 클릭 +15%, 정밀 판정이면 콤보 +1', () => {
  const base = withPicks(P('centerKing', 'headStart')); base.color = 0;
  const p = withPicks(P('synergyLink', 'centerKing', 'headStart')); p.color = 0;
  const a = resolveClaim(base, 0, [base], 99_000, G, { rand: () => 0.99, zone: 1 });
  const b = resolveClaim(p, 0, [p], 99_000, G, { rand: () => 0.99, zone: 1 });
  assert.equal(b.gained, Math.round(a.gained * 1.15));
  const q = withPicks(P('precise', 'centerKing', 'headStart')); q.color = 0;
  resolveClaim(q, 0, [q], 99_000, G, { rand: () => 0.99, zone: 1, precise: true });
  assert.equal(q.combo, 2);
});

test('만능 손: 자기장으로 끌어온 원만 콤보·피버, 넓은 손·보정은 +1점', () => {
  const p = withPicks(P('wideHand', 'missSave', 'autoMagnet')); p.color = 0;
  resolveClaim(p, 0, [p], 1000, G, { via: 'magnet', magneticField: true, rand: () => 0 });
  assert.equal(p.combo, 1);
  assert.ok(p.fever > 0);
  const r = resolveClaim(p, 0, [p], 1000, G, { via: 'magnet', magneticField: true, rand: () => 0 });
  assert.equal(r.jackpot, 1, '잭팟 없음');
  // 자석 증강으로 끌어온 원은 그대로 콤보 없음
  const q = withPicks(P('wideHand', 'missSave', 'autoMagnet', 'magnet')); q.color = 0;
  resolveClaim(q, 0, [q], 1000, G, { via: 'magnet' });
  assert.equal(q.combo, 0);
  // 넓은 손 +1점
  const s = withPicks(P('wideHand', 'missSave')); s.color = 0;
  const t = withPicks(P('synergyLink', 'wideHand', 'missSave')); t.color = 0;
  const a = resolveClaim(s, 0, [s], 99_000, G, { via: 'range', rand: () => 0.99 });
  const b = resolveClaim(t, 0, [t], 99_000, G, { via: 'range', rand: () => 0.99 });
  assert.ok(b.gained > a.gained);
});
```

(시각 99_000은 출발 신호 창 밖. 출발 신호 배율이 라운드 시작 기준이면 테스트 기준 시각을 그에 맞춘다.)

- [ ] **Step 2: `npm test` → 실패 확인**

- [ ] **Step 3: 구현**
  - `K`(`combosFor`)를 `magnet` 계산보다 먼저 구한다.
  - `fieldCombo = via === 'magnet' && opts.magneticField && K.has('allHandsCombo')`. 콤보·피버 게이지·콤보 보너스·단련 판정이 쓰는 "자석이면 생략" 조건을 `magnet && !fieldCombo`로 바꾼다. 잭팟 생략과 점수 출처(`'magnet'`)는 기존 `magnet` 그대로.
  - 만능 손 +1점: `!steal && (via === 'range' || via === 'save') && K.has('allHandsCombo')`면 배율 곱하기 전 `pts += RULES.combos.allHandsPts`.
  - 명사수: `direct && !steal && K.has('marksman')`면 `mult`에 `1 + RULES.combos.marksmanPct / 100`을 곱한다. `precise && K.has('marksman')`면 `claimer.combo += 1`.

- [ ] **Step 4: `npm test` 통과**

- [ ] **Step 5: 커밋** `feat(shared): 명사수·만능 손 조합 효과`

---

### Task 6: 역습

**Files:**
- Modify: `shared/src/rules.ts` (`resolveClaim` 견제 반사 분기 1673-1686, 견제 처리 1707-1716)
- Test: `shared/test/combos.test.ts`

**Interfaces:**
- Consumes: `RULES.combos.riposteFever`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('역습: 일반·피버 중 견제와 반사는 게이지 +15, 반격·폭죽·막힌 견제는 없음', () => {
  const mk = () => {
    const a = withPicks(P('laserProof', 'reflect', 'taunt')); a.color = 0; a.id = 'a';
    const b = withPicks([]); b.color = 1; b.id = 'b';
    a.fever = 0; return [a, b] as const;
  };
  { const [a, b] = mk(); a.reflectLeft = 0; resolveClaim(b, 0, [a, b], 1000, G); assert.equal(a.fever, RULES.combos.riposteFever); }
  { const [a, b] = mk(); a.reflectLeft = 1; resolveClaim(b, 0, [a, b], 1000, G); assert.ok(a.fever >= RULES.combos.riposteFever); }
  { const [a, b] = mk(); a.reflectLeft = 0; a.markedUntil = 5000; resolveClaim(b, 0, [a, b], 1000, G); assert.equal(a.fever, 0, '반격'); }
  { const [a, b] = mk(); resolveClaim(b, 0, [a, b], 1000, G, { via: 'blast' }); assert.equal(a.fever, 0, '폭죽'); }
  { const [a, b] = mk(); a.reflectLeft = 0; a.buffs = { guard: 5000 } as never; resolveClaim(b, 0, [a, b], 1000, G); assert.equal(a.fever, 0, '보호막'); }
});
```

(보호막 버프 설정 방식은 `buffs.test.ts`를 따른다. `withPicks`가 `id`를 고정하면 `newPlayer`로 두 명을 만든다.)

- [ ] **Step 2: `npm test` → 실패 확인**

- [ ] **Step 3: 구현.** 헬퍼 `function riposteGain(owner: PlayerState, now: number, G: GameRules, players: PlayerState[])`: `combosFor(owner).has('riposteCombo')`면 `addFever(owner, RULES.combos.riposteFever, now, G, players, true)`, 시작되면 `owner.stats.fevers++`.
  - 반사 분기: 반사가 일어나면 호출.
  - 일반 견제: `!blast && owner && !owner.outAt && res.type !== 'counter' && !guarded`일 때 호출 (`guarded` 계산 뒤).

- [ ] **Step 4: `npm test` 통과**

- [ ] **Step 5: 커밋** `feat(shared): 역습 조합 효과`

---

### Task 7: 아이템 애호가 라운드 시작 아이템

**Files:**
- Modify: `shared/src/rules.ts` (`PlayerState`에 `itemLoverAt: number`, 초기화 982, `startRound` 1008, 일시정지 시각 이동 874)
- Modify: `server/src/room.ts:1710` (`updateAuto`)
- Modify: `shared/src/arcade.ts:193` (아이템 애호가 설명)
- Test: `shared/test/room.test.ts`, `shared/test/growth.test.ts` 또는 `arcade-bundle2.test.ts`

**Interfaces:**
- Consumes: `RULES.itemLoverDelayMs` (Task 2)
- Produces: `PlayerState.itemLoverAt` — 0이면 없음. `startRound`에서 `G.items && modsFor(p).itemLover > 0`이면 `startAt + RULES.itemLoverDelayMs`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('아이템 애호가: 라운드 시작 3초 뒤 아이템 1개, 여러 장이어도 1개', (t) => {
  const { room, me } = playingRoom();
  t.after(() => room.destroy());
  me.picks = P('itemLover', 'itemLover');
  startRound(me, 0, (room as unknown as { G: GameRules }).G);
  assert.equal(me.itemLoverAt, RULES.itemLoverDelayMs);
  itemEvents.length = 0;
  const r = room as unknown as { updateAuto(now: number): void };
  r.updateAuto(RULES.itemLoverDelayMs - 1);
  assert.equal(itemEvents.filter((e) => e.by === me.id && !e.extra).length, 0);
  r.updateAuto(RULES.itemLoverDelayMs);
  r.updateAuto(RULES.itemLoverDelayMs + 5000);
  assert.equal(itemEvents.filter((e) => e.by === me.id && !e.extra).length, 1);
});

test('아이템 애호가: 아이템이 꺼진 방이면 라운드 시작 아이템 없음', () => {
  const p = withPicks(P('itemLover'));
  startRound(p, 0, toGameRules({ ...DEFAULT_RULES, items: false }));
  assert.equal(p.itemLoverAt, 0);
});
```

(`DEFAULT_RULES`의 아이템 켜짐 키 이름이 `items`가 아니면 실제 이름을 쓴다.)

- [ ] **Step 2: `npm test` → 실패 확인**

- [ ] **Step 3: 구현**
  - `PlayerState.itemLoverAt` 추가, `newPlayer`에서 0, `startRound`에서 위 규칙으로 설정.
  - 874행 일시정지 시각 이동 목록에 `'itemLoverAt'` 추가.
  - `updateAuto`: 탈락·침묵이 아니고 `p.itemLoverAt && now >= p.itemLoverAt`면 `p.itemLoverAt = 0`, 커서 위치(`this.cursors.get(p.id)`, 없으면 `{ x: FIELD.w / 2, y: FIELD.h / 2 }`)에서 `this.activateItem(p, rollItemTier(), x, y, now, null)`. `updateAuto`는 `freezeUntil`·일시정지 중에 불리지 않는지 확인하고, 불리면 같은 조건을 건다.
  - 설명: `` `라운드 시작 후 ${RULES.itemLoverDelayMs / 1000}초에 무작위 아이템 1개 발동. 아이템이 발동하면 ${v}% 확률로 새 아이템이 한 번 더` ``

- [ ] **Step 4: `npm test` 통과**

- [ ] **Step 5: 커밋** `feat: 아이템 애호가 라운드 시작 아이템`

---

### Task 8: 문서와 최종 확인

**Files:**
- Modify: `CHANGELOG.md` (미출시 15행 "유니크 연결은…" 교체, 기능에 새 조합 6개·행운 축적·아이템 애호가)
- Modify: `docs/HANDOFF.md:15` (독주와 연결 행), `docs/ROADMAP.md` (조합 목록이 있으면 추가)

- [ ] **Step 1:** CHANGELOG 미출시 기능의 연결 줄을 `유니크 연결은 필요한 증강이 3장인 조합을 2장만 모아도 완성`으로 바꾸고, `3장 조합 타짜·앙코르·명사수·토벌대·만능 손·역습 추가`, `행운 축적은 황금 원·무지개 원으로도 쌓임`, `아이템 애호가는 라운드 시작 3초 뒤 아이템 1개 발동`을 추가.
- [ ] **Step 2:** HANDOFF 15행의 "연결은 일반 분류 6개의 증강 종류 수에 각각 +1을 준다"를 새 규칙으로 교체.
- [ ] **Step 3:** `npm run typecheck`, `npm run build`, `npm test` 모두 통과 확인.
- [ ] **Step 4: 커밋** `docs: 연결·3장 조합 개편 변경 기록과 인수인계 갱신`
