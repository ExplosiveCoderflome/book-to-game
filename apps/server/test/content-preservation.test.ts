import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {WorldService, SqliteWorldRepository, checkWorldPreservation} from '../src/modules/worlds/index.js';
import {openDatabase} from '../src/platform/database.js';
import {AppError} from '../src/shared/errors.js';
import {content, source} from './helpers/open-fixture.js';
import {canonicalJson} from '../src/shared/canonical-json.js';

test('preservation baseline blocks deletion and large anchor compression atomically, while allowing additions and small edits', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = content();
    initial.locations[0]!.text = '旧地点正文'.repeat(80);
    const draft = worlds.create({sourceId: source.id, content: initial});
    const old = initial.locations[0]!.text;
    assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 1}).baselineEstablished, true);
    const withoutAction = structuredClone(initial); withoutAction.actions = withoutAction.actions.filter(item => item.id !== 'wait');
    assert.throws(() => worlds.applyContent(draft.id, {version: 1, content: withoutAction}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');
    assert.equal(worlds.get(draft.id).version, 1);
    assert.equal(worlds.getPreservationBaseline(draft.id)?.version, 1, 'rejected first edit retains original server-captured baseline');
    const minor = structuredClone(initial); minor.locations[0]!.text = `${old} 补充。`;
    const updated = worlds.applyContent(draft.id, {version: 1, content: minor});
    assert.equal(updated.version, 2);
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    assert.equal(baseline.version, 1);
    assert.throws(() => worlds.update(draft.id, {version: 2, content: {...minor, locations: minor.locations.map(item => item.id === minor.locations[0]!.id ? {...item, text: '缩短'} : item)}}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');
    assert.equal(worlds.get(draft.id).version, 2);
    const added = {...minor, locations: [...minor.locations, {...minor.locations[0]!, id: 'extra-location', title: '新增地点'}]};
    assert.equal(worlds.update(draft.id, {version: 2, content: added}).version, 3);
  } finally {db.close();}
});

test('preservation checker reports server baseline and hash differences without writing', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const draft = worlds.create({sourceId: source.id, content: content()});
    const edited = structuredClone(draft.content);
    edited.locations[0]!.text = '历史地点正文'.repeat(80);
    worlds.update(draft.id, {version: 1, content: edited});
    const secondEdit = structuredClone(worlds.get(draft.id).content);
    secondEdit.locations[0]!.text = `${secondEdit.locations[0]!.text}${'补充。'.repeat(80)}`;
    worlds.update(draft.id, {version: 2, content: secondEdit});
    const before = worlds.get(draft.id);
    const report = checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 3});
    assert.equal(report.baselineEstablished, true);
    assert.equal(report.baselineVersion, 1);
    assert.notEqual(report.baselineHash, report.currentHash);
    assert.equal(worlds.get(draft.id).version, before.version);
    assert.throws(() => checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 2}), /草稿已更新/);
  } finally {db.close();}
});

test('preservation blocks action-rule edits, short body deletion, location variants, and stale writes do not capture a baseline', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = content();
    initial.locations[0]!.text = '短正文';
    const draft = worlds.create({sourceId: source.id, content: initial});

    const cleared = structuredClone(initial);
    cleared.locations[0]!.text = '';
    assert.throws(() => worlds.update(draft.id, {version: 1, content: cleared}));
    assert.equal(worlds.get(draft.id).version, 1);

    const changedRoute = structuredClone(initial);
    changedRoute.actions.find(action => action.id === 'to_market')!.effects = [{kind: 'move', locationId: 'gate'}];
    assert.throws(() => worlds.update(draft.id, {version: 1, content: changedRoute}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');

    const withVariant = structuredClone(initial);
    withVariant.locations[0]!.textVariants = [{when: [{kind: 'time', atLeast: 1}], text: '原地点变体'}];
    const variantDraft = worlds.create({sourceId: source.id, content: withVariant});
    const removedVariant = structuredClone(withVariant);
    removedVariant.locations[0]!.textVariants = undefined;
    assert.throws(() => worlds.update(variantDraft.id, {version: 1, content: removedVariant}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');

    const staleDraft = worlds.create({sourceId: source.id, content: initial});
    const staleBaseline = worlds.getPreservationBaseline(staleDraft.id);
    assert.throws(() => worlds.update(staleDraft.id, {version: 9, content: initial}),
      (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT');
    assert.deepEqual(worlds.getPreservationBaseline(staleDraft.id), staleBaseline, 'stale update must not change the creation baseline');
  } finally {db.close();}
});

test('accepted additions remain protected across later updates', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = content();
    const draft = worlds.create({sourceId: source.id, content: initial});
    const added = {...structuredClone(initial), actions: [...initial.actions, {...initial.actions[0]!, id: 'new-action', label: '新增玩法'}]};
    worlds.update(draft.id, {version: 1, content: added});
    const removed = structuredClone(worlds.get(draft.id).content);
    removed.actions = removed.actions.filter(action => action.id !== 'new-action');
    assert.throws(() => worlds.update(draft.id, {version: 2, content: removed}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');
  } finally {db.close();}
});

test('default protection permits numeric tuning and additive storylet choices/effects, then protects accepted additions', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = content();
    const card = {id: 'market-card', title: '集市', text: '集市中。', locationIds: ['market'], when: [], weight: {base: 1}, repeat: {cooldownTurns: 0},
      choices: [{id: 'buy', label: '购买', timeCost: 1, text: '买下物品。', effects: [{kind: 'resource' as const, resourceId: 'coins', delta: -1}]}]};
    initial.storylets = [card];
    const draft = worlds.create({sourceId: source.id, content: initial});

    const tuned = structuredClone(initial);
    const tunedAction = tuned.actions.find(action => action.id === 'to_market')!;
    tunedAction.timeCost = (tunedAction.timeCost ?? 0) + 1;
    const tunedCard = tuned.storylets!.find(item => item.id === card.id)!;
    tunedCard.weight!.base += 1;
    const tunedChoice = tunedCard.choices[0]!;
    tunedChoice.effects = tunedChoice.effects.map(effect => effect.kind === 'resource' ? {...effect, delta: (effect.delta ?? 0) - 1} : effect);
    worlds.update(draft.id, {version: 1, content: tuned});
    const afterTune = worlds.getPreservationBaseline(draft.id)!;

    const expanded = structuredClone(worlds.get(draft.id).content);
    const expandedCard = expanded.storylets!.find(item => item.id === card.id)!;
    expandedCard.choices.push({...expandedCard.choices[0]!, id: 'new-choice', label: '新增选择'});
    expandedCard.choices[0]!.effects.push({kind: 'resource', resourceId: 'coins', delta: 1});
    worlds.update(draft.id, {version: 2, content: expanded});
    const afterAdditions = worlds.getPreservationBaseline(draft.id)!;
    assert.notEqual(afterAdditions.hash, afterTune.hash, 'server baseline fingerprint advances with accepted protections');

    const checker = checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 3});
    assert.equal(checker.status, 'pass');
    assert.deepEqual(checker.findings, []);

    const reportDb = openDatabase(':memory:');
    try {
      const reportRepository = new SqliteWorldRepository(reportDb);
      const reportWorlds = new WorldService(reportRepository, {get: () => structuredClone(source)});
      const reportDraft = reportWorlds.create({sourceId: source.id, content: expanded});
      reportWorlds.update(reportDraft.id, {version: 1, content: {...expanded, title: '正常增量写入'}});
      const baseline = reportWorlds.getPreservationBaseline(reportDraft.id)!;
      const deliberatelyDamaged = structuredClone(reportWorlds.get(reportDraft.id).content);
      deliberatelyDamaged.storylets![0]!.choices = deliberatelyDamaged.storylets![0]!.choices.filter(choice => choice.id !== 'new-choice');
      const damagedDraft = {...reportWorlds.get(reportDraft.id), content: deliberatelyDamaged, version: 3};
      reportRepository.updateDraft(damagedDraft, 2, baseline);
      const report = checkWorldPreservation(reportWorlds, {worldId: reportDraft.id, expectedVersion: 3});
      assert.equal(report.status, 'fail');
      assert.ok(report.findings.some(finding => finding.code === 'gameplay-removed'));
    } finally {reportDb.close();}

    const removedNewChoice = structuredClone(worlds.get(draft.id).content);
    removedNewChoice.storylets!.find(item => item.id === card.id)!.choices = removedNewChoice.storylets!.find(item => item.id === card.id)!.choices.filter(choice => choice.id !== 'new-choice');
    assert.throws(() => worlds.update(draft.id, {version: 3, content: removedNewChoice}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');
    const failedReport = checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 3});
    assert.equal(failedReport.status, 'pass');

    const removedEffect = structuredClone(worlds.get(draft.id).content);
    const selected = removedEffect.storylets!.find(item => item.id === card.id)!.choices[0]!;
    selected.effects = selected.effects.filter(effect => effect.kind !== 'resource' || effect.resourceId !== 'coins');
    assert.throws(() => worlds.update(draft.id, {version: 3, content: removedEffect}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');
  } finally {db.close();}
});

test('storylet body polish and condition additions are accepted while removing original conditions is blocked', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = content();
    initial.storylets = [{id: 's', title: '卡', text: '原正文', locationIds: ['market'], when: [{kind: 'time', atLeast: 1}], weight: {base: 1}, repeat: {cooldownTurns: 0}, textVariants: ['变体'], textCases: [{id: 'c', when: [{kind: 'time', atLeast: 1}], text: '分支正文'}], choices: [{id: 'go', label: '继续', timeCost: 0, text: '继续前进', effects: []}]}];
    const draft = worlds.create({sourceId: source.id, content: initial});
    const polished = structuredClone(initial);
    polished.storylets![0]!.text = '润色后的原正文';
    polished.storylets![0]!.when!.push({kind: 'resource', resourceId: 'coins', atLeast: 1});
    assert.equal(worlds.update(draft.id, {version: 1, content: polished}).version, 2);
    const removed = structuredClone(polished);
    removed.storylets![0]!.when = removed.storylets![0]!.when!.slice(1);
    assert.throws(() => worlds.update(draft.id, {version: 2, content: removed}),
      (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED');
  } finally {db.close();}
});

test('read-only preservation report fails on compression and repeated frames written around the guard', () => {
  const db = openDatabase(':memory:');
  try {
    const repository = new SqliteWorldRepository(db);
    const worlds = new WorldService(repository, {get: () => structuredClone(source)});
    const initial = content();
    initial.locations[0]!.text = '长正文内容。'.repeat(80);
    initial.storylets = [{id: 's', title: '卡', text: '甲'.repeat(80), locationIds: ['market'], when: [], weight: {base: 1}, repeat: {cooldownTurns: 0}, choices: [{id: 'go', label: '继续', timeCost: 0, text: '继续前进', effects: []}]}];
    const draft = worlds.create({sourceId: source.id, content: initial});
    worlds.update(draft.id, {version: 1, content: {...initial, title: '建立基线'}});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    const damaged = structuredClone(worlds.get(draft.id));
    damaged.content.locations[0]!.text = '已压缩';
    damaged.content.storylets![0]!.text = '相同';
    damaged.content.storylets![0]!.textVariants = ['相同', '相同'];
    damaged.version = 3;
    repository.updateDraft(damaged, 2, baseline);
    const report = checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 3});
    assert.equal(report.status, 'fail');
    assert.ok(report.findings.some(finding => finding.code === 'anchor-compressed'));
    assert.ok(report.findings.some(finding => finding.code === 'repeated-frames'));
  } finally {db.close();}
});

test('legacy baseline with missing fields or non-JSON gameplay signature is unsupported and never passes', () => {
  const db = openDatabase(':memory:');
  try {
    const repository = new SqliteWorldRepository(db);
    const worlds = new WorldService(repository, {get: () => structuredClone(source)});
    const initial = content();
    initial.locations[0]!.text = '足够长的正文。'.repeat(50);
    const draft = worlds.create({sourceId: source.id, content: initial});
    worlds.update(draft.id, {version: 1, content: {...initial, title: '捕获基线'}});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    const {anchorLengths: _lengths, ...legacy} = baseline;
    db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(legacy), draft.id);
    const report = checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 2});
    assert.equal(report.status, 'unsupported');
    assert.ok(report.findings.some(finding => finding.code === 'baseline-unsupported'));
    const malformed = {...baseline, gameplay: {...baseline.gameplay, 'storylets:legacy': 'old-hash-format'}};
    db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(malformed), draft.id);
    assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 2}).status, 'unsupported');
  } finally {db.close();}
});

const preservationRequired = (error: unknown) => error instanceof AppError && error.code === 'WORLD_PRESERVATION_REQUIRED';
function titledContent() {
  const initial = content();
  initial.storylets = [{id: 'card', title: '原题', text: '原正文', locationIds: ['market'], when: [{kind: 'known', factId: 'secret'}],
    choices: [{id: 'go', label: '继续', timeCost: 1, text: '原结果', effects: [{kind: 'set', factId: 'bell', value: true}]}]}];
  return initial;
}
function routeHash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

test('storylet title-only polish preserves gameplay across successive updates without accumulating title signatures', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const draft = worlds.create({sourceId: source.id, content: titledContent()});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    for (const version of [1, 2]) {
      const edited = structuredClone(worlds.get(draft.id).content);
      edited.storylets![0]!.title = `新题${version}`;
      worlds.update(draft.id, {version, content: edited});
      assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: version + 1}).status, 'pass');
      assert.deepEqual(worlds.getPreservationBaseline(draft.id)!.gameplay, baseline.gameplay);
      assert.deepEqual(worlds.getPreservationBaseline(draft.id)!.anchors, baseline.anchors);
    }
    const changed = structuredClone(worlds.get(draft.id).content);
    changed.storylets![0]!.locationIds = ['gate'];
    assert.throws(() => worlds.update(draft.id, {version: 3, content: changed}), preservationRequired);
  } finally {db.close();}
});

test('legacy title signatures convert only with exact correspondence and preserve all other historical protections', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const draft = worlds.create({sourceId: source.id, content: titledContent()});
    const expanded = structuredClone(draft.content);
    expanded.locations[0]!.text += ' 曾经补充';
    expanded.actions.push({...expanded.actions[0]!, id: 'historical-action'});
    worlds.update(draft.id, {version: 1, content: expanded});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    const {formatVersion: _format, ...legacy} = structuredClone(baseline);
    const {title, text: _text, when: _when, choices: _choices, ...route} = expanded.storylets![0]!;
    const newRoute = routeHash(route), oldRoute = routeHash({...route, title});
    const signatures = JSON.parse(legacy.gameplay['storylets:card']!) as string[];
    assert.ok(signatures.includes(newRoute));
    legacy.gameplay['storylets:card'] = JSON.stringify(signatures.map(item => item === newRoute ? oldRoute : item).sort());
    const install = (value: unknown) => db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(value), draft.id);
    install(legacy);
    const stored = worlds.getPreservationBaseline(draft.id);
    assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 2}).status, 'pass');
    assert.deepEqual(worlds.getPreservationBaseline(draft.id), stored, 'checker conversion is read-only');
    const edited = structuredClone(expanded); edited.storylets![0]!.title = '新题';
    for (const broken of [
      {...legacy, formatVersion: 99},
      {...legacy, gameplay: {...legacy.gameplay, 'storylets:card': JSON.stringify(signatures)}},
      {...legacy, gameplay: {...legacy.gameplay, 'storylets:card': JSON.stringify([...JSON.parse(legacy.gameplay['storylets:card']!), 'unmatched-history'])}},
    ]) {
      install(broken);
      assert.throws(() => worlds.update(draft.id, {version: 2, content: edited}), preservationRequired);
      assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 2}).status, 'unsupported');
      assert.deepEqual(worlds.getPreservationBaseline(draft.id), broken);
      assert.equal(worlds.get(draft.id).version, 2);
    }
    install(legacy);
    worlds.update(draft.id, {version: 2, content: edited});
    const converted = worlds.getPreservationBaseline(draft.id)!;
    assert.equal(converted.formatVersion, 2);
    assert.deepEqual(converted.gameplay, baseline.gameplay);
    assert.deepEqual(converted.anchors, baseline.anchors);
    assert.deepEqual(converted.anchorLengths, baseline.anchorLengths);
    assert.deepEqual(converted.entityIds, baseline.entityIds);
    assert.equal(converted.capturedAt, baseline.capturedAt);
    const removed = structuredClone(edited); removed.actions.pop();
    assert.throws(() => worlds.update(draft.id, {version: 3, content: removed}), preservationRequired);
    assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 3}).status, 'pass');
  } finally {db.close();}
});

test('dangling move repair changes one exact reference, keeps history and protects the repaired target', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = titledContent(); initial.actions[0]!.effects = [{kind: 'move', locationId: 'absent'}];
    const draft = worlds.create({sourceId: source.id, content: initial});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    const repaired = structuredClone(draft.content); repaired.actions[0]!.effects[0] = {kind: 'move', locationId: 'market'};
    const updated = worlds.update(draft.id, {version: 1, content: repaired});
    assert.deepEqual(updated.content, repaired);
    assert.equal(worlds.validate(draft.id).valid, true);
    const nextBaseline = worlds.getPreservationBaseline(draft.id)!;
    assert.deepEqual(nextBaseline.anchors, baseline.anchors);
    assert.deepEqual(nextBaseline.anchorLengths, baseline.anchorLengths);
    assert.deepEqual(nextBaseline.entityIds, baseline.entityIds);
    for (const key of Object.keys(baseline.gameplay).filter(key => key !== 'actions:wait')) assert.equal(nextBaseline.gameplay[key], baseline.gameplay[key]);
    assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 2}).status, 'pass');
    assert.throws(() => worlds.update(draft.id, {version: 1, content: repaired}), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT');
    assert.deepEqual(worlds.getPreservationBaseline(draft.id), nextBaseline);
    const polished = structuredClone(repaired); polished.storylets![0]!.title = '修复后润色';
    worlds.update(draft.id, {version: 2, content: polished});
    for (const effects of [[{kind: 'move' as const, locationId: 'gate'}], [{kind: 'set' as const, factId: 'bell', value: false}]]) {
      const removed = structuredClone(polished); removed.actions[0]!.effects = effects;
      assert.throws(() => worlds.update(draft.id, {version: 3, content: removed}), preservationRequired);
    }
    const deleted = structuredClone(polished); deleted.actions[0]!.effects = [];
    assert.throws(() => worlds.update(draft.id, {version: 3, content: deleted}), 'schema also blocks deleting the only action effect');
    assert.equal(checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: 3}).status, 'pass');
  } finally {db.close();}
});

test('dangling repair refuses cross-kind, extra edits, new targets, reordered effects and incomplete candidates atomically', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = titledContent(); initial.actions[0]!.effects = [{kind: 'move', locationId: 'absent'}, {kind: 'set', factId: 'bell', value: false}];
    const draft = worlds.create({sourceId: source.id, content: initial});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    const repaired = structuredClone(draft.content); repaired.actions[0]!.effects[0] = {kind: 'move', locationId: 'market'};
    const crossKind = structuredClone(draft.content); crossKind.actions[0]!.effects[0] = {kind: 'set', factId: 'bell', value: false};
    const title = structuredClone(repaired); title.storylets![0]!.title = '顺带改题';
    const condition = structuredClone(repaired); condition.storylets![0]!.when = [];
    const effect = structuredClone(repaired); effect.actions[0]!.effects.pop();
    const body = structuredClone(repaired); body.actions[0]!.text += '顺带改正文';
    const reordered = structuredClone(repaired); reordered.actions[0]!.effects.reverse();
    const newTarget = structuredClone(repaired); newTarget.locations.push({...newTarget.locations[0]!, id: 'new-target'}); newTarget.actions[0]!.effects[0] = {kind: 'move', locationId: 'new-target'};
    for (const candidate of [crossKind, title, condition, effect, body, reordered, newTarget]) {
      assert.throws(() => worlds.update(draft.id, {version: 1, content: candidate}), preservationRequired);
      assert.deepEqual(worlds.get(draft.id), draft);
      assert.deepEqual(worlds.getPreservationBaseline(draft.id), baseline);
    }
    // Fixing the move alone must not hide a second pre-existing validation error.
    const invalid = structuredClone(initial); invalid.sourceChapterIds = ['absent'];
    const invalidDraft = worlds.create({sourceId: source.id, content: invalid});
    const invalidBaseline = worlds.getPreservationBaseline(invalidDraft.id);
    invalid.actions[0]!.effects[0] = {kind: 'move', locationId: 'market'};
    assert.throws(() => worlds.update(invalidDraft.id, {version: 1, content: invalid}), (error: unknown) => error instanceof AppError && error.code === 'INVALID_WORLD');
    assert.deepEqual(worlds.get(invalidDraft.id), invalidDraft);
    assert.deepEqual(worlds.getPreservationBaseline(invalidDraft.id), invalidBaseline);
  } finally {db.close();}
});

test('dangling repair refuses ambiguous IDs and unverified baseline substitutions', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    for (const ambiguity of ['location', 'action', 'effect', 'baseline'] as const) {
      const initial = content(); initial.actions[0]!.effects = [{kind: 'move', locationId: 'absent'}];
      if (ambiguity === 'location') initial.locations.push({...initial.locations[0]!});
      if (ambiguity === 'action') initial.actions.push({...initial.actions[0]!});
      if (ambiguity === 'effect') initial.actions[0]!.effects.push({kind: 'move', locationId: 'absent'});
      const draft = worlds.create({sourceId: source.id, content: initial});
      if (ambiguity === 'baseline') {
        const baseline = worlds.getPreservationBaseline(draft.id)!;
        baseline.gameplay['actions:wait'] = JSON.stringify(['unmatched-history']);
        db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(baseline), draft.id);
      }
      const baseline = worlds.getPreservationBaseline(draft.id);
      const repaired = structuredClone(draft.content); repaired.actions[0]!.effects[0] = {kind: 'move', locationId: 'market'};
      assert.throws(() => worlds.update(draft.id, {version: 1, content: repaired}), preservationRequired, ambiguity);
      assert.deepEqual(worlds.get(draft.id), draft);
      assert.deepEqual(worlds.getPreservationBaseline(draft.id), baseline);
    }
  } finally {db.close();}
});

test('valid move targets cannot be manufactured as missing by deleting a protected location', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const initial = content(); initial.locations.push({...initial.locations[0]!, id: 'extra-location'});
    const draft = worlds.create({sourceId: source.id, content: initial});
    const baseline = worlds.getPreservationBaseline(draft.id);
    const manufactured = structuredClone(draft.content);
    manufactured.locations = manufactured.locations.filter(location => location.id !== 'market');
    assert.throws(() => worlds.update(draft.id, {version: 1, content: manufactured}), preservationRequired);
    manufactured.actions.find(action => action.id === 'to_market')!.effects = [{kind: 'move', locationId: 'gate'}];
    assert.throws(() => worlds.update(draft.id, {version: 1, content: manufactured}), preservationRequired);
    assert.deepEqual(worlds.get(draft.id), draft);
    assert.deepEqual(worlds.getPreservationBaseline(draft.id), baseline);
  } finally {db.close();}
});

test('move repair and legacy conversion remain unpersisted when repository CAS loses a race', () => {
  const db = openDatabase(':memory:');
  try {
    const repository = new SqliteWorldRepository(db);
    const worlds = new WorldService(repository, {get: () => structuredClone(source)});
    const initial = titledContent(); initial.actions[0]!.effects = [{kind: 'move', locationId: 'absent'}];
    const draft = worlds.create({sourceId: source.id, content: initial});
    const baseline = worlds.getPreservationBaseline(draft.id)!;
    const {formatVersion: _format, ...legacy} = baseline;
    const {title, text: _text, when: _when, choices: _choices, ...route} = initial.storylets![0]!;
    legacy.gameplay = {...legacy.gameplay, 'storylets:card': JSON.stringify((JSON.parse(legacy.gameplay['storylets:card']!) as string[])
      .map(item => item === routeHash(route) ? routeHash({...route, title}) : item).sort())};
    db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(legacy), draft.id);
    const update = repository.updateDraft.bind(repository);
    let competing = structuredClone(draft);
    repository.updateDraft = (next, expected, nextBaseline) => {
      competing = {...draft, version: 2, content: {...draft.content, title: '并发写入'}};
      update(competing, 1, legacy);
      update(next, expected, nextBaseline);
    };
    const repaired = structuredClone(draft.content); repaired.actions[0]!.effects[0] = {kind: 'move', locationId: 'market'};
    assert.throws(() => worlds.update(draft.id, {version: 1, content: repaired}), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT');
    assert.deepEqual(worlds.get(draft.id), competing);
    assert.deepEqual(worlds.getPreservationBaseline(draft.id), legacy);
  } finally {db.close();}
});

test('uncaptured legacy drafts capture no baseline on rejected or stale edits', () => {
  const db = openDatabase(':memory:');
  try {
    const repository = new SqliteWorldRepository(db);
    const worlds = new WorldService(repository, {get: () => structuredClone(source)});
    const draft = worlds.create({sourceId: source.id, content: content()});
    db.prepare('DELETE FROM world_preservation_baselines WHERE draft_id=?').run(draft.id);
    const removed = structuredClone(draft.content); removed.actions.pop();
    assert.throws(() => worlds.update(draft.id, {version: 1, content: removed}), preservationRequired);
    assert.equal(worlds.getPreservationBaseline(draft.id), undefined);
    assert.throws(() => worlds.update(draft.id, {version: 9, content: draft.content}), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT');
    assert.equal(worlds.getPreservationBaseline(draft.id), undefined);
    const update = repository.updateDraft.bind(repository);
    repository.updateDraft = (next, expected, baseline) => update(next, expected + 1, baseline);
    assert.throws(() => worlds.update(draft.id, {version: 1, content: {...draft.content, title: 'CAS 失败'}}), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT');
    assert.equal(worlds.getPreservationBaseline(draft.id), undefined, 'transaction rolls back initial capture as well');
    assert.deepEqual(worlds.get(draft.id), draft);
    repository.updateDraft = update;
    worlds.update(draft.id, {version: 1, content: {...draft.content, title: '安全编辑'}});
    assert.equal(worlds.getPreservationBaseline(draft.id)?.version, 1);
  } finally {db.close();}
});
