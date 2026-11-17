import React, { useEffect, useSyncExternalStore } from "react";
import { COPY, getText } from "./index";

const STORAGE_KEY = "millet_language";
const listeners = new Set();
let memoryLanguage = "en";

function readLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) memoryLanguage = stored === "ta" ? "ta" : "en";
  } catch {
    // Language switching still works when browser storage is blocked.
  }
  return memoryLanguage;
}

function emitChange() {
  for (const listener of listeners) listener();
}

function onStorage(event) {
  if (event.key === STORAGE_KEY || event.key === null) {
    memoryLanguage = event.newValue === "ta" ? "ta" : "en";
    emitChange();
  }
}

function subscribe(listener) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setLanguage(value) {
  // Never let an invalid language break translation lookups.
  if (value !== "en" && value !== "ta") return;
  memoryLanguage = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Keep the selected language in memory for this session.
  }
  emitChange();
}

export function useSharedLanguage() {
  const lang = useSyncExternalStore(subscribe, readLanguage, () => "en");
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return { lang, setLang: setLanguage };
}

export function StableText({ lang, path }) {
  function render(value) {
    if (!Array.isArray(value)) return value;
    return value.map((line, index) => (
      <span className="mp-copy-line" key={index}>{line}</span>
    ));
  }
  return (
    <span className="mp-copy-stack">
      {["en", "ta"].map((language) => (
        <span
          key={language}
          lang={language}
          className={`mp-copy-layer ${language === lang ? "is-visible" : ""}`}
          aria-hidden={language !== lang}
        >
          {render(getText(COPY[language], path) ?? getText(COPY.en, path) ?? path)}
        </span>
      ))}
    </span>
  );
}

export function useLanguage() {
  const { lang, setLang } = useSharedLanguage();
  return {
    lang,
    setLang,
    t: COPY[lang],
    ui: (path) => <StableText lang={lang} path={path} />,
  };
}
