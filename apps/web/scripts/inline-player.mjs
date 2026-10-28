// Fold the Vite player build into ONE self-contained template (no external src/href), then sanity-check it.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'dist-player/build');
const out = path.join(root, 'dist-player/btg-player-template.html');
let html = readFileSync(path.join(buildDir, 'package.html'), 'utf8');

const read = rel => readFileSync(path.join(buildDir, rel.replace(/^\.?\//, '')), 'utf8');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) =>
  `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href) =>
  `<style>${read(href).replace(/<\/style/gi, '<\\/style')}</style>`);
// Module scripts are deferred, but keep the data slots before the code for readability.
const moveScripts = [];
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, m => { moveScripts.push(m); return ''; });
html = html.replace('</body>', () => `${moveScripts.join('')}</body>`);

const problems = [];
for (const marker of ['<script id="btg-manifest" type="application/json">__BTG_MANIFEST__</script>', '<script id="btg-content" type="application/json">__BTG_CONTENT__</script>']) {
  if (html.split(marker).length !== 2) problems.push(`marker not exactly once: ${marker.slice(0, 40)}`);
}
if (/\s(src|href)="(?!data:|#)[^"]+"/.test(html)) problems.push(`external src/href left: ${html.match(/\s(src|href)="(?!data:|#)[^"]+"/)[0]}`);
if (/@import|fonts\.googleapis|https?:\/\/[^"'\s)]*\.(woff2?|ttf|otf|css)\b/.test(html)) problems.push('external font / css reference');
// Author-only surfaces must not ship (UI plan §7.2). Checked against the JS only (CSS keeps every class name).
const js = moveScripts.join('');
const authorOnly = {
  DraftPanel: 'extend-conflict-bar', WorldsPanel: 'archive-world', GenerationPanel: 'scan-depth-fieldset',
  NarrateBox: 'narrate-box', ProposeActBox: 'propose-act-box', TiandaoToggle: 'tiandao-toggle',
  ModelSettingsPanel: '/settings/model',
  // S1: lint / simulation surfaces are author-only (slice §9, UI plan §7.2).
  PreflightPanel: 'preflight-lint-strip', WorldSystemInspector: 'world-system-scroll',
};
for (const [name, marker] of Object.entries(authorOnly)) if (js.includes(marker)) problems.push(`author-only code in player: ${name} (${marker})`);
for (const fetchy of ['/api/', '"/api', '`/api']) if (js.includes(fetchy)) problems.push('api fetch in player bundle');
if (problems.length) { console.error('player template check FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
writeFileSync(out, html);
console.log(`player template: ${path.relative(process.cwd(), out)} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · files in build: ${readdirSync(buildDir).join(', ')}`);
