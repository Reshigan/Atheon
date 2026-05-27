/**
 * Roadmap C4 — i18n stub.
 *
 * Lightweight i18n provider that mirrors the `react-i18next` API surface
 * (`useTranslation` → `{ t, i18n }`) without taking on the dependency.
 * When the project eventually adopts react-i18next, swap this provider
 * for `<I18nextProvider>` and the rest of the codebase keeps working.
 *
 * Why not react-i18next today: it adds two npm deps (i18next +
 * react-i18next) and a runtime backend layer, none of which are needed
 * to ship the en-ZA default + Afrikaans toggle the customer asked for.
 *
 * Locale resolution:
 *   1. window.localStorage['atheon.locale'] if set and supported
 *   2. props.defaultLocale (caller's choice, ideally 'en' aliased en-ZA)
 *   3. 'en'
 *
 * Fallback chain on a missing key:
 *   current → 'en' → the key itself (so the UI never renders `undefined`)
 *
 * Interpolation: `t('greeting', { name: 'Ada' })` substitutes `{{name}}`
 * tokens in the catalog. Keeps it cheap — no plural rules, no contexts.
 * If we need those, that's the trigger to bring in react-i18next proper.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { enMessages } from './en';
import { afMessages } from './af';
import type { SupportedLocale } from './index';

const CATALOGS: Record<SupportedLocale, Record<string, string>> = {
  en: enMessages,
  af: afMessages,
};

const STORAGE_KEY = 'atheon.locale';

export interface I18nApi {
  language: SupportedLocale;
  changeLanguage: (l: SupportedLocale) => void;
}

export interface UseTranslationResult {
  t: (key: string, options?: Record<string, string | number>) => string;
  i18n: I18nApi;
}

const I18nContext = createContext<UseTranslationResult | null>(null);

function readStoredLocale(): SupportedLocale | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'en' || raw === 'af') return raw;
  } catch { /* localStorage disabled — fine */ }
  return null;
}

export interface I18nProviderProps {
  children: ReactNode;
  /** Locale to use when nothing is stored. Default is 'en' (en-ZA alias). */
  defaultLocale?: SupportedLocale;
}

export function I18nProvider({ children, defaultLocale = 'en' }: I18nProviderProps) {
  const [language, setLanguage] = useState<SupportedLocale>(() => readStoredLocale() ?? defaultLocale);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* ignore */ }
  }, [language]);

  const t = useCallback((key: string, options?: Record<string, string | number>): string => {
    const primary = CATALOGS[language]?.[key];
    const fallback = CATALOGS.en[key];
    let raw = primary ?? fallback ?? key;
    if (options) {
      for (const [token, value] of Object.entries(options)) {
        raw = raw.replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g'), String(value));
      }
    }
    return raw;
  }, [language]);

  const value = useMemo<UseTranslationResult>(() => ({
    t,
    i18n: { language, changeLanguage: setLanguage },
  }), [t, language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Drop-in compatible with react-i18next's `useTranslation`. Returns a
 * stable `{ t, i18n }` shape so a future migration is a one-line import
 * swap at each callsite.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation(): UseTranslationResult {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Provider-less fallback: keep the same shape so `t(key)` still
  // returns sensible English. Lets us add useTranslation() calls inside
  // components rendered in tests that don't wrap in <I18nProvider>.
  return {
    t: (key, options) => {
      let raw = CATALOGS.en[key] ?? key;
      if (options) {
        for (const [token, value] of Object.entries(options)) {
          raw = raw.replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g'), String(value));
        }
      }
      return raw;
    },
    i18n: { language: 'en', changeLanguage: () => { /* noop without provider */ } },
  };
}
