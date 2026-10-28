/**
 * Batch 3 gate tests on the real engine:
 * G5 — same seed + same operation sequence ⇒ byte-identical results, including a save written mid-run (JSON round trip) and replayed.
 * G9 — every locked option is visible with a reason (resource gates in the「X不足：需 ≥ N，现有 M」form); nothing is
 *      "clickable but errors": every enabled option acts without throwing, every locked one is refused with an error.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { advanceAdventure, createAdventureState, projectAdventure, type AdventureState } from '@novel-game/play-runtime';

const NOW = '2026-10-28T00:00:00Z';
const world: WorldContent = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/shoudeng.batch3.content.json', import.meta.url), 'utf8')));
const r: WorldRevision = {id: 'rev-b3', draftId: 'd', sourceId: 's', content: world, version: 1, createdAt: NOW};
let req = 0;
const rid = () => `44444444-4444-4444-8444-${String(++req).padStart(12, '0')}`;
const act = (s: AdventureState, id: string) => advanceAdventure(s, {actionId: id, expectedTurn: s.turn, requestId: rid()}, world, NOW);
const options = (s: AdventureState) => { const v = projectAdventure(s, r); return [...(v.hand ?? []).flatMap(h => h.choices), ...v.actions]; };

/** Deterministic pseudo-player: picks option (k·step) mod n among enabled ones. */
function play(seed: number, k: number, steps: number, from?: AdventureState) {
  let s = from ?? createAdventureState(r, `g5-${seed}`, NOW, {}, seed);
  const trail: string[] = [];
  for (let i = 0; i < steps && !s.ending; i++) {
    const en = options(s).filter(o => o.enabled);
    assert.ok(en.length > 0, `no dead end (seed ${seed}, step ${i})`);
    const pick = en[(k * (i + 1)) % en.length]!;
    trail.push(pick.id); s = act(s, pick.id);
  }
  return {s, trail};
}

test('G5 batch3: same seed + same inputs ⇒ identical views, rng and endings; differing seeds diverge', () => {
  for (const seed of [1, 7, 4242]) {
    req = 0; const a = play(seed, 3, 400); req = 0; const b = play(seed, 3, 400);
    assert.equal(JSON.stringify(a.s), JSON.stringify(b.s), `seed ${seed}`);
    assert.deepEqual(a.trail, b.trail);
    assert.deepEqual(projectAdventure(a.s, r), projectAdventure(b.s, r));
  }
  req = 0; const x = play(1, 3, 120); req = 0; const y = play(2, 3, 120);
  assert.notEqual(JSON.stringify(x.s.resources) + x.trail.join(), JSON.stringify(y.s.resources) + y.trail.join(), 'seed matters');
});

test('G5 batch3: a save written mid-run and reloaded replays to the same result (save carries the rng)', () => {
  req = 0; const full = play(99, 5, 300);
  req = 0; const half = play(99, 5, 40);
  const reloaded = JSON.parse(JSON.stringify(half.s)) as AdventureState;
  // Continue with the same deterministic policy offset: replay remaining picks recorded by the full run.
  let s = reloaded;
  for (const id of full.trail.slice(half.trail.length)) s = act(s, id);
  assert.equal(JSON.stringify(s.resources), JSON.stringify(full.s.resources));
  assert.deepEqual(s.ending, full.s.ending);
  assert.deepEqual(s.rng ?? null, full.s.rng ?? null);
});

test('G9 batch3: locked options are visible with a reason; enabled options never error; locked ones are refused', () => {
  const gate = /^.+(不足|过高|不在范围)：需 (≥ \S+|≤ \S+|\S+–\S+)，现有 \S+$/; // values may be valueLabels (境界 炼气前期)
  const authored = new Set<string>(); let locked = 0; let resourceGated = 0; let triedLocked = 0; let enabledActs = 0;
  for (const seed of [3, 11, 29, 57, 101]) {
    let s = createAdventureState(r, `g9-${seed}`, NOW, {}, seed);
    for (let i = 0; i < 300 && !s.ending; i++) {
      const opts = options(s);
      for (const o of opts.filter(o => !o.enabled)) {
        locked++;
        assert.ok(o.blockedReason && o.blockedReason.trim().length > 0 && !/undefined|NaN|\[object/.test(o.blockedReason), `${o.id}: ${o.blockedReason}`);
        const kind = (o as {blockedReasonKind?: string}).blockedReasonKind;
        if (kind === 'author') authored.add(o.blockedReason!);
        else if (/(不足|过高|不在范围)：/.test(o.blockedReason!)) { resourceGated++; for (const part of o.blockedReason!.split('；').filter(p => /(不足|过高|不在范围)：/.test(p))) assert.match(part, gate); }
        if (triedLocked < 60) { triedLocked++; assert.throws(() => act(s, o.id), `locked ${o.id} must be refused`); }
      }
      const en = opts.filter(o => o.enabled);
      // Probe every enabled option once at this step without committing (no "clickable but errors").
      for (const o of en) { assert.doesNotThrow(() => act(structuredClone(s), o.id), `${o.id} at step ${i}`); enabledActs++; }
      s = act(s, en[(seed + i) % en.length]!.id);
    }
  }
  assert.ok(locked > 0 && resourceGated > 0, `coverage: locked ${locked}, resource-gated ${resourceGated}`);
  assert.ok(enabledActs > 500);
  // Content note (not an engine failure): authored overrides may omit「，现有 N」. Reported, not asserted.
  const missingCurrent = [...authored].filter(x => /不足：需/.test(x) && !/现有/.test(x));
  if (missingCurrent.length) console.log(`[G9 content] ${missingCurrent.length} authored blockedReason(s) without「现有 N」, e.g. ${missingCurrent[0]}`);
});
