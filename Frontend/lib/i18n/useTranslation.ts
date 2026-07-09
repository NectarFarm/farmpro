'use client';
import { useState, useCallback, useEffect } from 'react';
import { t as translate, setLanguage, getLanguage, type TranslationKey } from '@/lib/i18n/translations';
import { useWorkerProfileStore } from '@/lib/stores/workerProfile';

// React hook that syncs with the worker profile store's language setting.
// Returns a `t` function for translation and a setter.
// Falls back to 'en' when no profile store is available (e.g. owner/admin pages).
export function useTranslation() {
  const storeLang = useWorkerProfileStore((s) => s.lang);
  const [lang, setLangState] = useState<'en' | 'sw'>(storeLang ?? 'en');

  useEffect(() => {
    setLanguage(storeLang);
    setLangState(storeLang);
  }, [storeLang]);

  const changeLang = useCallback((l: 'en' | 'sw') => {
    setLanguage(l);
    setLangState(l);
    // Update the store if available
    try {
      useWorkerProfileStore.getState().setLang(l);
    } catch { /* noop — might not exist in all contexts */ }
  }, []);

  return {
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(key, params),
    lang,
    setLang: changeLang,
    isSw: lang === 'sw',
  };
}

// Direct function for non-hook contexts (server components, pure functions)
export { translate as t };
export type { TranslationKey };
