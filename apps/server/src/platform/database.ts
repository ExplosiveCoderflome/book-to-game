import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class SqliteDatabase {
  private readonly database: DatabaseSync;
  private transactionDepth = 0;
  private savepointSequence = 0;
  constructor(path: string) {this.database = new DatabaseSync(path);}
  get open(): boolean {return this.database.isOpen;}
  exec(sql: string): void {this.database.exec(sql);}
  close(): void {this.database.close();}
  prepare(sql: string) {
    const statement = this.database.prepare(sql);
    return {
      get: (...parameters: SQLInputValue[]): unknown => {
        const row = statement.get(...parameters); return row ? {...row} : undefined;
      },
      all: (...parameters: SQLInputValue[]): unknown[] => statement.all(...parameters).map(row => ({...row})),
      run: (...parameters: SQLInputValue[]) => {
        const result = statement.run(...parameters);
        return {changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid};
      },
    };
  }
  transaction<T>(operation: () => T): (() => T) & {immediate: () => T} {
    const run = (immediate: boolean): T => {
      if (operation.constructor.name === 'AsyncFunction') throw new TypeError('SQLite transactions require a synchronous callback');
      const savepoint = `workbench_${++this.savepointSequence}`;
      const nested = this.transactionDepth > 0;
      this.exec(nested ? `SAVEPOINT ${savepoint}` : immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
      this.transactionDepth++;
      try {
        const result = operation();
        if (result !== null && (typeof result === 'object' || typeof result === 'function') &&
          typeof (result as {then?: unknown}).then === 'function') {
          throw new TypeError('SQLite transactions require a synchronous callback');
        }
        this.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        this.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : 'ROLLBACK');
        throw error;
      } finally {this.transactionDepth--;}
    };
    return Object.assign(() => run(false), {immediate: () => run(true)});
  }
}

export function openDatabase(path: string): SqliteDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
  const db = new SqliteDatabase(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
  return db;
}
