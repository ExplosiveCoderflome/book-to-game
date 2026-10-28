import type { AdventureView, GameRevision, SessionView, WorldRevision } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from './api';
import type { StoryPagePort, WorldPagePort } from './play-port';

function webSessionStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

const webCommon = {
  context: 'web' as const,
  message: errorMessage,
  uncertain: (e: unknown) => !(e instanceof RequestError && !e.uncertain),
  pendingStorage: webSessionStorage,
  pendingKey: (kind: 'story' | 'world') => kind === 'story' ? 'novel-game.pending-action' : 'novel-game.pending-adventure',
};

export function httpStoryPort(token: string): StoryPagePort {
  return {
    ...webCommon,
    revision: async id => (await request<GameRevision[]>(token, '/games')).find(g => g.id === id) ?? null,
    list: async id => (await request<SessionView[]>(token, '/sessions')).filter(s => s.gameRevisionId === id),
    get: id => request<SessionView>(token, `/sessions/${id}`),
    start: id => request<SessionView>(token, '/sessions', 'POST', { gameRevisionId: id }),
    act: (id, input) => request<SessionView>(token, `/sessions/${id}/actions`, 'POST', input),
  };
}

export function httpWorldPort(token: string): WorldPagePort {
  return {
    ...webCommon,
    revision: async id => (await request<WorldRevision[]>(token, '/worlds/revisions')).find(w => w.id === id) ?? null,
    list: async id => (await request<AdventureView[]>(token, '/adventures')).filter(a => a.worldRevisionId === id),
    get: id => request<AdventureView>(token, `/adventures/${id}`),
    start: id => request<AdventureView>(token, '/adventures', 'POST', { worldRevisionId: id }),
    act: (id, input) => request<AdventureView>(token, `/adventures/${id}/actions`, 'POST', input),
  };
}
