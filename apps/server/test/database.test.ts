import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SqliteDatabase } from '../src/platform/database.js';

test('SQLite transactions commit return values, roll back failures and isolate nested savepoints', () => {
  const db = new SqliteDatabase(':memory:');
  try {
    db.exec('CREATE TABLE values_test(id INTEGER PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO values_test(id,value) VALUES(?,?)');
    const outer = db.transaction(() => {
      insert.run(1, 'outer');
      assert.throws(() => db.transaction(() => {insert.run(2, 'nested failure'); throw new Error('abort inner');}).immediate(), /abort inner/);
      db.transaction(() => {insert.run(3, 'nested success');})();
      return 'committed';
    });
    assert.equal(outer.immediate(), 'committed');
    assert.deepEqual(db.prepare('SELECT * FROM values_test ORDER BY id').all(), [{id: 1, value: 'outer'}, {id: 3, value: 'nested success'}]);
    assert.throws(() => db.transaction(() => {
      insert.run(4, 'outer failure');
      db.transaction(() => {insert.run(5, 'inner released');})();
      throw new Error('abort outer');
    })(), /abort outer/);
    assert.deepEqual(db.prepare('SELECT id FROM values_test ORDER BY id').all(), [{id: 1}, {id: 3}]);
    assert.equal(Object.getPrototypeOf(db.prepare('SELECT id FROM values_test LIMIT 1').get()), Object.prototype);
  } finally {db.close();}
});

test('SQLite synchronous transactions reject async callbacks before execution and roll back promise results', () => {
  const db = new SqliteDatabase(':memory:');
  try {
    db.exec('CREATE TABLE values_test(value TEXT)'); let started = false;
    const asyncOperation = db.transaction(async () => {started = true; db.exec("INSERT INTO values_test VALUES('async')");});
    assert.throws(() => asyncOperation.immediate(), /synchronous callback/);
    assert.equal(started, false);
    assert.throws(() => db.transaction(() => {
      db.exec("INSERT INTO values_test VALUES('promise result')"); return Promise.resolve();
    })(), /synchronous callback/);
    assert.deepEqual(db.prepare('SELECT * FROM values_test').all(), []);
    db.transaction(() => db.exec("INSERT INTO values_test VALUES('subsequent sync')"))();
    assert.deepEqual(db.prepare('SELECT * FROM values_test').get(), {value: 'subsequent sync'});
  } finally {db.close();}
});

test('BEGIN IMMEDIATE reserves one SQLite writer across connections and releases it after commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-sqlite-lock-')); const path = join(dir, 'test.sqlite');
  const first = openDatabase(path); const second = openDatabase(path);
  try {
    first.exec('CREATE TABLE values_test(id INTEGER PRIMARY KEY)'); second.exec('PRAGMA busy_timeout = 0');
    first.transaction(() => {
      first.prepare('INSERT INTO values_test VALUES(?)').run(1);
      assert.throws(() => second.transaction(() => second.prepare('INSERT INTO values_test VALUES(?)').run(2)).immediate(), /locked/);
      assert.deepEqual(second.prepare('SELECT id FROM values_test').all(), []);
    }).immediate();
    second.transaction(() => second.prepare('INSERT INTO values_test VALUES(?)').run(2)).immediate();
    assert.deepEqual(first.prepare('SELECT id FROM values_test ORDER BY id').all(), [{id: 1}, {id: 2}]);
    assert.deepEqual(first.prepare('PRAGMA foreign_keys').get(), {foreign_keys: 1});
    assert.deepEqual(first.prepare('PRAGMA busy_timeout').get(), {timeout: 5000});
    assert.deepEqual(first.prepare('PRAGMA synchronous').get(), {synchronous: 2});
  } finally {first.close(); second.close(); rmSync(dir, {recursive: true, force: true});}
});

test('native SQLite adapter opens an existing SQLite file without rewriting records or immutable triggers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-sqlite-existing-')); const path = join(dir, 'existing.sqlite');
  const existing = new DatabaseSync(path);
  const published = JSON.stringify({id: 'published-1', version: 1, content: {title: '旧版本', scenes: []}});
  existing.exec(`CREATE TABLE game_revisions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TRIGGER game_revisions_immutable_update BEFORE UPDATE ON game_revisions
    BEGIN SELECT RAISE(ABORT, 'Published game revisions are immutable'); END;`);
  existing.prepare('INSERT INTO game_revisions VALUES(?,?)').run('published-1', published); existing.close();
  const db = openDatabase(path);
  try {
    assert.deepEqual(db.prepare('SELECT id,data FROM game_revisions').get(), {id: 'published-1', data: published});
    assert.throws(() => db.prepare('UPDATE game_revisions SET data=? WHERE id=?').run('{}', 'published-1'), /immutable/);
    assert.deepEqual(db.prepare('SELECT data FROM game_revisions').get(), {data: published});
  } finally {db.close(); rmSync(dir, {recursive: true, force: true});}
});
