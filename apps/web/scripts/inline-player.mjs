// Fold the Vite player build into ONE self-contained template (no external src/href), then sanity-check it.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'dist-player/build');
const out = path.join(root, 'dist-player/btg-player-template.html');

/** gzip + base64 the player module so the HTML never carries a live `</script>` or server slot marker. */
export function encodeModule(moduleCode) {
  return gzipSync(moduleCode, { level: 9 }).toString('base64');
}

/** Pure template transform: inline assets, keep the two server slots, then append the compressed bootstrap. */
export function inlinePlayerTemplate(html, read) {
  html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) =>
    `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>`);
  html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href) =>
    `<style>${read(href).replace(/<\/style/gi, '<\\/style')}</style>`);
  // Module scripts are deferred, but keep the data slots before the code for readability.
  const moveScripts = [];
  html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, m => { moveScripts.push(m); return ''; });

  const problems = [];
  for (const marker of ['<script id="btg-manifest" type="application/json">__BTG_MANIFEST__</script>', '<script id="btg-content" type="application/json">__BTG_CONTENT__</script>']) {
    if (html.split(marker).length !== 2) problems.push(`marker not exactly once: ${marker.slice(0, 40)}`);
  }
  if (/\s(src|href)="(?!data:|#)[^"]+"/.test(html)) problems.push(`external src/href left: ${html.match(/\s(src|href)="(?!data:|#)[^"]+"/)[0]}`);
  if (/@import|fonts\.googleapis|https?:\/\/[^"'\s)]*\.(woff2?|ttf|otf|css)\b/.test(html)) problems.push('external font / css reference');
  // Author-only surfaces must not ship (UI plan §7.2). Check clear JS before compression (CSS keeps every class name).
  const moduleCode = moveScripts.map(script => script.slice('<script type="module">'.length, -'</script>'.length)).join('\n');
  const js = moduleCode;
  if (moveScripts.length !== 1) problems.push('expected exactly one player module script');
  const authorOnly = {
    DraftPanel: 'extend-conflict-bar', WorldsPanel: 'archive-world', GenerationPanel: 'scan-depth-fieldset',
    NarrateBox: 'narrate-box', ProposeActBox: 'propose-act-box', TiandaoToggle: 'tiandao-toggle',
    ModelSettingsPanel: '/settings/model',
    // S1: lint / simulation surfaces are author-only (slice §9, UI plan §7.2).
    PreflightPanel: 'preflight-lint-strip', WorldSystemInspector: 'world-system-scroll',
  };
  for (const [name, marker] of Object.entries(authorOnly)) if (js.includes(marker)) problems.push(`author-only code in player: ${name} (${marker})`);
  if (js.includes('PIXI') || js.includes('pixi-viewport')) problems.push('pixi code in player bundle');
  for (const fetchy of ['/api/', '"/api', '`/api']) if (js.includes(fetchy)) problems.push('api fetch in player bundle');
  if (problems.length) throw new Error('player template check FAILED:\n - ' + problems.join('\n - '));

  // Compress only after every clear-text check above. The server still fills the same two JSON slots.
  const encoded = encodeModule(moduleCode);
  const payload = `<script type="application/octet-stream" id="btg-code">${encoded}</script>`;
  const bootstrap = `<script type="module">try{if(typeof DecompressionStream!=='function')throw 0;const b=Uint8Array.from(atob(document.getElementById('btg-code').textContent),c=>c.charCodeAt(0));const code=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const s=document.createElement('script');s.type='module';s.textContent=code;document.body.append(s)}catch{document.getElementById('root').innerHTML='<section class="work-section package-error" data-testid="package-error-unsupported"><div class="section-heading"><div><p class="eyebrow">无法打开</p><h2>当前浏览器无法打开这个播放器</h2><p class="hint">请使用支持 gzip 解压的新版 Chrome、Edge、Firefox 或 Safari 后重新打开。</p></div></div><details class="package-tech"><summary>技术信息</summary><p class="mono">此播放器需要浏览器支持 DecompressionStream。</p></details></section>'}</script>`;
  html = html.replace('</body>', () => `${payload}${bootstrap}</body>`);
  return html;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const read = rel => readFileSync(path.join(buildDir, rel.replace(/^\.?\//, '')), 'utf8');
  let html = readFileSync(path.join(buildDir, 'package.html'), 'utf8');
  try {
    html = inlinePlayerTemplate(html, read);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  writeFileSync(out, html);
  console.log(`player template: ${path.relative(process.cwd(), out)} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · files in build: ${readdirSync(buildDir).join(', ')}`);
}
