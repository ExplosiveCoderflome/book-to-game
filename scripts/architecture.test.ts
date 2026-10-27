import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkImports } from './architecture-rules.js';
test('architecture guard rejects framework and infrastructure dependencies in core layers', () => {
  const violations = checkImports([
    {file: 'apps/server/src/modules/books/domain/book.ts', imports: ['express', '../infrastructure/repository.js']},
    {file: 'apps/server/src/modules/books/application/use-case.ts', imports: ['better-sqlite3', 'node:sqlite', 'node:fs']},
  ]);
  assert.equal(violations.length, 5);
});
test('architecture guard allows ports and public modules but rejects internals and module cycles', () => {
  assert.deepEqual(checkImports([
    {file: 'apps/server/src/modules/a/application/a.ts', imports: ['../domain/ports.js', '@novel-game/contracts']},
    {file: 'apps/server/src/app/compose.ts', imports: ['../modules/a/index.js']},
  ]), []);
  const result = checkImports([
    {file: 'apps/server/src/modules/a/index.ts', imports: ['../b/domain/b.js']},
    {file: 'apps/server/src/modules/b/index.ts', imports: ['../a/index.js']},
  ]);
  assert.ok(result.some(v => v.includes('内部')));
  assert.ok(result.some(v => v.includes('循环')));
});

test('architecture guard rejects composition-root deep imports past module index', () => {
  const deep = checkImports([
    {file: 'apps/server/src/app/commands/games.ts', imports: ['../../modules/sessions/application/propose-act.js']},
    {file: 'apps/server/src/adapters/http/routes.ts', imports: ['../../modules/games/domain/validate.js']},
  ]);
  assert.equal(deep.length, 2);
  assert.ok(deep.every(v => v.includes('组合根禁止深引用')));
  assert.deepEqual(checkImports([
    {file: 'apps/server/src/app/commands/games.ts', imports: ['../../modules/sessions/index.js']},
    {file: 'apps/server/src/adapters/http/app.ts', imports: ['../../modules/games/index.js']},
  ]), []);
});


test('architecture guard keeps contracts/rules packages free of frameworks and forbids contracts→rules', () => {
  const framework = checkImports([
    {file: 'packages/rules/src/reachability.ts', imports: ['react', 'express']},
    {file: 'packages/contracts/src/index.ts', imports: ['better-sqlite3']},
  ]);
  assert.ok(framework.some(v => v.includes('packages 禁止依赖')));
  const cycle = checkImports([
    {file: 'packages/contracts/src/index.ts', imports: ['@novel-game/rules']},
  ]);
  assert.ok(cycle.some(v => v.includes('contracts 禁止依赖 rules')));
  assert.deepEqual(checkImports([
    {file: 'packages/rules/src/world-opening.ts', imports: ['@novel-game/contracts']},
  ]), []);
});
