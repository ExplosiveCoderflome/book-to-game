import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const {dependencies} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Bundle workspace TypeScript; only installed third-party packages stay external.
// quickjs-emscripten loads its .wasm relative to its own package, so it must stay external.
const external = [...Object.keys(dependencies).filter(name => !name.startsWith('@novel-game/')), 'quickjs-emscripten', '@jitl/*'];
await build({
  entryPoints: ['apps/server/src/main.ts', 'apps/server/src/worker.ts', 'apps/server/src/agent.ts'], outdir: 'dist/server',
  bundle: true, external, platform: 'node', target: 'node24', format: 'esm',
  outExtension: {'.js': '.mjs'}, sourcemap: true,
});
