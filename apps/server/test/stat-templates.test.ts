import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STAT_TEMPLATES,
  applyStatTemplateVariables,
  displayLabelForVariable,
  getStatTemplate,
  getStatTemplateRef,
  statRoleSchema,
  statTemplatePromptPayload,
  statTemplateSchema,
  statTemplateVariableSchema,
  templateInitialVariables,
} from '@novel-game/contracts';

test('shipped templates parse and expose four presets', () => {
  assert.equal(STAT_TEMPLATES.length, 4);
  for (const template of STAT_TEMPLATES) {
    const again = statTemplateSchema.parse(template);
    assert.equal(again.id, template.id);
    assert.equal(again.version, 1);
    assert.ok(again.variables.length >= 3);
  }
  assert.ok(getStatTemplate('xianxia_pressure'));
  assert.ok(getStatTemplate('mystery_deduction'));
  assert.ok(getStatTemplate('trade_venture'));
  assert.ok(getStatTemplate('relationship_drama'));
  assert.equal(getStatTemplate('nope'), undefined);
});

test('templateInitialVariables compiles to engine-native record', () => {
  const template = getStatTemplate('trade_venture')!;
  const vars = templateInitialVariables(template);
  assert.deepEqual(vars, {
    coin: 2,
    reputation: 0,
    risk: 0,
    has_cargo: false,
  });
});

test('applyStatTemplateVariables does not overwrite author keys', () => {
  const template = getStatTemplate('mystery_deduction')!;
  const merged = applyStatTemplateVariables(template, { clues: 3, custom_note: 'keep' });
  assert.equal(merged.clues, 3);
  assert.equal(merged.custom_note, 'keep');
  assert.equal(merged.suspicion, 0);
  assert.equal(merged.has_alibi, false);
});

test('roles are a closed set and flag/resource typing is enforced', () => {
  assert.deepEqual(statRoleSchema.options, ['resource', 'relationship', 'flag', 'progress', 'pressure']);
  assert.throws(() => statTemplateVariableSchema.parse({
    name: 'bad_flag', type: 'number', initial: 0, role: 'flag',
  }));
  assert.throws(() => statTemplateVariableSchema.parse({
    name: 'bad_resource', type: 'boolean', initial: false, role: 'resource',
  }));
  assert.throws(() => statTemplateSchema.parse({
    id: 'dup', version: 1, label: 'x', blurb: 'y', promptHint: 'z',
    variables: [
      { name: 'a', type: 'number', initial: 0, role: 'resource' },
      { name: 'a', type: 'number', initial: 1, role: 'pressure' },
    ],
  }));
});

test('getStatTemplateRef and prompt payload carry version', () => {
  const ref = getStatTemplateRef('xianxia_pressure');
  assert.deepEqual(ref, { statTemplateId: 'xianxia_pressure', statTemplateVersion: 1 });
  const payload = statTemplatePromptPayload(getStatTemplate('xianxia_pressure')!);
  assert.equal(payload.statTemplateId, 'xianxia_pressure');
  assert.equal(payload.statTemplateVersion, 1);
  assert.ok(payload.preferredVariables.some(v => v.name === 'qi' && v.role === 'resource'));
});

test('displayLabelForVariable prefers matching template then falls back', () => {
  assert.equal(displayLabelForVariable('qi', 'xianxia_pressure', 1), '修为');
  assert.equal(displayLabelForVariable('unknown_var'), 'unknown_var');
  // version mismatch still allows name-based fallback across catalog
  assert.equal(displayLabelForVariable('coin', 'trade_venture', 99), '银两');
});
