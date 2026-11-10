import {constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {WorldPackage} from '@novel-game/contracts';
import {AppError} from '../../shared/errors.js';
import {compileWorldPackage, importWorldPackage, packagePath} from './world-package.js';

const MAX_BYTES = 16 * 1024 * 1024;
function fail(message: string): never {throw new AppError('WORLD_PACKAGE_IO', message, 422);}
/** Read only, including legacy input files. Symlinks and unlisted files are never followed. */
export function readWorldPackage(input: string): WorldPackage {
  const stat = lstatSync(input); if (stat.isSymbolicLink()) fail('世界包输入不能是符号链接');
  let total = 0;
  const read = (file: string) => {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = fstatSync(fd); total += s.size;
      if (!s.isFile() || total > MAX_BYTES) fail('世界包不是普通文件或超过 16MiB');
      return readFileSync(fd, 'utf8');
    } finally {closeSync(fd);}
  };
  const parse = (text: string) => {try {return JSON.parse(text);} catch {fail('世界包 JSON 无法解析');}};
  if (stat.isFile()) return importWorldPackage(parse(read(input)));
  if (!stat.isDirectory()) fail('世界包输入必须为目录或 JSON 文件');
  const files: Record<string, string> = {}; let manifest: unknown;
  const walk = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const name = prefix + entry.name; const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('世界包不允许符号链接');
      if (entry.isDirectory()) {
        if (prefix || !['content', 'blocks', 'ext'].includes(entry.name)) fail(`不支持的子目录：${name}`);
        walk(file, name + '/');
      } else if (entry.isFile()) {
        if (name === 'manifest.json') manifest = parse(read(file));
        else {packagePath(name); if (Object.keys(files).length >= 512) fail('世界包超过 512 个文件'); files[name] = read(file);}
      } else fail('世界包只允许普通文件');
    }
  };
  walk(input); return importWorldPackage({manifest, files});
}
/** New-directory-only output: never overwrite an author's source or existing edits. */
function outputFiles(directory: string, files: Record<string, string>) {
  mkdirSync(directory, {mode: 0o700});
  for (const [name, text] of Object.entries(files)) {
    const parent = path.dirname(name);
    if (parent !== '.') {try {mkdirSync(path.join(directory, parent), {mode: 0o700});} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}}
    writeFileSync(path.join(directory, name), text, {flag: 'wx', mode: 0o600});
  }
}
export function writeWorldPackage(directory: string, packet: WorldPackage): void {
  const compiled = compileWorldPackage(packet);
  outputFiles(directory, {'manifest.json': JSON.stringify(compiled.manifest, null, 2) + '\n', ...packet.files});
}
/** The player/engine still receives one WorldContent JSON. The manifest is a sidecar only. */
export function writeCompiledWorld(directory: string, packet: WorldPackage): void {
  const compiled = compileWorldPackage(packet);
  outputFiles(directory, {'world.json': compiled.worldJson + '\n', 'manifest.json': JSON.stringify(compiled.manifest, null, 2) + '\n'});
}
