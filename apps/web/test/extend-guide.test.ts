import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearExtendGuideDismiss, dismissExtendGuide, isExtendGuideDismissed } from '../src/lib/extend-guide.ts';

test('extend guide dismiss is session-local per draft', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  } as Storage;
  const original = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: fake });
  try {
    assert.equal(isExtendGuideDismissed('d1'), false);
    dismissExtendGuide('d1');
    assert.equal(isExtendGuideDismissed('d1'), true);
    assert.equal(isExtendGuideDismissed('d2'), false);
    clearExtendGuideDismiss('d1');
    assert.equal(isExtendGuideDismissed('d1'), false);
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: original });
  }
});
