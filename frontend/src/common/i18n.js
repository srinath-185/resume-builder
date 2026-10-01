import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import errors from './locales/en/errors.json';

/**
 * English ships first. UI strings use t('key', 'Default text') so the English
 * copy lives next to the component; error messages are keyed by the
 * backend's stable error codes in locales/<lang>/errors.json.
 */
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { errors } },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
