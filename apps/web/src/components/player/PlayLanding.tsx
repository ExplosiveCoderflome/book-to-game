import { useI18n } from '../../lib/i18n';
import { navigateHash, playStoryHash, playWorldHash, workbenchHash } from '../../lib/play-route';
import type { GameRevision, WorldRevision } from '@novel-game/contracts';
import { Empty, Notice } from '../Notice';

type Props = {
  games: GameRevision[];
  worlds: WorldRevision[];
  loading?: boolean;
  error?: string | null;
};

export function PlayLanding({ games, worlds, loading, error }: Props) {
  const { t } = useI18n();
  const empty = !loading && games.length === 0 && worlds.length === 0;
  return (
    <section className="work-section play-landing" data-testid="play-landing">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t('已发布 · 可开局')}</p>
          <h2>{t('选择一局开始')}</h2>
        </div>
        <span className="edition">PLAY</span>
      </div>
      <Notice text={error ?? null} />
      {loading && <p role="status">{t('正在读取…')}</p>}
      {empty && (
        <div className="panel stack">
          <Empty>{t('还没有已发布的游戏')}</Empty>
          <p className="hint">{t('请先在工作台发布分支故事或世界版本。')}</p>
          <button type="button" className="quiet" onClick={() => navigateHash(workbenchHash())}>{t('前往工作台')}</button>
        </div>
      )}
      {!loading && !empty && (
        <div className="play-landing-grid">
          <div className="panel stack">
            <h3>{t('分支故事')}</h3>
            {games.length === 0 ? <Empty>{t('还没有已发布的游戏')}</Empty> : (
              <ul className="item-list">
                {games.map(g => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="list-button play-landing-row"
                      onClick={() => navigateHash(playStoryHash(g.id))}
                    >
                      <strong>{g.content.title} · v{g.version}</strong>
                      <span className="hint clamp-1">{g.content.premise}</span>
                      <small>{t('进入')}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel stack">
            <h3>{t('开放世界')}</h3>
            {worlds.length === 0 ? <Empty>{t('还没有已发布的游戏')}</Empty> : (
              <ul className="item-list">
                {worlds.map(w => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className="list-button play-landing-row"
                      onClick={() => navigateHash(playWorldHash(w.id))}
                    >
                      <strong>{w.content.title} · v{w.version}</strong>
                      <span className="hint clamp-1">{w.content.premise}</span>
                      <small>{t('进入')}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
