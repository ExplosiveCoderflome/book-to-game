/** Package hash routes: `#/` start page and `#/save/<id>`. Anything else is treated as `#/`. */
export type PackageRoute = { kind: 'start' } | { kind: 'save'; saveId: string };

export function parsePackageRoute(hash: string = typeof location === 'undefined' ? '' : location.hash): PackageRoute {
  const match = /^#\/save\/([A-Za-z0-9_-]{1,80})$/.exec(hash);
  return match ? { kind: 'save', saveId: match[1]! } : { kind: 'start' };
}

export const startHash = () => '#/';
export const saveHash = (id: string) => `#/save/${id}`;

export function goPackage(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}
