import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameRevision, WorldRevision } from '@novel-game/contracts';
import { errorMessage, request } from '../../lib/api';
import { httpStoryPort, httpWorldPort } from '../../lib/http-play-port';
import { useI18n } from '../../lib/i18n';
import { isPlayerRoute, navigateHash, parsePlayRoute, playLandingHash, type PlayRoute } from '../../lib/play-route';
import { Notice } from '../Notice';
import { PlayerShellLayout } from './PlayerShellLayout';
import { PlayLanding } from './PlayLanding';
import { PlayerStoryPage } from './PlayerStoryPage';
import { PlayerWorldPage } from './PlayerWorldPage';

type Props = { token?: string };

export function PlayRouteGate({ token = '' }: Props) {
  const { t } = useI18n();
  const [route, setRoute] = useState<PlayRoute>(() => parsePlayRoute());
  const [games, setGames] = useState<GameRevision[]>([]);
  const [worlds, setWorlds] = useState<WorldRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storyPort = useMemo(() => httpStoryPort(token), [token]);
  const worldPort = useMemo(() => httpWorldPort(token), [token]);

  useEffect(() => {
    const onHash = () => setRoute(parsePlayRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.kind !== 'play-landing') return;
    let active = true;
    setLoading(true); setError(null);
    Promise.all([
      request<GameRevision[]>(token, '/games'),
      request<WorldRevision[]>(token, '/worlds/revisions'),
    ]).then(([g, w]) => {
      if (!active) return;
      setGames(g);
      setWorlds(w);
    }).catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.kind, token]);

  if (!isPlayerRoute(route)) return null;

  let body: ReactNode = null;
  if (route.kind === 'play-landing') {
    body = <PlayLanding games={games} worlds={worlds} loading={loading} error={error} />;
  } else if (route.kind === 'play-story') {
    body = <PlayerStoryPage port={storyPort} revisionId={route.revisionId} initialSessionId={route.sessionId} />;
  } else if (route.kind === 'play-world') {
    body = <PlayerWorldPage port={worldPort} revisionId={route.revisionId} initialAdventureId={route.adventureId} />;
  } else if (route.kind === 'play-bad') {
    body = (
      <section className="work-section" data-testid="play-bad-link">
        <Notice text={t('版本不存在或未发布。')} />
        <button type="button" className="quiet" onClick={() => navigateHash(playLandingHash())}>{t('返回书目')}</button>
      </section>
    );
  }

  return <PlayerShellLayout>{body}</PlayerShellLayout>;
}

export function useIsPlayerShell(): boolean {
  const [player, setPlayer] = useState(() => isPlayerRoute(parsePlayRoute()));
  useEffect(() => {
    const onHash = () => setPlayer(isPlayerRoute(parsePlayRoute()));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return player;
}
