import { chromium } from '/tmp/btg-pw/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const d = JSON.parse(readFileSync('/workspace/btg-e2e/gap/demo.json', 'utf8'));
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
for (const renderer of ['svg', 'pixi']) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error(renderer, 'pageerror', e.message));
  const r = { renderer };
  try {
    await page.goto(BASE); await page.evaluate(() => localStorage.setItem('novel-game.locale', 'zh-CN'));
    await page.goto(`${BASE}/?mapRenderer=${renderer}&t=${Date.now()}`); await page.waitForSelector('.workspace-bar');
    await page.getByRole('button', { name: /世界草稿/ }).click();
    await page.locator('.world-workspace .draft-toolbar select').first().selectOption(d.draftId);
    await page.click('[data-testid=world-view-map]'); await page.waitForTimeout(1500);
    const vp = page.locator('.world-map-viewport'); r.actual = await vp.getAttribute('data-renderer');
    const box = await vp.boundingBox();
    const hash = async () => { await page.mouse.move(5, 5); await page.waitForTimeout(200); return createHash('sha1').update(await vp.screenshot()).digest('hex'); }; const _h = async () => createHash('sha1').update(await vp.screenshot()).digest('hex');
    // --- drag-drop: unbind 上游浅滩 via tray ×, then drag tray item onto an empty cell with the real mouse
    await page.locator('[data-testid=map-tray-river_upstream] button').click(); await page.waitForTimeout(300);
    r.unboundBefore = await page.locator('[data-testid=map-tray-river_upstream]').getAttribute('class');
    const src = await page.locator('[data-testid=map-tray-river_upstream]').boundingBox();
    const tx = box.x + box.width * 0.62, ty = box.y + box.height * 0.80;
    await page.mouse.move(src.x + 20, src.y + src.height / 2); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(src.x + 20 + (tx - src.x - 20) * i / 12, src.y + (ty - src.y) * i / 12, { steps: 2 });
    await page.mouse.up(); await page.waitForTimeout(500);
    r.dropBound = /\bbound\b/.test(await page.locator('[data-testid=map-tray-river_upstream]').getAttribute('class') ?? '');
    // --- drag-paint: terrain mode, real mouse stroke across the map
    await page.click('[data-testid=map-mode-terrain]'); await page.waitForTimeout(400);
    const before = await hash(); const svgB = renderer==='svg' ? await page.locator('.world-map-viewport svg').first().innerHTML() : ''; const undoBefore = await page.locator('[data-testid=map-undo]').isEnabled();
    const y = box.y + box.height * 0.42; const t0 = Date.now();
    await page.mouse.move(box.x + box.width * 0.30, y); await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + box.width * (0.30 + 0.4 * i / 30), y + Math.sin(i / 4) * 30);
    await page.mouse.up(); r.paintStrokeMs = Date.now() - t0; await page.waitForTimeout(500);
    const after = await hash(); r.paintChangedPixels = before !== after;
    // one stroke = one undo step
    await page.click('[data-testid=map-undo]'); await page.waitForTimeout(500);
    r.undoRestoresPaint = (await hash()) === before; if (renderer==='svg') { const a = await page.locator('.world-map-viewport svg').first().innerHTML(); r.svgSame = a===svgB; r.undoRestoresPaint = r.svgSame; /* pixel diff on svg includes HUD toast; markup is the truth */ if (!r.svgSame) { let i=0; while(a[i]===svgB[i]) i++; r.diffAt = [svgB.slice(i-150,i+150), a.slice(i-150,i+150)]; } }
    await page.screenshot({ path: `/workspace/btg-e2e/screenshots/gap-drag-${renderer}.png` });
  } catch (e) { r.error = String(e).slice(0, 300); }
  results.push(r); await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
writeFileSync('/workspace/btg-e2e/gap/drag-results.json', JSON.stringify(results, null, 2));
