/** Hash routes for M1 player shell. Paths: #/play · #/play/story/:id · #/play/world/:id */

export type PlayRoute =
  | { kind: 'workbench' }
  | { kind: 'play-landing' }
  | { kind: 'play-story'; revisionId: string; sessionId?: string }
  | { kind: 'play-world'; revisionId: string; adventureId?: string }
  | { kind: 'play-bad'; raw: string };

function stripHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function parsePlayRoute(hash = typeof window !== 'undefined' ? window.location.hash : ''): PlayRoute {
  const full = stripHash(hash || '/');
  const [pathPart, queryPart = ''] = full.split('?');
  const path = pathPart.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(queryPart);

  if (path === '/' || path === '') return { kind: 'workbench' };
  if (path === '/play') return { kind: 'play-landing' };

  const story = path.match(/^\/play\/story\/([^/]+)$/);
  if (story) {
    const sessionId = params.get('session') || undefined;
    return { kind: 'play-story', revisionId: decodeURIComponent(story[1]), sessionId };
  }
  const world = path.match(/^\/play\/world\/([^/]+)$/);
  if (world) {
    const adventureId = params.get('adventure') || undefined;
    return { kind: 'play-world', revisionId: decodeURIComponent(world[1]), adventureId };
  }
  if (path.startsWith('/play')) return { kind: 'play-bad', raw: path };
  return { kind: 'workbench' };
}

export function isPlayerRoute(route: PlayRoute): boolean {
  return route.kind !== 'workbench';
}

export function playLandingHash(): string {
  return '#/play';
}

export function playStoryHash(revisionId: string, sessionId?: string): string {
  const q = sessionId ? `?session=${encodeURIComponent(sessionId)}` : '';
  return `#/play/story/${encodeURIComponent(revisionId)}${q}`;
}

export function playWorldHash(revisionId: string, adventureId?: string): string {
  const q = adventureId ? `?adventure=${encodeURIComponent(adventureId)}` : '';
  return `#/play/world/${encodeURIComponent(revisionId)}${q}`;
}

export function workbenchHash(): string {
  return '#/';
}

/** Absolute same-origin URL for clipboard share. */
export function absolutePlayUrl(hash: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const h = hash.startsWith('#') ? hash : `#${hash}`;
  return `${origin}${path}${h}`;
}

export function navigateHash(hash: string): void {
  const h = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === h) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = h;
  }
}
