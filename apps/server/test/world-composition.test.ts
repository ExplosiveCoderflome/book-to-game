import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCKS, type WorldContent, type WorldCompositionOperation, type BlockSpec } from '@novel-game/contracts';
import { WorldService, SqliteWorldRepository, validateWorldComposition, applyWorldComposition, validateSelectedBlocks } from '../src/modules/worlds/index.js';
import { BlockLibraryService, SqliteBlockCatalogRepository } from '../src/modules/block-library/index.js';
import { openDatabase } from '../src/platform/database.js';
import { AppError } from '../src/shared/errors.js';
import { content, source } from './helpers/open-fixture.js';
import { validateWorldCompositionInputSchema } from '@novel-game/contracts';

for (const theme of ['渡口悬疑', '山谷经营']) {
  test(`world composition atomically composes linked entities for ${theme}`, () => {
    const db = openDatabase(':memory:');
    try {
      const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
      const library = new BlockLibraryService(new SqliteBlockCatalogRepository(db));
      const base: WorldContent = {...content(), title: theme};
      const draft = worlds.create({sourceId: source.id, content: base});
      const selections: {blockId: string; version: number; params: Record<string, unknown>}[] = [];
      const operations = [
        {entity: 'fact', op: 'add', value: {id: 'clue_found', label: '线索', description: '', kind: 'clue', initialValue: false, playerKnown: false, origin: 'adapted', evidence: []}},
        {entity: 'location', op: 'add', value: {id: 'archive', title: '档案室', text: '尘封的档案。', origin: 'adapted', evidence: []}},
        {entity: 'action', op: 'add', value: {id: 'inspect_archive', label: '检查档案', description: '', locationId: 'archive', availableWhen: [], requires: [], blockedReason: '无法检查', risk: '', timeCost: 1, once: true, effects: [{kind: 'set', factId: 'clue_found', value: true}], text: '找到线索。', origin: 'adapted', evidence: []}},
        {entity: 'storylet', op: 'add', value: {id: 'archive_card', title: '档案中的线索', locationIds: ['archive'], when: [{kind: 'fact', factId: 'clue_found', value: true}], text: '线索拼合。', choices: [{id: 'leave', label: '离开', timeCost: 1, effects: [{kind: 'ending', endingId: 'clue_ending'}], text: '离开档案室。'}]}},
        {entity: 'ending', op: 'add', value: {id: 'clue_ending', title: '真相', text: '真相大白。', when: [{kind: 'fact', factId: 'clue_found', value: true}]}},
      ] satisfies WorldCompositionOperation[];
      const input = {worldId: draft.id, expectedVersion: 1, operations, blockSelections: selections};
      const before = worlds.get(draft.id);
      const preview = validateWorldComposition(worlds, library, input);
      assert.equal(preview.valid, true);
      assert.equal(worlds.get(draft.id).version, before.version, 'preview is read-only');
      const result = applyWorldComposition(worlds, library, input);
      assert.equal(result.draft.version, 2, 'composite apply bumps exactly once');
      assert.equal(result.draft.content.actions.at(-1)?.locationId, 'archive');
      assert.equal(result.draft.content.storylets?.at(-1)?.choices[0]?.effects[0]?.kind, 'ending');
      assert.deepEqual(result.draft.content.blockSelections, []);
      assert.equal(BLOCKS.length > 0, true);
    } finally { db.close(); }
  });
}

test('world composition rejects dangling references, duplicate IDs, bad blocks, fake paths and stale versions without writes', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const library = new BlockLibraryService(new SqliteBlockCatalogRepository(db));
    const draft = worlds.create({sourceId: source.id, content: content()});
    const op = {entity: 'location', op: 'add', value: {id: 'new_place', title: '新地点', text: '正文', origin: 'adapted', evidence: []}};
    const run = (operations: unknown[], blockSelections: unknown[] = [], expectedVersion = 1) => validateWorldComposition(worlds, library,
      {worldId: draft.id, expectedVersion, operations, blockSelections} as never);
    assert.throws(() => run([op, op]), /location ID 已存在/);
    assert.throws(() => run([op], [{blockId: 'unknown', version: 1, params: {}}]), /目录条目不存在/);
    assert.throws(() => run([op], [{blockId: 'clock', version: 9, params: {unit: 'day', limit: 8}}]), (error: unknown) => error instanceof AppError && error.code === 'BLOCK_VERSION_CONFLICT');
    assert.throws(() => run([op], [], 2), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT');
    assert.throws(() => validateWorldCompositionInputSchema.parse({worldId: draft.id, expectedVersion: 1,
      operations: [{entity: 'location', op: 'replace', id: 'dock', path: 'locations.0.title', value: {id: 'dock'}}], blockSelections: []}));
    assert.throws(() => run([{entity: 'action', op: 'add', value: {id: 'bad', label: '坏行动', locationId: 'missing', availableWhen: [], requires: [], blockedReason: '', risk: '', timeCost: 1, once: true, effects: [{kind: 'set', factId: 'absent', value: true}], text: '坏内容', origin: 'adapted', evidence: []}}]));
    assert.equal(worlds.get(draft.id).version, 1);
    assert.deepEqual(worlds.get(draft.id).content, content());
  } finally { db.close(); }
});

test('block requirements are checked against the final candidate and omitted selections preserve bindings', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const library = new BlockLibraryService(new SqliteBlockCatalogRepository(db));
    const base = content();
    base.clock = {unit: 'month', startYear: 1, startMonth: 1, limitMonths: 12};
    base.blockSelections = [{blockId: 'clock', version: 1, params: {unit: 'month', limit: 12, countdown_resource: 'days'}}];
    const draft = worlds.create({sourceId: source.id, content: base});
    const preserved = validateWorldComposition(worlds, library, {worldId: draft.id, expectedVersion: 1,
      operations: [{entity: 'ending', op: 'add', value: {id: 'extra', title: '另一个结局', text: '完成。', when: []}}]});
    assert.deepEqual(preserved.candidate.blockSelections, base.blockSelections);
    assert.throws(() => validateWorldComposition(worlds, library, {worldId: draft.id, expectedVersion: 1,
      operations: [{entity: 'location', op: 'remove', id: 'dock'}], blockSelections: base.blockSelections}));
    const preview = validateWorldComposition(worlds, library, {worldId: draft.id, expectedVersion: 1,
      operations: [{entity: 'ending', op: 'add', value: {id: 'another', title: '再会', text: '再会。', when: []}}]});
    assert.deepEqual(preview.candidate.blockSelections, base.blockSelections, 'preview keeps the locked catalog receipt');
    assert.deepEqual(worlds.get(draft.id).content.blockSelections, base.blockSelections, 'preview does not persist candidate edits');
    assert.equal(library.get('block', 'clock').version, 1);
  } finally { db.close(); }
});

test('shared block parameter validation preserves optional/default rules and rejects invalid numbers', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const library = new BlockLibraryService(new SqliteBlockCatalogRepository(db));
    const base = content();
    base.clock = {unit: 'month', startYear: 1, startMonth: 1, limitMonths: 12};
    const draft = worlds.create({sourceId: source.id, content: base});
    const original = library.get('block', 'clock');
    const optionalSpec = {...original.data, id: 'test-optional-params', requires: [], params: [
      {key: 'optional_text', label: '可选文本', type: 'string' as const, required: false},
      {key: 'required_count', label: '必填数字', type: 'integer' as const},
      {key: 'count', label: '默认数量', type: 'integer' as const, default: 4},
      {key: 'mode', label: '枚举', type: 'select' as const, options: ['first', 'second']},
      {key: 'ratio', label: '比例', type: 'number' as const},
    ]} satisfies BlockSpec;
    library.upsert('block', {id: optionalSpec.id, expectedVersion: 0, data: optionalSpec});
    const selection = (params: Record<string, unknown>) => [{blockId: optionalSpec.id, version: 1, params}];
    const valid = validateSelectedBlocks(base, selection({required_count: 2, ratio: 1.5}), library);
    assert.deepEqual(valid[0]?.params, {required_count: 2, count: 4, mode: 'first', ratio: 1.5});
    assert.throws(() => validateSelectedBlocks(base, selection({ratio: 1}), library), /缺少参数 required_count/);
    assert.throws(() => validateSelectedBlocks(base, selection({required_count: 2, ratio: Number.POSITIVE_INFINITY}), library), /参数类型\/选项错误：ratio/);
    assert.throws(() => validateSelectedBlocks(base, selection({required_count: 2, ratio: 1, mode: 'invalid'}), library), /参数类型\/选项错误：mode/);
    const selectedByIdea = validateSelectedBlocks(base, selection({required_count: 2, ratio: 1.5}), library);
    assert.deepEqual(selectedByIdea, valid, 'idea creation and composition use the same public parameter validator');
  } finally { db.close(); }
});

test('end-condition operations use stable EndCondition records in their existing win/lose package', () => {
  const db = openDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const library = new BlockLibraryService(new SqliteBlockCatalogRepository(db));
    const base = content();
    base.endConditions = {source: 'author-custom', severity: 'reshapes-game',
      win: [{id: 'win_old', kind: 'win', label: '通行', when: [{kind: 'fact', factId: 'permit', value: true}], endingId: 'success'}],
      lose: [{id: 'lose_old', kind: 'lose', label: '错过', when: [{kind: 'time', atLeast: 6}], endingId: 'success'}]};
    const draft = worlds.create({sourceId: source.id, content: base});
    const common = {worldId: draft.id, expectedVersion: 1};
    const added = validateWorldComposition(worlds, library, {...common, operations: [
      {entity: 'end-condition', op: 'add', value: {id: 'win_new', kind: 'win', label: '解谜', when: [{kind: 'fact', factId: 'secret', value: true}], endingId: 'success'}},
      {entity: 'end-condition', op: 'add', value: {id: 'lose_new', kind: 'lose', label: '错过期限', when: [{kind: 'time', atLeast: 6}], endingId: 'success'}},
    ]});
    assert.equal(added.candidate.endConditions?.win.some(item => item.id === 'win_new'), true);
    assert.equal(added.candidate.endConditions?.lose.some(item => item.id === 'lose_new'), true);
    const replaced = validateWorldComposition(worlds, library, {...common, operations: [
      {entity: 'end-condition', op: 'replace', id: 'win_old', value: {id: 'win_old', kind: 'win', label: '改名', when: [{kind: 'fact', factId: 'permit', value: true}], endingId: 'success'}},
      {entity: 'end-condition', op: 'replace', id: 'lose_old', value: {id: 'lose_old', kind: 'lose', label: '错过期限', when: [{kind: 'time', atLeast: 8}], endingId: 'success'}},
    ]});
    assert.equal(replaced.candidate.endConditions?.win[0]?.label, '改名');
    assert.equal(replaced.candidate.endConditions?.lose.find(item => item.id === 'lose_old')?.label, '错过期限');
    assert.throws(() => validateWorldComposition(worlds, library, {...common, operations: [
      {entity: 'end-condition', op: 'add', value: {id: 'bad_win', kind: 'win', label: '无结局', when: [{kind: 'fact', factId: 'permit', value: true}], endingId: 'missing_ending'}},
    ]}), /引用|ending|结局/);
    assert.throws(() => validateWorldComposition(worlds, library, {...common, operations: [
      {entity: 'end-condition', op: 'replace', id: 'win_old', value: {id: 'win_old', kind: 'lose', label: '错组', when: [{kind: 'time', atLeast: 1}], endingId: 'success'}},
    ]}), /分组/);
    assert.equal(worlds.get(draft.id).version, 1);
  } finally { db.close(); }
});
