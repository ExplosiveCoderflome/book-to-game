import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameContent } from '@novel-game/contracts';
import { parseStoryValue, removeStoryVariable, renameStoryVariable, variableIsReferenced } from '../src/lib/story-editor.js';

const content = (variables: GameContent['variables'] = { trust: 0, name: 'A' }): GameContent => ({ title: 'T', mode: 'story', premise: 'P', adaptationNotes: '', variables, startSceneId: 'a', scenes: [{ id: 'a', title: 'A', text: 'Text', origin: 'source', evidence: [], choices: [{ id: 'go', label: 'Go', targetSceneId: 'a', conditions: [{ type: 'variable.gte', variable: 'trust', value: 1 }], effects: [{ type: 'variable.increment', variable: 'trust', value: 1 }] }] }] });

test('story value parser rejects blank and non-finite numbers', () => {
  assert.equal(parseStoryValue('number', ' 1.5 '), 1.5);
  assert.throws(() => parseStoryValue('number', ''));
  assert.throws(() => parseStoryValue('number', 'Infinity'));
});

test('referenced variables cannot be silently removed', () => {
  const draft = content();
  assert.equal(variableIsReferenced(draft, 'trust'), true);
  assert.throws(() => removeStoryVariable(draft, 'trust'), /引用/);
  assert.deepEqual(removeStoryVariable({ ...content({ trust: 0 }), scenes: [{ ...content({ trust: 0 }).scenes[0]!, choices: [] }] }, 'trust').variables, {});
});

test('renaming a variable preserves its value and updates all choice rules', () => {
  const draft = renameStoryVariable(content(), 'trust', 'reputation');
  assert.equal(draft.variables?.reputation, 0);
  assert.equal(draft.variables?.trust, undefined);
  assert.equal(draft.scenes[0]?.choices[0]?.conditions?.[0]?.variable, 'reputation');
  assert.equal(draft.scenes[0]?.choices[0]?.effects?.[0]?.variable, 'reputation');
});
