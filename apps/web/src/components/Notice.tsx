import { useI18n, type Locale, type TranslationParams } from '../lib/i18n';

export function Notice({ text, kind = 'error', params }: { text: string | null; kind?: 'error' | 'success' | 'info'; params?: TranslationParams }) {
  const { t } = useI18n();
  return text ? <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{t(text, params)}</div> : null;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty"><span aria-hidden="true">◇</span><p>{children}</p></div>;
}

export function dateLabel(value: string, locale: Locale = 'zh-CN') {
  return new Date(value).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
