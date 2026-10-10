import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { readLocale, persistLocale, translate, type Locale, type TranslationParams } from './locale';
export { translate, resolveLocale, readLocale, persistLocale, supportedLocales, localeStorageKey } from './locale';
export type { Locale, TranslationParams } from './locale';

const I18nContext = createContext({locale: 'zh-CN' as Locale, setLocale: (_locale: Locale) => {}, t: (key: string, params?: TranslationParams) => translate('zh-CN', key, params)});
function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function I18nProvider({children}: {children: ReactNode}) {
  const [locale, setLocale] = useState<Locale>(() => readLocale(browserStorage(), navigator.languages?.length ? navigator.languages : [navigator.language]));
  const t = useCallback((key: string, params?: TranslationParams) => translate(locale, key, params), [locale]);
  useEffect(() => {
    persistLocale(browserStorage(), locale);
    document.documentElement.lang = locale;
    document.title = t('故事工坊 · 小说转文字游戏');
  }, [locale, t]);
  return <I18nContext.Provider value={{locale, setLocale, t}}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
