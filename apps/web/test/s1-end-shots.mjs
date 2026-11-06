import pw from '/workspace/mobile-check/node_modules/playwright/index.js';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = pw;
const root = '/workspace/btg-e2e';
const out = `${root}/screenshots`;
const html = `${root}/s1/packages/s1-gold.html`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const screenshot = async name => {
  await page.screenshot({ path: path.join(out, name), fullPage: true });
};
const world = JSON.parse(fs.readFileSync(`${root}/s1/mobile-k15/world.json`, 'utf8'));
await page.goto(`file://${html}`);
await page.evaluate(() => localStorage.setItem('novel-game.locale', 'zh-CN'));
await page.reload();
await page.getByRole('button', { name: '开始新存档' }).click();
await page.waitForSelector('[data-testid=play-clock]');
await page.locator('[data-testid=play-stats-numbers]').scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: `${out}/s1-end-m10-x-y-1440.png` });

for (const [key, target, expected] of [
  ['failure', 'failure', 'failure'],
  ['timeout', 'timeout', 'timeout'],
  ['variation', 'variation', 'ending'],
]) {
  await page.goto(`file://${html}`);
  await page.evaluate(() => localStorage.setItem('novel-game.locale', 'zh-CN'));
  await page.reload();
  await page.getByRole('button', { name: '开始新存档' }).click();
  await page.waitForSelector('[data-testid=play-clock]');
  const ended = await drive(target);
  const kind = await page.locator('[data-testid=play-ending-panel]').getAttribute('data-kind').catch(() => 'missing');
  await page.locator('[data-testid=play-ending-panel]').scrollIntoViewIfNeeded().catch(() => {});
  await screenshot(`s1-end-${key}-1440.png`);
  console.log(`${key}: reached=${ended} kind=${kind} expected=${expected}`);
}

await page.goto(`file://${html}`);
await page.evaluate(() => localStorage.setItem('novel-game.locale', 'zh-CN'));
await page.reload();
await page.getByRole('button', { name: '开始新存档' }).click();
await page.waitForSelector('[data-testid=play-clock]');
await drive('variation');
await page.evaluate(() => document.querySelector('[data-testid=play-ending-recap]')?.remove());
await page.locator('[data-testid=play-ending-panel]').scrollIntoViewIfNeeded();
await screenshot('s1-end-no-recap-1440.png');

const audit = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid=play-ending-panel]');
  if (!panel) return null;
  const forbiddenId = /(?:^|\s)(?:[a-z]+_){1,}[a-z0-9_]+(?:\s|$)/i;
  return {
    headingSize: panel.querySelector('.play-ending-recap h5') ? getComputedStyle(panel.querySelector('.play-ending-recap h5')).fontSize : null,
    headingWeight: panel.querySelector('.play-ending-recap h5') ? getComputedStyle(panel.querySelector('.play-ending-recap h5')).fontWeight : null,
    passageMargin: panel.querySelector('.play-ending-passages') ? getComputedStyle(panel.querySelector('.play-ending-passages')).marginTop : null,
    visibleIds: [...panel.querySelectorAll('[id],[data-passage],[data-recap]')].map(el => el.id || el.dataset.passage || el.dataset.recap),
    exposedIdText: [...panel.querySelectorAll('*')].some(el => el.children.length === 0 && forbiddenId.test(el.textContent.trim())),
  };
});
fs.writeFileSync(`${out}/s1-end-audit.json`, JSON.stringify({ audit, errors }, null, 2));
console.log(JSON.stringify({ audit, errors }, null, 2));
await browser.close();
