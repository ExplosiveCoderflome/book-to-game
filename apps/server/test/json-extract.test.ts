import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonValue, JsonContentError } from '../src/platform/model/extract-json.js';

const analysis = {summary: '渡口', characters: [], locations: [], worldRules: [], uncertainties: []};

test('extracts fenced JSON, surrounding prose, and trailing commas', () => {
  assert.deepEqual(extractJsonValue('```json\n' + JSON.stringify(analysis) + '\n```'), analysis);
  assert.deepEqual(extractJsonValue('分析结果如下：\n```json\n' + JSON.stringify(analysis) + '\n```\n请查收'), analysis);
  assert.deepEqual(extractJsonValue('说明：\n' + JSON.stringify(analysis) + '\n希望有帮助'), analysis);
  assert.deepEqual(extractJsonValue('{"summary":"渡口","characters":[],"locations":[],"worldRules":[],"uncertainties":[],}'), analysis);
  assert.deepEqual(extractJsonValue('{"summary":"a, } b","characters":[],"locations":[],"worldRules":[],"uncertainties":[]}'),
    {...analysis, summary: 'a, } b'});
  assert.deepEqual(extractJsonValue(JSON.stringify(JSON.stringify(analysis))), analysis);
});

test('truncated or empty model text fails with a specific reason and no source text', () => {
  assert.throws(() => extractJsonValue('{"summary":"渡口","characters":['), (error: unknown) => error instanceof JsonContentError && error.reason === 'truncated');
  assert.throws(() => extractJsonValue('```json\n{"summary":"渡口"'), (error: unknown) => error instanceof JsonContentError && error.reason === 'truncated');
  assert.throws(() => extractJsonValue('   '), (error: unknown) => error instanceof JsonContentError && error.reason === 'empty');
  assert.throws(() => extractJsonValue('这里没有对象'), (error: unknown) => {
    assert.ok(error instanceof JsonContentError);
    assert.equal(error.reason, 'invalid');
    assert.doesNotMatch(String(error), /这里没有对象/);
    return true;
  });
});
