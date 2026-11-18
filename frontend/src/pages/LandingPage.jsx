import "./LandingPage.css";

import React, {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Link, useLocation } from "react-router-dom";

import { COPY, tamilText } from "../translations";

import {
  StableText,
  useLanguage,
} from "../translations/language";

import usePublicStocks, {
  formatStockValue,
} from "../hooks/usePublicStocks";

export {
  StableText,
  useLanguage,
} from "../translations/language";

/* -------------------- Icons -------------------- */

const ICONS = {
  leaf: (
    <>
      <path d="M12 24V12" />
      <path d="M12 15C4 15 2 9 3 4c6 0 10 4 9 11Z" />
      <path d="M12 19c0-8 4-13 10-13 0 8-3 13-10 13Z" />
    </>
  ),

  grain: (
    <>
      <path d="M12 25V4" />
      <path d="M12 9C7 9 5 6 6 3c4 0 6 3 6 6Z" />
      <path d="M12 15c-5 0-8-3-7-6 4 0 7 2 7 6Z" />
      <path d="M12 21c-5 0-8-3-7-6 4 0 7 2 7 6Z" />
      <path d="M12 9c5 0 7-3 6-6-4 0-6 3-6 6Z" />
      <path d="M12 15c5 0 8-3 7-6-4 0-7 2-7 6Z" />
      <path d="M12 21c5 0 8-3 7-6-4 0-7 2-7 6Z" />
    </>
  ),

  cart: (
    <>
      <path d="M2 3h3l3 14h11l3-10H6" />
      <circle cx="9" cy="22" r="1" />
      <circle cx="18" cy="22" r="1" />
    </>
  ),

  calendar: (
    <>
      <rect x="3" y="5" width="18" height="18" rx="2" />
      <path d="M7 2v6m10-6v6M3 11h18m-13 6 3 3 6-6" />
    </>
  ),

  people: (
    <>
      <circle cx="12" cy="7" r="3" />
      <circle cx="4" cy="9" r="2" />
      <circle cx="20" cy="9" r="2" />
      <path d="M7 23v-6a5 5 0 0 1 10 0v6" />
      <path d="M1 22v-5a3 3 0 0 1 4-3m18 8v-5a3 3 0 0 0-4-3" />
    </>
  ),

  bars: <path d="M4 23V14h4v9m3 0V8h4v15m3 0V2h4v21" />,

  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M3 24v-3a9 9 0 0 1 18 0v3" />
    </>
  ),

  mail: (
    <>
      <rect x="2" y="5" width="20" height="16" rx="2" />
      <path d="m3 7 9 7 9-7" />
    </>
  ),

  phone: (
    <>
      <rect x="6" y="2" width="12" height="22" rx="2" />
      <path d="M11 20h2" />
    </>
  ),

  lock: (
    <>
      <rect x="4" y="11" width="16" height="13" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),

  eye: (
    <>
      <path d="M1 13s4-7 11-7 11 7 11 7-4 7-11 7S1 13 1 13Z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),

  "eye-off": (
    <>
      <path d="M2 3 22 23M1 13s4-7 11-7 11 7 11 7-4 7-11 7S1 13 1 13Z" />
    </>
  ),

  shield: (
    <path d="m12 2 9 4v7c0 5-5 8-9 11-4-3-9-6-9-11V6Zm-5 11 3 3 7-8" />
  ),

  check: <path d="m4 13 5 5L21 6" />,

  arrow: <path d="M3 13h18m-7-7 7 7-7 7" />,

  close: <path d="m5 6 14 14M19 6 5 20" />,

  home: <path d="m2 11 10-9 10 9M5 9v15h14V9M10 24v-8h4v8" />,

  box: <path d="m12 2 10 5v13l-10 5-10-5V7Zm-10 5 10 6 10-6M12 13v12" />,

  orders: (
    <>
      <rect x="4" y="3" width="16" height="21" rx="2" />
      <path d="M8 8h8m-8 5h8m-8 5h5" />
    </>
  ),

  payment: (
    <>
      <rect x="2" y="5" width="20" height="16" rx="2" />
      <path d="M2 10h20M6 17h4" />
    </>
  ),

  clock: (
    <>
      <circle cx="12" cy="13" r="10" />
      <path d="M12 7v6l4 3" />
    </>
  ),

  heart: (
    <path d="M20 14 12 23 4 14C-3 6 7 0 12 7c5-7 15-1 8 7Z" />
  ),

  crown: <path d="m2 5 5 5 5-8 5 8 5-5-3 15H5ZM5 24h14" />,
};

export function Icon({
  name = "leaf",
  size = 22,
  className = "",
}) {
  return (
    <svg
      className={`mp-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] || ICONS.leaf}
    </svg>
  );
}

/* -------------------- Language helpers -------------------- */

function languageOf(t) {
  return t === COPY.ta ? "ta" : "en";
}

function translate(lang, value) {
  return lang === "ta" ? tamilText(value) : value;
}

export function Dual({ lang, en, ta }) {
  return (
    <span className="mp-copy-stack">
      <span
        className={`mp-copy-layer ${lang === "en" ? "is-visible" : ""}`}
        aria-hidden={lang !== "en"}
        lang="en"
      >
        {en}
      </span>

      <span
        className={`mp-copy-layer ${lang === "ta" ? "is-visible" : ""}`}
        aria-hidden={lang !== "ta"}
        lang="ta"
      >
        {ta}
      </span>
    </span>
  );
}

/* Compatibility export used by AuthPage.jsx */
export function MilletPageTheme() {
  return null;
}

/* -------------------- Image helper -------------------- */

function Photo({ src, alt, className = "" }) {
  return (
    <img
      className={`mp-photo ${className}`}
      src={src}
      alt={alt || ""}
      loading="lazy"
      onError={(event) => {
        const image = event.currentTarget;

        if (!image.dataset.fallback) {
          image.dataset.fallback = "true";
          image.src = "/images/millet-harvest.png";
        }
      }}
    />
  );
}

/* -------------------- Header -------------------- */

export function Header({ lang, setLang }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const text = (value) => translate(lang, value);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  const links = [
    ["home", "Home"],
    ["about", "About"],
    ["harvests", "Harvests"],
    ["contact", "Contact"],
  ];

  return (
    <header className="mp-header">
      <div className="mp-container mp-header-row">
        <Link to="/" className="mp-logo" aria-label="Millet Plus Home">
          <img src="/images/logo.png" alt="Millet Plus" />
        </Link>

        <button
          type="button"
          className="mp-menu"
          aria-label={text("Menu")}
          aria-controls="mp-public-navigation"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "✕" : "☰"}
        </button>

        <nav
          id="mp-public-navigation"
          className={`mp-nav ${open ? "open" : ""}`}
          aria-label={text("Menu")}
        >
          {links.map(([id, label]) => (
            <Link
              key={id}
              to={`/#${id}`}
              className={
                id === "home" &&
                location.pathname === "/" &&
                (!location.hash || location.hash === "#home")
                  ? "mp-active"
                  : ""
              }
              onClick={() => setOpen(false)}
            >
              {text(label)}
            </Link>
          ))}

          <div className="mp-language">
            <button
              type="button"
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              EN
            </button>

            <span aria-hidden="true">|</span>

            <button
              type="button"
              aria-pressed={lang === "ta"}
              onClick={() => setLang("ta")}
            >
              தமிழ்
            </button>
          </div>

          <Link
            to="/login"
            className="mp-button mp-red"
            onClick={() => setOpen(false)}
          >
            {text("Login")}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* -------------------- Hero illustration -------------------- */

function SilverMilletArt() {
  const filterId = useId();

  return (
    <div className="mp-pdf-art" aria-hidden="true">
      <span className="mp-pdf-red-circle" />

      <svg
        className="mp-art-mask"
        width="0"
        height="0"
        focusable="false"
      >
        <defs>
          <filter
            id={filterId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                4 -2 -2 0 -.30
              "
              result="redMask"
            />

            <feComposite
              in="SourceGraphic"
              in2="redMask"
              operator="out"
              result="withoutRed"
            />

            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                -4 8 -4 0 -.40
              "
              result="greenMask"
            />

            <feComposite
              in="withoutRed"
              in2="greenMask"
              operator="out"
            />
          </filter>
        </defs>
      </svg>

      <img
        src="/images/banner-buyer-art.png"
        alt=""
        fetchPriority="high"
        style={{ filter: `url("#${filterId}")` }}
      />
    </div>
  );
}

/* -------------------- Feature cards -------------------- */

export function Features({ t }) {
  const lang = languageOf(t);
  const text = (value) => translate(lang, value);

  const features = [
    ["leaf", "AI Crop Care", "Get guidance for healthier crops."],
    ["grain", "Harvest Support", "Tools for better harvest planning."],
    ["cart", "Millet Shopping", "Explore quality millet and current prices."],
  ];

  return (
    <section className="mp-container mp-features">
      {features.map(([icon, title, description]) => (
        <article className="mp-feature" key={icon}>
          <span className="mp-feature-icon">
            <Icon name={icon} size={30} />
          </span>

          <div>
            <h2>{text(title)}</h2>
            <p>{text(description)}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

/* -------------------- Growing tips -------------------- */

export function Lessons({ t, register = false }) {
  const lang = languageOf(t);
  const text = (value) => translate(lang, value);

  const lessons = [
    [
      "soil.png",
      "Start with Healthy Soil",
      "Understand your soil and prepare for planting.",
    ],
    [
      "crop-care.png",
      "Care at Every Stage",
      "Explore watering and crop care tips.",
    ],
    [
      "crop-leaf.png",
      "Know Your Crop",
      "Recognise changes in your plants and learn when to seek aid.",
    ],
    [
      "millet-harvest.png",
      "Make Every Harvest Count",
      "Learn how to harvest, dry and store your millet.",
    ],
  ];

  return (
    <section className="mp-lessons" id="growing-tips">
      <div className="mp-container">
        <div className="mp-heading mp-center" id="about">
          <h2>
            {text(
              register
                ? "Join a community that grows healthier crops, stronger farms and brighter futures."
                : "Your next season starts with a little knowledge.",
            )}
          </h2>

          {!register && (
            <p>
              {text(
                "Learn to prepare your soil, care for your crops, and harvest with confidence.",
              )}
            </p>
          )}
        </div>

        <div className="mp-four-grid">
          {lessons.map(([image, title, description]) => (
            <article className="mp-lesson" key={image}>
              <Photo
                src={`/images/${image}`}
                alt={text(title)}
              />

              <h3>{text(title)}</h3>
              <p>{text(description)}</p>
            </article>
          ))}
        </div>

        {!register && (
          <div className="mp-center mp-space">
            <Link
              to="/register?role=farmer"
              className="mp-button mp-red"
            >
              {text("Explore Growing Tips")}
              <Icon name="arrow" size={18} />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------- Subscription cards -------------------- */

function SubscriptionCards({ lang }) {
  const text = (value) => translate(lang, value);

  return (
    <section className="mp-small-plans" id="subscriptions">
      <div className="mp-container mp-small-plan-grid">
        <article className="mp-small-plan">
          <span className="mp-plan-icon">
            <Icon name="leaf" size={36} />
          </span>

          <div className="mp-plan-copy">
            <h3>{text("First crop cycle")}</h3>
            <strong>{text("FREE")}</strong>
          </div>
        </article>

        <article className="mp-small-plan">
          <span className="mp-plan-icon">
            <Icon name="calendar" size={34} />
          </span>

          <div className="mp-plan-copy">
            <h3>{text("Farmer support")}</h3>
            <strong>
              LKR 500 / {text("month")}
            </strong>
          </div>

          <Link
            to="/login"
            className="mp-button mp-red"
          >
            {text("View plans")}
          </Link>
        </article>
      </div>
    </section>
  );
}

/* -------------------- Footer -------------------- */

export function Footer({ t }) {
  const lang = languageOf(t);
  const text = (value) => translate(lang, value);

  return (
    <footer className="mp-footer" id="contact">
      <div className="mp-container">
        <div className="mp-footer-grid">
          <div>
            <Link to="/" className="mp-footer-logo">
              <img src="/images/logo.png" alt="Millet Plus" />
            </Link>

            <p>
              {text(
                "Crop guidance for farmers. Quality millet for buyers.",
              )}
            </p>

            <strong>
              {text("Better crops. Stronger communities.")}
            </strong>
          </div>

          <div>
            <h2>{text("Explore Millet Plus")}</h2>

            <div className="mp-footer-links">
              <Link to="/#home">{text("Home")}</Link>
              <Link to="/#about">{text("About")}</Link>
              <Link to="/#harvests">{text("Harvests")}</Link>
              <Link to="/#growing-tips">{text("Crop Guidance")}</Link>
              <Link to="/login">{text("Login")}</Link>
            </div>

            <p>EN / தமிழ்</p>
          </div>
        </div>

        <div className="mp-footer-bottom">
          <span>
            Millet Plus © {new Date().getFullYear()}
          </span>

          <span>
            {text("Growing together, season after season.")}
          </span>
        </div>
      </div>
    </footer>
  );
}

/* -------------------- Shared dialog -------------------- */

export function Dialog({
  title,
  onClose,
  t,
  children,
  busy = false,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="mp-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      <div className="mp-dialog-heading">
        <h2 id={titleId}>{title}</h2>

        <button
          type="button"
          className="mp-close"
          disabled={busy}
          aria-label={t?.close || "Close"}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {children}
    </dialog>
  );
}

/* -------------------- Stock images -------------------- */

const VARIETY_IMAGES = {
  "pearl millet": "pearl-millet.png",
  "finger millet": "finger-millet.png",
  "foxtail millet": "foxtail-millet.png",
  "little millet": "little-millet.png",
};

function stockImage(stock) {
  if (stock.image_url) {
    return stock.image_url;
  }

  const name = String(stock.variety_name || "")
    .trim()
    .toLowerCase();

  const match = Object.keys(VARIETY_IMAGES).find((key) =>
    name.includes(key),
  );

  return `/images/${
    match ? VARIETY_IMAGES[match] : "millet-harvest.png"
  }`;
}

/* -------------------- Landing page -------------------- */

export default function LandingPage() {
  const { lang, setLang, t } = useLanguage();
  const location = useLocation();

  const {
    records = [],
    loading,
    refreshing,
    error,
    refresh,
  } = usePublicStocks({ limit: 8 });

  const stocks = Array.isArray(records) ? records : [];
  const [selectedId, setSelectedId] = useState(null);

  const text = (value) => translate(lang, value);

  const selectedStock = stocks.find(
    (stock) => stock.id === selectedId,
  );

  const value = (number) =>
    formatStockValue(number ?? 0, lang);

  useEffect(() => {
    if (!location.hash) return;

    const frame = requestAnimationFrame(() => {
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({ block: "start" });
    });

    return () => cancelAnimationFrame(frame);
  }, [location.hash]);

  return (
    <div
      id="mp-public-page"
      className="mp-site mp-final-landing mp-wine-theme"
      lang={lang}
    >
      <Header
        lang={lang}
        setLang={setLang}
        t={t}
      />

      <main>
        <section className="mp-hero" id="home">
          <div className="mp-container mp-hero-grid">
            <div className="mp-hero-copy">
              <p className="mp-eyebrow">
                {text("GROW SMARTER. LIVE BETTER.")}
              </p>

              <h1 className="mp-stepped-title">
                <span>{text("Grow with care.")}</span>
                <span>{text("Harvest with")}</span>
                <span>{text("confidence.")}</span>
              </h1>

              <div className="mp-actions">
                <Link
                  to="/register?role=farmer"
                  className="mp-button mp-red"
                >
                  {text("I’m a Farmer")}
                </Link>

                <Link
                  to="/register?role=buyer"
                  className="mp-button mp-white"
                >
                  {text("I’m a Buyer")}
                </Link>
              </div>
            </div>

            <SilverMilletArt />
          </div>
        </section>

        <Features t={t} />

        <Lessons t={t} />

        <section className="mp-harvests" id="harvests">
          <div className="mp-container">
            <div className="mp-row-heading">
              <div className="mp-heading">
                <h2>{text("Available Harvests")}</h2>

                <p>
                  {text(
                    "Explore quality millet and find the right grain for your needs.",
                  )}
                </p>
              </div>

              <button
                type="button"
                className="mp-text-button"
                disabled={loading || refreshing}
                onClick={() => refresh()}
              >
                {text("Refresh")} ↻
              </button>
            </div>

            {loading ? (
              <div className="mp-state" role="status">
                {text("Loading stock…")}
              </div>
            ) : error ? (
              <div className="mp-state" role="alert">
                <p>
                  {text(
                    "Stock could not be loaded. Please try again.",
                  )}
                </p>

                <button
                  type="button"
                  className="mp-button mp-green mp-space"
                  disabled={refreshing}
                  onClick={() => refresh()}
                >
                  {text("Retry")}
                </button>
              </div>
            ) : stocks.length === 0 ? (
              <div className="mp-state">
                <h3>{text("No stock available yet.")}</h3>

                <p>
                  {text(
                    "Available millets will appear here when stock is ready.",
                  )}
                </p>
              </div>
            ) : (
              <div className="mp-four-grid">
                {stocks.map((stock) => {
                  const available =
                    Number(stock.available_quantity) > 0;

                  return (
                    <article
                      className="mp-harvest-card"
                      key={stock.id}
                    >
                      <div className="mp-harvest-photo">
                        <Photo
                          src={stockImage(stock)}
                          alt={stock.variety_name}
                        />

                        <span
                          className={`mp-status ${
                            available ? "" : "mp-status-empty"
                          }`}
                        >
                          {text(
                            available
                              ? "Available"
                              : "Out of Stock",
                          )}
                        </span>
                      </div>

                      <h3>
                        {text(stock.variety_name || "Millet")}
                      </h3>

                      <p className="mp-stock-quantity">
                        {text("Available")}:{" "}
                        {value(stock.available_quantity)} kg
                      </p>

                      <strong className="mp-stock-price">
                        LKR{" "}
                        {value(stock.selling_price_per_kg)}
                        {" / kg"}
                      </strong>

                      <button
                        type="button"
                        className="mp-button mp-green"
                        onClick={() => setSelectedId(stock.id)}
                      >
                        {text("View Details")}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            <p className="mp-caption">
              {text(
                "Stock availability and prices are updated from current inventory.",
              )}
            </p>
          </div>
        </section>

        <SubscriptionCards lang={lang} />

        <section className="mp-cta">
          <div className="mp-container mp-cta-row">
            <h2>
              {text("Better crops. Stronger communities.")}
            </h2>

            <Link
              to="/register"
              className="mp-button mp-red"
            >
              {text("Get started")}
            </Link>
          </div>
        </section>
      </main>

      <Footer t={t} />

      {selectedId !== null && (
        <Dialog
          title={
            selectedStock
              ? text(selectedStock.variety_name || "Millet")
              : text("Stock")
          }
          t={t}
          onClose={() => setSelectedId(null)}
        >
          {selectedStock ? (
            <>
              <Photo
                src={stockImage(selectedStock)}
                alt={selectedStock.variety_name}
                className="mp-dialog-photo"
              />

              <dl className="mp-detail-list">
                <div>
                  <dt>{text("Available")}</dt>
                  <dd>
                    {value(selectedStock.available_quantity)} kg
                  </dd>
                </div>

                <div>
                  <dt>{text("Price / kg")}</dt>
                  <dd>
                    LKR{" "}
                    {value(selectedStock.selling_price_per_kg)}
                  </dd>
                </div>

                <div>
                  <dt>{text("Status")}</dt>
                  <dd>
                    {text(
                      Number(selectedStock.available_quantity) > 0
                        ? "In stock"
                        : "Out of Stock",
                    )}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p>
              {text(
                "Stock details are not available right now. Please refresh.",
              )}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}