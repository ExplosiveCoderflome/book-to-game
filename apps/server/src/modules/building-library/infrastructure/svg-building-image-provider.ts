import { createHash } from 'node:crypto';
import type { BuildingImageProvider, BuildingImageRequest, BuildingImageResult, MapFillKind } from '@novel-game/contracts';

/** FNV-ish stable 32-bit hash for seeds. */
export function hashSeed(parts: string[]): number {
  const h = createHash('sha256').update(parts.join('\0')).digest();
  return h.readUInt32BE(0);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const KIND_MOTIF: Record<MapFillKind, { roof: string; accent: string; glyph: string }> = {
  shop: { roof: '#c9a227', accent: '#8a7020', glyph: '店' },
  supply: { roof: '#2a9d8f', accent: '#1d6f66', glyph: '补' },
  quest: { roof: '#457b9d', accent: '#2f5570', glyph: '任' },
  encounter: { roof: '#e76f51', accent: '#a34c38', glyph: '遇' },
  boss: { roof: '#9b2226', accent: '#6b1619', glyph: '霸' },
};

/**
 * Deterministic SVG portrait illustrator — always available fallback when no image API works.
 * Same label+kind+tags+seed ⇒ identical SVG bytes. Display-only.
 */
export class SvgBuildingImageProvider implements BuildingImageProvider {
  readonly id = 'svg-illustrator';

  async generate(req: BuildingImageRequest): Promise<BuildingImageResult> {
    const w = Math.max(128, Math.min(1024, req.width || 512));
    const h = Math.max(128, Math.min(1024, req.height || 512));
    const seed = req.seed ?? hashSeed([req.label, req.kind, ...(req.tags ?? []), req.color ?? '']);
    const svg = renderBuildingSvg({
      width: w, height: h, label: req.label, kind: req.kind,
      color: req.color, icon: req.icon, tags: req.tags, seed,
    });
    return {
      mimeType: 'image/svg+xml',
      data: new TextEncoder().encode(svg),
      provider: this.id,
      revisedPrompt: req.prompt,
    };
  }
}

export function renderBuildingSvg(input: {
  width: number; height: number; label: string; kind: MapFillKind;
  color?: string; icon?: string; tags?: string[]; seed: number;
}): string {
  const { width: w, height: h, label, kind, seed } = input;
  const motif = KIND_MOTIF[kind];
  const wall = input.color && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : motif.roof;
  const rnd = mulberry32(seed);
  const sky1 = lerpColor('#f4f4f2', '#dce8e2', 0.35 + rnd() * 0.3);
  const sky2 = lerpColor('#e8ebe6', wall, 0.12 + rnd() * 0.1);
  const ground = lerpColor('#d5d2c8', wall, 0.15);
  const cx = w / 2;
  const baseY = h * 0.78;
  const buildingW = w * (0.42 + rnd() * 0.12);
  const buildingH = h * (0.34 + rnd() * 0.12);
  const left = cx - buildingW / 2;
  const top = baseY - buildingH;
  const roofH = buildingH * 0.28;
  const windows = 2 + Math.floor(rnd() * 3);
  const doorW = buildingW * 0.18;
  const glyph = (input.icon && input.icon.length <= 2 ? input.icon : motif.glyph);
  const tagLine = (input.tags ?? []).slice(0, 2).join(' · ');

  const windowRects = Array.from({ length: windows }, (_, i) => {
    const ww = buildingW * 0.14;
    const wh = buildingH * 0.16;
    const gap = (buildingW - windows * ww) / (windows + 1);
    const x = left + gap + i * (ww + gap);
    const y = top + buildingH * 0.28;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${ww.toFixed(1)}" height="${wh.toFixed(1)}" rx="2" fill="#f7f4ea" stroke="${motif.accent}" stroke-width="1.2" opacity="0.95"/>`;
  }).join('');

  const deco = kind === 'boss'
    ? `<polygon points="${cx},${(top - roofH - h * 0.06).toFixed(1)} ${(cx - 8).toFixed(1)},${(top - roofH + 4).toFixed(1)} ${(cx + 8).toFixed(1)},${(top - roofH + 4).toFixed(1)}" fill="${motif.accent}"/>`
    : kind === 'quest'
      ? `<rect x="${(cx - 10).toFixed(1)}" y="${(top - roofH - 18).toFixed(1)}" width="20" height="14" rx="2" fill="#f7f4ea" stroke="${motif.accent}"/><line x1="${cx}" y1="${(top - roofH - 4).toFixed(1)}" x2="${cx}" y2="${top.toFixed(1)}" stroke="${motif.accent}" stroke-width="2"/>`
      : kind === 'encounter'
        ? `<circle cx="${cx}" cy="${(top - roofH - 8).toFixed(1)}" r="7" fill="none" stroke="${motif.accent}" stroke-width="2"/><path d="M${(cx - 5).toFixed(1)} ${(top - roofH - 8).toFixed(1)} l5 5 l5 -5" fill="none" stroke="${motif.accent}" stroke-width="1.5"/>`
        : kind === 'supply'
          ? `<rect x="${(left - 14).toFixed(1)}" y="${(baseY - 22).toFixed(1)}" width="18" height="14" rx="2" fill="${motif.accent}" opacity="0.85"/><rect x="${(left + buildingW - 4).toFixed(1)}" y="${(baseY - 18).toFixed(1)}" width="16" height="12" rx="2" fill="${wall}" stroke="${motif.accent}"/>`
          : `<path d="M${(left - 6).toFixed(1)} ${top.toFixed(1)} h${(buildingW + 12).toFixed(1)} l-8 ${(roofH * 0.35).toFixed(1)} h-${(buildingW - 4).toFixed(1)} z" fill="${motif.accent}" opacity="0.35"/>`;

  const title = esc(label.slice(0, 12));
  const kindLabel = esc(kind);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sky1}"/>
      <stop offset="100%" stop-color="${sky2}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <ellipse cx="${cx}" cy="${(h * 0.86).toFixed(1)}" rx="${(w * 0.42).toFixed(1)}" ry="${(h * 0.08).toFixed(1)}" fill="${ground}" opacity="0.9"/>
  <polygon points="${left.toFixed(1)},${top.toFixed(1)} ${cx},${(top - roofH).toFixed(1)} ${(left + buildingW).toFixed(1)},${top.toFixed(1)}" fill="${motif.accent}"/>
  <rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${buildingW.toFixed(1)}" height="${buildingH.toFixed(1)}" fill="${wall}" stroke="${motif.accent}" stroke-width="1.5"/>
  ${windowRects}
  <rect x="${(cx - doorW / 2).toFixed(1)}" y="${(baseY - buildingH * 0.32).toFixed(1)}" width="${doorW.toFixed(1)}" height="${(buildingH * 0.32).toFixed(1)}" fill="${motif.accent}" opacity="0.9"/>
  ${deco}
  <circle cx="${(left + buildingW * 0.78).toFixed(1)}" cy="${(top + buildingH * 0.55).toFixed(1)}" r="${(Math.min(w, h) * 0.055).toFixed(1)}" fill="#f7f4ea" stroke="${motif.accent}" stroke-width="1.2"/>
  <text x="${(left + buildingW * 0.78).toFixed(1)}" y="${(top + buildingH * 0.55 + 4).toFixed(1)}" text-anchor="middle" font-size="${(Math.min(w, h) * 0.045).toFixed(1)}" font-family="Segoe UI, PingFang SC, sans-serif" fill="${motif.accent}">${esc(glyph)}</text>
  <text x="${cx}" y="${(h * 0.1).toFixed(1)}" text-anchor="middle" font-size="${(Math.min(w, h) * 0.055).toFixed(1)}" font-weight="650" font-family="Segoe UI, PingFang SC, sans-serif" fill="#1c1c1a">${title}</text>
  <text x="${cx}" y="${(h * 0.145).toFixed(1)}" text-anchor="middle" font-size="${(Math.min(w, h) * 0.032).toFixed(1)}" font-family="ui-monospace, monospace" fill="#6b6b67">${kindLabel}${tagLine ? ' · ' + esc(tagLine.slice(0, 24)) : ''}</text>
</svg>`;
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = hex(a); const pb = hex(b);
  const c = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `#${[c(0), c(1), c(2)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

function hex(s: string): [number, number, number] {
  const n = s.replace('#', '');
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
