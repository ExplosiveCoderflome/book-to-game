import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlayRoute,
  playLandingHash,
  playStoryHash,
  playWorldHash,
  isPlayerRoute,
} from '../src/lib/play-route';

describe('play-route hash parse', () => {
  it('parses landing', () => {
    assert.deepEqual(parsePlayRoute('#/play'), { kind: 'play-landing' });
    assert.equal(isPlayerRoute(parsePlayRoute('#/play')), true);
  });
  it('keeps the author playtest deep link in the workbench', () => {
    assert.deepEqual(parsePlayRoute('#play'), {kind: 'workbench'});
    assert.equal(isPlayerRoute(parsePlayRoute('#play')), false);
    assert.equal(isPlayerRoute(parsePlayRoute('#/play')), true);
  });
  it('parses story with session', () => {
    assert.deepEqual(parsePlayRoute('#/play/story/abc?session=s1'), {
      kind: 'play-story', revisionId: 'abc', sessionId: 's1',
    });
  });
  it('parses world with adventure', () => {
    assert.deepEqual(parsePlayRoute('#/play/world/w1?adventure=a9'), {
      kind: 'play-world', revisionId: 'w1', adventureId: 'a9',
    });
  });
  it('bad play path', () => {
    assert.deepEqual(parsePlayRoute('#/play/nope'), { kind: 'play-bad', raw: '/play/nope' });
  });
  it('workbench default', () => {
    assert.deepEqual(parsePlayRoute('#/'), { kind: 'workbench' });
    assert.deepEqual(parsePlayRoute(''), { kind: 'workbench' });
    assert.equal(isPlayerRoute(parsePlayRoute('#/')), false);
  });
  it('builders', () => {
    assert.equal(playLandingHash(), '#/play');
    assert.equal(playStoryHash('r1', 's1'), '#/play/story/r1?session=s1');
    assert.equal(playWorldHash('w1'), '#/play/world/w1');
  });
});
