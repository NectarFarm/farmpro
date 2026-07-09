'use client';
// Reusable language toggle for the owner/worker header. Reads and sets the
// language from useWorkerProfileStore (shared store, available everywhere).
import { useTranslation } from '@/lib/i18n/useTranslation';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useTranslation();

  return (
    <button
      onClick={() => setLang(lang === 'en' ? 'sw' : 'en')}
      className={`flex items-center gap-1.5 rounded-lg font-semibold transition-colors ${
        compact
          ? 'px-2 py-1 text-xs border border-gray-200 hover:bg-gray-100 text-gray-600'
          : 'px-3 py-1.5 text-sm border border-gray-200 hover:bg-gray-100 text-gray-700'
      }`}
      title={lang === 'en' ? 'Switch to Kiswahili' : 'Badili hadi Kiingereza'}
    >
      <span className="text-base leading-none">{lang === 'en' ? '🇰🇪' : '🇬🇧'}</span>
      <span className={compact ? 'hidden md:inline' : ''}>
        {lang === 'en' ? 'SW' : 'EN'}
      </span>
    </button>
  );
}
