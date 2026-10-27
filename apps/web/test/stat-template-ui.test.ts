import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAT_TEMPLATES,
  applyStatTemplateVariables,
  displayLabelForVariable,
  getStatTemplate,
  roleForVariable,
  type GameContent,
} from '@novel-game/contracts';

function stampContent(content: GameContent, templateId: string): GameContent {
  const template = getStatTemplate(templateId);
  assert.ok(template);
  return {
    ...content,
    variables: applyStatTemplateVariables(template, content.variables ?? {}),
    statTemplateId: template.id,
    statTemplateVersion: template.version,
  };
}

const base = (): GameContent => ({
  title: 'T',
  mode: 'story',
  premise: 'P',
  adaptationNotes: '',
  startSceneId: 'a',
  scenes: [
    { id: 'a', title: 'A', text: 't', origin: 'adapted', evidence: [], choices: [] },
    { id: 'b', title: 'B', text: 't', origin: 'adapted', evidence: [], choices: [] },
    { id: 'c', title: 'C', text: 't', origin: 'adapted', evidence: [], choices: [], ending: 'end' },
  ],
});

test('catalog exposes four presets for the picker', () => {
  assert.equal(STAT_TEMPLATES.length, 4);
  assert.ok(STAT_TEMPLATES.every(t => t.label && t.blurb && t.variables.length >= 1));
});

test('applying a template seeds initials and stamps id/version without overwriting existing keys', () => {
  const draft = stampContent({ ...base(), variables: { qi: 9, custom: true } }, 'xianxia_pressure');
  assert.equal(draft.statTemplateId, 'xianxia_pressure');
  assert.equal(draft.statTemplateVersion, 1);
  assert.equal(draft.variables?.qi, 9); // existing wins
  assert.equal(draft.variables?.custom, true);
  assert.equal(draft.variables?.sect_trust, 0);
  assert.equal(draft.variables?.has_token, false);
});

test('generation payload only includes statTemplateId when selected', () => {
  const empty = '';
  const chosen = 'mystery_deduction';
  const withEmpty = { mode: 'story', ...(empty ? { statTemplateId: empty } : {}) };
  const withChosen = { mode: 'story', ...(chosen ? { statTemplateId: chosen } : {}) };
  assert.equal('statTemplateId' in withEmpty, false);
  assert.equal(withChosen.statTemplateId, 'mystery_deduction');
});

test('role and display helpers resolve stamped template metadata', () => {
  assert.equal(roleForVariable('qi', 'xianxia_pressure', 1), 'resource');
  assert.equal(roleForVariable('calamity', 'xianxia_pressure', 1), 'pressure');
  assert.equal(displayLabelForVariable('qi', 'xianxia_pressure', 1), '修为');
  assert.equal(roleForVariable('custom_only', 'xianxia_pressure', 1), undefined);
  assert.equal(displayLabelForVariable('custom_only', 'xianxia_pressure', 1), 'custom_only');
});
