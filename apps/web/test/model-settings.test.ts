import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsInput } from '../src/lib/model-settings-form.js';
test('model form keeps saved keys implicit, explicit clear is distinct, and seconds convert correctly', () => {
  const fields = {baseUrl: 'https://api.example.test/v1', model: 'model-1', timeoutSeconds: '90', apiKey: '', clearApiKey: false};
  const preserved = settingsInput(fields, 4);
  assert.equal('apiKey' in preserved, false); assert.equal(preserved.timeoutMs, 90000); assert.equal(preserved.expectedRevision, 4);
  assert.deepEqual(settingsInput({...fields, clearApiKey: true}, 4), {...preserved, clearApiKey: true});
  assert.equal(settingsInput({...fields, apiKey: ' replacement '}, 4).apiKey, 'replacement');
  assert.throws(() => settingsInput({...fields, timeoutSeconds: ''}, 4));
  assert.throws(() => settingsInput({...fields, apiKey: 'new', clearApiKey: true}, 4));
});
