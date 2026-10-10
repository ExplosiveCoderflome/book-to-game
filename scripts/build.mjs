import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const {dependencies} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Bundle workspace TypeScript; only installed third-party packages stay external.
const external = Object.keys(dependencies).filter(name => !name.startsWith('@novel-game/'));
await build({
  entryPoints: ['apps/server/src/main.ts', 'apps/server/src/worker.ts'], outdir: 'dist/server',
  bundle: true, external, platform: 'node', target: 'node24', format: 'esm',
  outExtension: {'.js': '.mjs'}, sourcemap: true,
});
