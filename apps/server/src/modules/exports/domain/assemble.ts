export const MANIFEST_PLACEHOLDER = '<script id="btg-manifest" type="application/json">__BTG_MANIFEST__</script>';
export const CONTENT_PLACEHOLDER = '<script id="btg-content" type="application/json">__BTG_CONTENT__</script>';

/** Does the prebuilt player template carry exactly one slot for manifest and content? */
export function templateIsUsable(template: string): boolean {
  return template.split(MANIFEST_PLACEHOLDER).length === 2 && template.split(CONTENT_PLACEHOLDER).length === 2;
}

/** Fill the prebuilt template (no Vite at request time). Texts must already be script-safe JSON. */
export function assemblePackageHtml(template: string, manifestText: string, contentText: string, title: string): string {
  const [head, rest] = template.split(MANIFEST_PLACEHOLDER) as [string, string];
  const [middle, tail] = rest.split(CONTENT_PLACEHOLDER) as [string, string];
  const safeTitle = title.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const withTitle = head.replace(/<title>[^<]*<\/title>/, () => `<title>${safeTitle}</title>`);
  return `${withTitle}<script id="btg-manifest" type="application/json">${manifestText}</script>${middle}<script id="btg-content" type="application/json">${contentText}</script>${tail}`;
}

/** `<游戏名>-v<N>.html`, filesystem-safe on Windows/macOS/Linux. */
export function packageFileName(title: string, version: number): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'game';
  return `${base}-v${version}.html`;
}
