import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderPreset, MODEL_PROVIDER_PRESETS, providerPresetForBaseUrl } from '../src/lib/model-provider-presets.ts';
import type { ModelSettingsFields } from '../src/lib/model-settings-form.ts';

test('provider presets expose clean OpenAI-compatible base URLs', () => {
  assert.ok(MODEL_PROVIDER_PRESETS.length >= 6);
  for (const preset of MODEL_PROVIDER_PRESETS.filter(item => item.baseUrl)) {
    const url = new URL(preset.baseUrl);
    assert.ok(url.protocol === 'http:' || url.protocol === 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.equal(preset.baseUrl.endsWith('/'), false);
  }
});

test('choosing a provider fills its endpoint without leaking or clearing a key', () => {
  const fields: ModelSettingsFields = {baseUrl: 'https://old.example/v1', model: 'old-model', timeoutSeconds: '120', apiKey: 'keep-me', clearApiKey: false};
  const next = applyProviderPreset(fields, 'deepseek');
  assert.equal(next.baseUrl, 'https://api.deepseek.com');
  assert.equal(next.model, '');
  assert.equal(next.apiKey, fields.apiKey);
  assert.equal(next.timeoutSeconds, fields.timeoutSeconds);
  assert.equal(next.clearApiKey, false);
});

test('switching to custom clears provider-specific endpoint and model for manual entry', () => {
  const fields: ModelSettingsFields = {baseUrl: 'https://private.example/v1', model: 'private-model', timeoutSeconds: '120', apiKey: 'keep-me', clearApiKey: false};
  assert.deepEqual(applyProviderPreset(fields, 'custom'), {...fields, baseUrl: '', model: ''});
});

test('saved custom and preset URLs map back to the provider selector', () => {
  assert.equal(providerPresetForBaseUrl('https://api.openai.com/v1/'), 'openai');
  assert.equal(providerPresetForBaseUrl('http://127.0.0.1:11434/v1'), 'ollama');
  assert.equal(providerPresetForBaseUrl('https://private.example/v1'), 'custom');
});
