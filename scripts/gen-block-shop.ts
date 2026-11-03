import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { getBlockCatalog, getBlockShelves } from '@novel-game/contracts';

/**
 * Render the 积木商店 observation page from the real catalog.
 *
 * Usage: tsx scripts/gen-block-shop.ts [output.html]
 * Default output: <repo>/book-to-game-block-shop.html
 *
 * The page is static but always derivable from `getBlockCatalog()` + `getBlockShelves()`;
 * it deliberately does not encode any game rules of its own.
 */

const esc = (value: string) => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function card(block: ReturnType<typeof getBlockCatalog>[number], primary: boolean): string {
  const tags = block.funTags.length
    ? block.funTags.map(tag => `<span>${esc(tag)}</span>`).join('')
    : '<span class="muted">无标签</span>';
  const deps = block.composesWith.dependsOn.length ? block.composesWith.dependsOn.join(', ') : '—';
  const conflicts = block.composesWith.conflictsWith.length
    ? `<div class="meta">互斥：${esc(block.composesWith.conflictsWith.join(', '))}</div>` : '';
  const params = block.params.length
    ? block.params.map(param => `${param.key}<span class="muted">(${esc(param.label)})</span>`).join(' · ')
    : '—';
  return `<article class="card${primary ? '' : ' secondary'}">
 <div class="id">${esc(block.id)} · v${block.version}${primary ? '' : '<span class="minor">次要货架</span>'}</div>
 <h2>${esc(block.label)}</h2>
 <p class="blurb">${esc(block.blurb)}</p>
 <div class="tags">${tags}</div>
 <div class="meta">依赖：${esc(deps)}</div>
 ${conflicts}
 <div class="meta">提供：${esc(block.provides.join(', '))}</div>
 <div class="meta">参数：${params}</div>
</article>`;
}

function render(): string {
  const blocks = getBlockCatalog();
  const shelves = getBlockShelves();
  const sections = shelves.map((shelf, index) => {
    const members = blocks.filter(block => block.shelves.includes(shelf.id));
    const cards = members.map(block => card(block, block.shelves[0] === shelf.id)).join('\n');
    return `<section class="shelf" id="shelf-${esc(shelf.id)}">
 <header class="shelf-head">
  <h2>${esc(shelf.label)} <code>${esc(shelf.id)}</code></h2>
  <span class="count">${members.length} 块</span>
  ${shelf.blurb ? `<p>${esc(shelf.blurb)}</p>` : ''}
  ${index === 0 ? '' : ''}
 </header>
 <div class="grid">
${cards}
 </div>
</section>`;
  }).join('\n');

  const nav = shelves.map(shelf => {
    const count = blocks.filter(block => block.shelves.includes(shelf.id)).length;
    return `<a href="#shelf-${esc(shelf.id)}">${esc(shelf.label)} <span>${count}</span></a>`;
  }).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>积木商店 · 按货架浏览</title>
<style>
:root{color-scheme:dark}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px;background:#0f1419;color:#e7ecf3}
h1{font-size:22px;margin:0 0 6px}
.sub{color:#9aa7b8;margin:0 0 16px;font-size:13px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
nav a{color:#bfe0ff;text-decoration:none;background:#1a2332;border:1px solid #2b3a4f;border-radius:999px;padding:5px 12px;font-size:13px}
nav a span{color:#7dd3fc}
.shelf{margin-bottom:30px}
.shelf-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:1px solid #2b3a4f;padding-bottom:8px;margin-bottom:12px}
.shelf-head h2{font-size:17px;margin:0}
.shelf-head code{font-size:12px;color:#7dd3fc;background:#16202d;border-radius:6px;padding:1px 6px}
.shelf-head p{margin:0;color:#8b9aab;font-size:12px}
.count{margin-left:auto;color:#8b9aab;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:#1a2332;border:1px solid #2b3a4f;border-radius:12px;padding:14px}
.card.secondary{border-style:dashed;opacity:.82}
.card h2{font-size:16px;margin:2px 0 6px}
.id{font-family:ui-monospace,monospace;font-size:12px;color:#7dd3fc}
.minor{float:right;font-size:11px;color:#8b9aab;border:1px solid #2b3a4f;border-radius:999px;padding:0 7px}
.blurb{font-size:13px;color:#c5d0dc;line-height:1.45;margin:8px 0}
.tags{margin-bottom:6px}
.tags span{display:inline-block;background:#243447;color:#9ecbff;border-radius:999px;padding:2px 8px;font-size:11px;margin:2px 4px 2px 0}
.meta{font-size:12px;color:#8b9aab;margin-top:6px;line-height:1.4}
.muted{color:#6f7f92}
footer{color:#6f7f92;font-size:12px;border-top:1px solid #2b3a4f;padding-top:12px}
</style></head><body>
<h1>积木商店</h1>
<p class="sub">共 ${blocks.length} 块 · 按货架浏览 · 尚未接品类配方</p>
<nav>${nav}</nav>
${sections}
<footer>货架是浏览分区，不是玩法绑定；同一块可出现在多条货架。拼装约束仍以 dependsOn / conflictsWith 为准。本页由 <code>scripts/gen-block-shop.ts</code> 从 <code>getBlockCatalog()</code> 生成。</footer>
</body></html>`;
}

const output = process.argv[2] ?? path.resolve(import.meta.dirname, '..', 'book-to-game-block-shop.html');
writeFileSync(output, render());
console.log(`wrote ${output}`);
