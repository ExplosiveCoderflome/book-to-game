import { useI18n } from '../../lib/i18n';
import { navigateHash, playStoryHash, playWorldHash } from '../../lib/play-route';

type Props = {
  mode: 'story' | 'world';
  revisionId: string;
  className?: string;
  label?: string;
  disabled?: boolean;
};

/** Author shell: same-tab navigate into player deep link (A2). */
export function OpenPlayerShellButton({ mode, revisionId, className = 'quiet', label, disabled }: Props) {
  const { t } = useI18n();
  if (!revisionId) return null;
  return (
    <button
      type="button"
      className={className}
      data-testid="open-player-shell"
      disabled={disabled}
      onClick={() => {
        navigateHash(mode === 'story' ? playStoryHash(revisionId) : playWorldHash(revisionId));
      }}
    >
      {label ?? t('打开玩家试玩')}
    </button>
  );
}
