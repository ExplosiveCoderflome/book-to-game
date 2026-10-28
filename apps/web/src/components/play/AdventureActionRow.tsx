import { SYSTEM_WAIT_ACTION_ID } from '@novel-game/contracts';
import type { AdventureRollView } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { chancePercent, formatDuration } from '../../lib/s1-play';
import { RollChanceNote } from './RollChanceNote';

type ActionLike = {
  id: string;
  label: string;
  description?: string;
  timeCost: number;
  risk?: string;
  enabled: boolean;
  blockedReason?: string;
  /** Optional structured cost hints from contract — never invent client-side. */
  costHints?: string[];
  /** Mute kind eyebrow — pure text, never rainbow chip. */
  kindHint?: 'shop' | 'supply' | 'quest' | 'encounter' | 'boss';
  /** S1 C7: generated / author reasons render without the legacy「未解锁：」prefix. */
  blockedReasonKind?: 'generated' | 'author' | 'legacy';
  /** S1 C6. */
  roll?: AdventureRollView;
};

type Props = {
  action: ActionLike;
  disabled?: boolean;
  onClick: () => void;
  /** Compact inspector: hide description paragraph. */
  compact?: boolean;
  /** S1 C11: timeCost in months. */
  timeUnit?: 'month';
};

const KIND_LABEL: Record<NonNullable<ActionLike['kindHint']>, string> = {
  shop: '商店',
  supply: '补给',
  quest: '任务',
  encounter: '遭遇',
  boss: 'Boss',
};

function blockedReasonText(
  reason: string | undefined,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  if (!reason) return t('当前条件不满足');
  if (
    reason === '剩余时间不足'
    || reason === '目标人物不在此处'
    || reason === '通货不足'
    || reason === '无货'
    || reason === '未上架'
    || reason === '次数已用尽'
    || reason === '缺少所需物品'
    || reason === '此处补给尚未就绪'
    || reason === '已经了结'
    || reason === '体力不足'
  ) return t(reason);
  return reason;
}

/** Open action row: optional muted kind · label · 耗时·风险·花费(if costHints) · blockedReason. */
export function AdventureActionRow({ action, disabled, onClick, compact, timeUnit }: Props) {
  const { t } = useI18n();
  const label = action.id === SYSTEM_WAIT_ACTION_ID ? t(action.label) : action.label;
  const description = action.id === SYSTEM_WAIT_ACTION_ID && action.description
    ? t(action.description)
    : action.description;
  const risk = action.risk
    ? (action.id === SYSTEM_WAIT_ACTION_ID ? t(action.risk) : action.risk)
    : '';
  const parts: string[] = [timeUnit === 'month'
    ? (action.timeCost > 0 ? t('耗时 {duration}', { duration: formatDuration(action.timeCost, t) }) : t('不耗时'))
    : t('耗时 {time}', { time: action.timeCost })];
  if (action.roll?.chance !== undefined) parts.push(t('成功率 约 {p}%', { p: chancePercent(action.roll.chance) }));
  if (action.costHints?.length) parts.push(`${t('花费：')}${action.costHints.join(' · ')}`);
  if (risk) parts.push(`${t('风险：')}${risk}`);
  const meta = parts.join(' · ');
  const kindText = action.kindHint ? t(KIND_LABEL[action.kindHint]) : '';

  return (
    <div className={`adventure-action${action.enabled ? '' : ' is-locked'}`} data-testid="adventure-action-row" data-kind={action.kindHint ?? undefined}>
      <button type="button" disabled={disabled || !action.enabled} onClick={onClick}>
        <span className="adventure-action-body">
          {kindText ? <span className={`adventure-action-kind${action.kindHint === 'boss' ? ' is-boss' : ''}`}>{kindText}</span> : null}
          <strong className="adventure-action-label">{label}</strong>
          <span className="adventure-action-meta">{meta}</span>
        </span>
        {action.enabled && <span className="adventure-action-arrow" aria-hidden="true">→</span>}
      </button>
      {!compact && description ? <p className="adventure-action-desc">{description}</p> : null}
      {action.roll ? <RollChanceNote roll={action.roll} /> : null}
      {!action.enabled && (
        <p className="blocked-reason" data-reason-kind={action.blockedReasonKind ?? 'legacy'}>
          {action.blockedReasonKind === 'generated' || action.blockedReasonKind === 'author'
            ? action.blockedReason
            : t('未解锁：{reason}', { reason: blockedReasonText(action.blockedReason, t) })}
        </p>
      )}
    </div>
  );
}
