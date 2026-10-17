import { createInstance, type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import id from "./locales/id.json";

export const LANGUAGES = ["id", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "id";

export const resources = {
  id: { translation: id },
  en: { translation: en },
} as const;

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

const instances = new Map<Language, I18n>();

/**
 * One initialised i18next instance per language, shared by server render and
 * hydration. Resources are bundled, so init is synchronous and SSR output
 * matches the client on first paint.
 */
export function getI18n(language: Language): I18n {
  let instance = instances.get(language);
  if (!instance) {
    instance = createInstance();
    void instance.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...LANGUAGES],
      interpolation: { escapeValue: false },
      initAsync: false,
      react: { useSuspense: false },
    });
    instances.set(language, instance);
  }
  return instance;
}
