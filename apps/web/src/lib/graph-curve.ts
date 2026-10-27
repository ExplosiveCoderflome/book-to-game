/** Smooth cubic Bezier; siblingIndex fans parallel edges and offsets labels. */
export function edgeCurve(
  x1: number, y1: number, x2: number, y2: number,
  siblingIndex = 0, siblingCount = 1,
): { d: string; labelX: number; labelY: number } {
  const spread = siblingCount <= 1 ? 0 : (siblingIndex - (siblingCount - 1) / 2) * 28;
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len = Math.max(1, Math.hypot(vx, vy));
  const nx = -vy / len;
  const ny = vx / len;
  const dy = Math.max(36, Math.abs(y2 - y1) * 0.42);
  const dx = (x2 - x1) * 0.12;
  const c1x = x1 + dx + nx * spread * 0.55;
  const c1y = y1 + dy + ny * spread * 0.55;
  const c2x = x2 - dx + nx * spread * 0.55;
  const c2y = y2 - dy + ny * spread * 0.55;
  const t = 0.5;
  const mt = 1 - t;
  const labelX = mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2 + nx * (spread * 0.35);
  const labelY = mt * mt * mt * y1 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y2 + ny * (spread * 0.35) - 6
    + (siblingCount > 1 ? (siblingIndex % 2 === 0 ? -6 : 8) : 0);
  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    labelX,
    labelY,
  };
}
