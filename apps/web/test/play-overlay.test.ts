import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameContent, SessionView } from '@novel-game/contracts';
import { blockedEdgesForScene, choiceAvailable, playOverlayFromSession, trailFromHistory } from '../src/lib/play-overlay.ts';

const content: GameContent = {
  title: '测', mode: 'story', premise: 'p', adaptationNotes: '',
  startSceneId: 'dock',
  variables: { trust: 0, promised: false },
  scenes: [
    { id: 'dock', title: '渡口', text: 't', origin: 'adapted', evidence: [], choices: [
      { id: 'help', label: '帮忙', targetSceneId: 'dock', conditions: [{ type: 'variable.equals', variable: 'trust', value: 0 }], effects: [{ type: 'variable.increment', variable: 'trust', value: 1 }] },
      { id: 'boat', label: '过河', targetSceneId: 'end', conditions: [{ type: 'variable.gte', variable: 'trust', value: 1 }] },
      { id: 'caravan', label: '商队', targetSceneId: 'end2' },
    ]},
    { id: 'end', title: '河对岸', text: 't', origin: 'adapted', evidence: [], choices: [], ending: '渡船' },
    { id: 'end2', title: '山路', text: 't', origin: 'adapted', evidence: [], choices: [], ending: '绕路' },
  ],
};

test('trailFromHistory maps choice labels to edge keys', () => {
  const history: SessionView['history'] = [
    { turn: 0, sceneId: 'dock', text: 'start' },
    { turn: 1, sceneId: 'dock', choiceLabel: '帮忙', text: 'helped' },
    { turn: 2, sceneId: 'end', choiceLabel: '过河', text: 'crossed' },
  ];
  const trail = trailFromHistory(content, history);
  assert.deepEqual(trail.trailEdgeKeys, ['dock:help', 'dock:boat']);
  assert.deepEqual(trail.visitedSceneIds, ['dock', 'end']);
});

test('blockedEdgesForScene dims locked choices under current variables', () => {
  assert.equal(choiceAvailable(content.scenes[0]!.choices[1]!, { trust: 0, promised: false }), false);
  assert.deepEqual(blockedEdgesForScene(content, 'dock', { trust: 0, promised: false }), ['dock:boat']);
  assert.deepEqual(blockedEdgesForScene(content, 'dock', { trust: 1, promised: false }), ['dock:help']);
});

test('playOverlayFromSession highlights current scene and trail', () => {
  const session = {
    scene: { id: 'dock', title: '渡口', text: 't', choices: [{ id: 'caravan', label: '商队' }, { id: 'boat', label: '过河' }] },
    history: [
      { turn: 0, sceneId: 'dock', text: 'start' },
      { turn: 1, sceneId: 'dock', choiceLabel: '帮忙', text: 'helped' },
    ],
    variables: { trust: 1, promised: false },
  };
  const overlay = playOverlayFromSession(content, session);
  assert.equal(overlay.currentSceneId, 'dock');
  assert.deepEqual(overlay.trailEdgeKeys, ['dock:help']);
  assert.ok(overlay.visitedSceneIds.includes('dock'));
  assert.deepEqual(overlay.blockedEdgeKeys, ['dock:help']);
});
