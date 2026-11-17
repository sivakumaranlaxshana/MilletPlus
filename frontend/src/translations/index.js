import en from "./en";
import tamil from "./tamil";

// English phrases are the keys in tamil.js. Unknown phrases stay in English.
export function translate(english, lang = "en", values = []) {
  const text = lang === "ta" ? (tamil[english] ?? english) : english;
  return String(text).replace(/\{value(\d+)\}/g, (_, index) => String(values[Number(index)]));
}

// Existing dual-language components request the Tamil phrase through this helper.
export function tamilText(english, values = []) {
  return translate(english, "ta", values);
}

function translateTree(value) {
  if (typeof value === "string") return translate(value, "ta");
  if (Array.isArray(value)) return value.map(translateTree);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translateTree(item)]));
  }
  return value;
}

export const translations = { en, ta: translateTree(en) };
export const COPY = { en: translations.en.common, ta: translations.ta.common };
export const DASHBOARD_LABELS = Object.fromEntries(
  Object.keys(en.dashboard).map((key) => [key, [en.dashboard[key], translate(en.dashboard[key], "ta")]]),
);

export function getText(dictionary, path) {
  return String(path).split(".").reduce((value, key) => value?.[key], dictionary);
}
