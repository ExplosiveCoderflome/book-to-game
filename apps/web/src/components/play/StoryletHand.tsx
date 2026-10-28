import type { AdventureHandView } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { AdventureActionRow } from './AdventureActionRow';

type Props = { hand: AdventureHandView[]; busy: boolean; onAct: (id: string) => void; timeUnit?: 'month' };

/** U4 / S1-U6: 1 card = flat open; ≥2 = exclusive accordion (`<details name>`), default open = first urgent else first. */
export function StoryletHand({ hand, busy, onAct, timeUnit }: Props) {
  const { t } = useI18n();
  const openIndex = Math.max(0, hand.findIndex(h => h.urgent));
  return (
    <section className="storylet-hand" data-testid="storylet-hand">
      <p className="adventure-subhead">
        <span>{t('剧情 · {n} 张', { n: hand.length })}</span>
        <span className="adventure-subhead-note">{t('移动或时间流逝会换牌')}</span>
      </p>
      {hand.length === 0 ? <p className="hint">{t('此处暂时没有剧情。移动或让时间过去，会有新的事找上门。')}</p> : null}
      {hand.map((card, i) => hand.length === 1
        ? <StoryletCard key={card.storyletId} card={card} busy={busy} onAct={onAct} timeUnit={timeUnit} flat />
        : <StoryletCard key={card.storyletId} card={card} busy={busy} onAct={onAct} timeUnit={timeUnit} defaultOpen={i === openIndex} />)}
    </section>
  );
}

function StoryletCard({ card, busy, onAct, timeUnit, flat, defaultOpen }: {card: AdventureHandView; busy: boolean; onAct: (id: string) => void; timeUnit?: 'month'; flat?: boolean; defaultOpen?: boolean}) {
  const { t } = useI18n();
  const tags = [
    card.urgent ? t('急事') : null,
    card.inWindow ? t('限时') : null,
    card.repeatable && card.seenCount >= 1 ? t('再遇 · 第 {n} 次', { n: card.seenCount + 1 }) : null,
    card.fresh ? t('新到') : null,
  ].filter(Boolean).join(' · ');
  const head = (
    <>
      <strong className="storylet-title">{card.title}</strong>
      {tags ? <span className="storylet-tags">{tags}</span> : null}
      {!flat ? <span className="storylet-excerpt" aria-hidden="true">{card.text.replace(/\s+/g, ' ')}</span> : null}
    </>
  );
  const body = (
    <>
      <div className="storylet-body">{card.text.split(/\n+/).map((line, i) => <p key={i}>{line}</p>)}</div>
      <div className="storylet-choices">
        {card.choices.map(choice => (
          <AdventureActionRow key={choice.id} action={choice} disabled={busy} timeUnit={timeUnit} onClick={() => onAct(choice.id)} compact />
        ))}
      </div>
    </>
  );
  if (flat) return <div className="storylet is-flat" data-testid="storylet-card" data-storylet={card.storyletId}><div className="storylet-head">{head}</div>{body}</div>;
  return (
    // `name` gives native exclusive-accordion behaviour in current browsers.
    <details className="storylet" name="hand" open={defaultOpen} data-testid="storylet-card" data-storylet={card.storyletId}>
      <summary className="storylet-head">{head}</summary>
      {body}
    </details>
  );
}
