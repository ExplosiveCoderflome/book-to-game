import type { SaveStoreStatus } from '@novel-game/play-runtime';
import { useI18n } from '../lib/i18n';
import { EXE_BANNER_COPY } from './package-copy';

/**
 * One amber strip on every package state while saves are at risk (UI plan M1b-1 §3.x, M1b-2 §3.5).
 * Not closable; announced once (role=status). Only one at a time: unsaved > fallback.
 */
export function StorageBanner({ status }: { status: SaveStoreStatus }) {
  const { t } = useI18n();
  const exe = status.where !== 'browser';
  if (!status.persistent) {
    const reason = exe
      ? t(EXE_BANNER_COPY.unsavedExe)
      : status.reason === 'unavailable'
        ? t('浏览器禁用了本地存储。仍可正常游玩。')
        : status.reason === 'write-failed' ? t('浏览器存储空间已满。仍可正常游玩。') : t('仍可正常游玩。');
    return (
      <div className="storage-banner" role="status" data-testid="storage-banner" data-variant={exe ? 'exe-unsaved' : 'unsaved'}>
        <strong>{t('无法保存，本局关闭后不会保留。')}</strong>
        <span>{reason}</span>
      </div>
    );
  }
  if (status.where === 'host-fallback') {
    const writeFailed = status.fallbackReason === 'host-write-failed';
    return (
      <div className="storage-banner" role="status" data-testid="storage-banner" data-variant={writeFailed ? 'fallback-write' : 'fallback-host'}>
        <strong>{t(EXE_BANNER_COPY.fallbackTitle)}</strong>
        <span>{t(writeFailed ? EXE_BANNER_COPY.fallbackWriteFailed : EXE_BANNER_COPY.fallbackHost)}</span>
      </div>
    );
  }
  return null;
}
