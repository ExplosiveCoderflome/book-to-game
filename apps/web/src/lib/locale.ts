import { storyEnglish } from './story-translations';
import { workspaceEnglish } from './workspace-translations';

export const supportedLocales = ['zh-CN', 'en-US'] as const;
export type Locale = typeof supportedLocales[number];
export const localeStorageKey = 'novel-game.locale';
export const englishTranslations: Record<string, string> = {...storyEnglish, ...workspaceEnglish};
export type TranslationParams = Record<string, string | number>;

export function resolveLocale(input?: string | readonly string[] | null): Locale {
  for (const value of typeof input === 'string' ? [input] : input ?? []) {
    const language = value.toLowerCase().replaceAll('_', '-').split('-')[0];
    if (language === 'zh') return 'zh-CN';
    if (language === 'en') return 'en-US';
  }
  return 'zh-CN';
}

export function readLocale(storage?: Pick<Storage, 'getItem'> | null, browserLanguages?: readonly string[]): Locale {
  try {
    const saved = storage?.getItem(localeStorageKey);
    if (supportedLocales.some(locale => locale === saved)) return saved as Locale;
  } catch { /* Browser storage can be unavailable. */ }
  return resolveLocale(browserLanguages);
}

export function persistLocale(storage: Pick<Storage, 'setItem'> | null | undefined, locale: Locale): void {
  try { storage?.setItem(localeStorageKey, locale); } catch { /* Language changes still work in memory. */ }
}

export function translate(locale: Locale, key: string, params: TranslationParams = {}): string {
  const template = locale === 'en-US' && Object.hasOwn(englishTranslations, key) ? englishTranslations[key] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}
