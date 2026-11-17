import "./LandingPage.css";

import React, {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  Link,
  useLocation,
} from "react-router-dom";

import {
  COPY,
  tamilText,
} from "../translations";

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

function getUI(t) {
  const lang = t === COPY.ta ? "ta" : "en";

  return (path) => (
    <StableText lang={lang} path={path} />
  );
}

function Photo({ src, alt }) {
  return (
    <img
      className="mp-photo"
      src={src}
      alt={alt}
      loading="lazy"
      onError={(event) => {
        const image = event.currentTarget;

        if (!image.dataset.fallback) {
          image.dataset.fallback = "1";
          image.src = "/images/millet-harvest.png";
        }
      }}
    />
  );
}

const ICONS = {
  leaf: (
    <path d="M12 22V12M12 15C4 16 2 10 3 4c7-1 10 3 9 10M12 17c0-8 4-12 10-12 1 7-3 11-10 12" />
  ),

  grain: (
    <path d="M12 23V5M12 8C7 8 5 5 6 2c4 0 6 3 6 6m0 5c-5 0-8-3-7-6 4 0 7 2 7 6m0 5c-6 0-8-3-7-6 4 0 7 2 7 6m0-10c5 0 7-3 6-6-4 0-6 3-6 6m0 5c5 0 8-3 7-6-4 0-7 2-7 6m0 5c6 0 8-3 7-6-4 0-7 2-7 6" />
  ),

  people: (
    <>
      <circle cx="12" cy="7" r="3" />
      <circle cx="4" cy="9" r="2" />
      <circle cx="20" cy="9" r="2" />
      <path d="M7 22v-6a5 5 0 0 1 10 0v6M1 21v-5a3 3 0 0 1 4-3m18 8v-5a3 3 0 0 0-4-3" />
    </>
  ),

  bars: (
    <path d="M4 22V13h4v9M10 22V8h4v14M16 22V2h4v20" />
  ),

  cart: (
    <>
      <path d="M2 3h3l3 13h11l3-9H6" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),

  home: (
    <path d="m2 11 10-9 10 9M5 9v13h14V9M10 22v-8h4v8" />
  ),

  calendar: (
    <>
      <rect x="3" y="5" width="18" height="17" rx="2" />
      <path d="M7 2v6m10-6v6M3 11h18m-13 4h1m3 0h1m3 0h1m-9 4h1m3 0h1" />
    </>
  ),

  heart: (
    <>
      <path d="M20 13 12 22 4 13C-3 5 7-1 12 6c5-7 15-1 8 7" />
      <path d="M2 12h6l2-4 3 8 2-4h7" />
    </>
  ),

  crown: (
    <path d="m2 5 5 5 5-8 5 8 5-5-3 14H5zM5 23h14" />
  ),

  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M3 23v-3a9 9 0 0 1 18 0v3" />
    </>
  ),

  box: (
    <path d="m12 2 10 5v12l-10 5-10-5V7zM2 7l10 5 10-5M12 12v12M7 4l10 5" />
  ),

  orders: (
    <>
      <rect x="4" y="3" width="16" height="20" rx="2" />
      <path d="M8 8h8m-8 5h8m-8 5h5" />
    </>
  ),

  payment: (
    <>
      <rect x="2" y="5" width="20" height="15" rx="2" />
      <path d="M2 10h20M6 16h4" />
    </>
  ),

  shield: (
    <path d="m12 2 9 4v7c0 5-5 8-9 11-4-3-9-6-9-11V6zM7 13l3 3 7-8" />
  ),

  check: <path d="m4 12 5 5L21 5" />,

  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 5v8l5 3" />
    </>
  ),

  location: (
    <>
      <path d="M20 10c0 6-8 13-8 13S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),

  plus: <path d="M12 3v18M3 12h18" />,

  arrow: <path d="M2 12h19m-6-6 6 6-6 6" />,

  edit: (
    <path d="m3 16 13-13 5 5L8 21l-6 1zM14 5l5 5" />
  ),

  upload: (
    <path d="M12 17V2M6 8l6-6 6 6M3 16v7h18v-7" />
  ),

  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 7 7" />
    </>
  ),

  logout: (
    <path d="M9 3H3v18h6M9 12h13m-5-5 5 5-5 5" />
  ),

  eye: (
    <>
      <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),

  eyeOff: (
    <path d="m2 2 20 20M9 4c6-2 11 3 14 8-1 2-2 4-4 5M6 6c-2 2-4 4-5 6 4 7 10 10 16 7" />
  ),

  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 6 10 8L22 6" />
    </>
  ),

  lock: (
    <>
      <rect x="4" y="11" width="16" height="12" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4M12 16v3" />
    </>
  ),

  phone: (
    <path d="M6 2 2 6c1 9 7 15 16 16l4-4-6-4-3 3c-3-1-5-3-6-6l3-3z" />
  ),

  cloud: (
    <>
      <path d="M6 19a5 5 0 1 1 1-10 7 7 0 0 1 13 2 4 4 0 1 1 0 8Z" />
      <path d="m8 22-1 2m7-2-1 2m7-2-1 2" />
    </>
  ),

  sun: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 0v3m0 18v3M0 12h3m18 0h3M3 3l2 2m14 14 2 2M3 21l2-2M19 5l2-2" />
    </>
  ),

  menu: <path d="M3 5h18M3 12h18M3 19h18" />,

  close: <path d="m5 5 14 14M5 19 19 5" />,
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

export function Dual({ lang, en, ta }) {
  return (
    <span className="mp-copy-stack">
      <span
        className={`mp-copy-layer ${
          lang === "en" ? "is-visible" : ""
        }`}
        aria-hidden={lang !== "en"}
        lang="en"
      >
        {en}
      </span>

      <span
        className={`mp-copy-layer ${
          lang === "ta" ? "is-visible" : ""
        }`}
        aria-hidden={lang !== "ta"}
        lang="ta"
      >
        {ta}
      </span>
    </span>
  );
}

export function Header({ lang, setLang, t }) {
  const ui = getUI(t);
  const location = useLocation();
  const [open, setOpen] = useState(false);

  function jump(id) {
    setOpen(false);

    if (location.pathname !== "/") return;

    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  return (
    <header className="mp-header">
      <div className="mp-container mp-header-row">
        <Link to="/" className="mp-logo">
          <img
            src="/images/logo.png"
            alt="Millet Plus"
          />
        </Link>

        <button
          className="mp-menu"
          type="button"
          aria-label={
            lang === "ta" ? tamilText("Menu") : "Menu"
          }
          aria-controls="mp-nav"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "✕" : "☰"}
        </button>

        <nav
          id="mp-nav"
          className={`mp-nav ${open ? "open" : ""}`}
        >
          {["home", "about", "harvests", "contact"].map(
            (id) => (
              <Link
                key={id}
                to={{
                  pathname: "/",
                  hash: `#${id}`,
                }}
                onClick={() => jump(id)}
              >
                {ui(id)}
              </Link>
            ),
          )}

          <div className="mp-language">
            <button
              type="button"
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              EN
            </button>

            <span>|</span>

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
            {ui("login")}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Features({ t }) {
  const ui = getUI(t);

  return (
    <section className="mp-container mp-features">
      {t.features.map((_, index) => (
        <article className="mp-feature" key={index}>
          <span
            className="mp-feature-icon"
            aria-hidden="true"
          >
            <Icon
              name={["leaf", "grain", "cart"][index] || "leaf"}
              size={28}
            />
          </span>

          <div>
            <h2>{ui(`features.${index}.1`)}</h2>
            <p>{ui(`features.${index}.2`)}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export function Lessons({ t }) {
  const ui = getUI(t);

  return (
    <section className="mp-lessons" id="growing-tips">
      <div className="mp-container">
        <div className="mp-heading mp-center">
          <h2>{ui("lessonTitle")}</h2>
          <p>{ui("lessonText")}</p>
        </div>

        <div className="mp-four-grid">
          {t.lessons.map(([image, title], index) => (
            <article className="mp-lesson" key={image}>
              <Photo
                src={`/images/${image}`}
                alt={title}
              />

              <h3>{ui(`lessons.${index}.1`)}</h3>
              <p>{ui(`lessons.${index}.2`)}</p>
            </article>
          ))}
        </div>

        <div className="mp-center mp-space">
          <Link
            className="mp-button mp-red"
            to="/register?role=farmer"
          >
            {ui("startRecords")} →
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Footer({ t }) {
  const ui = getUI(t);

  return (
    <footer className="mp-footer" id="contact">
      <div className="mp-container">
        <div className="mp-footer-grid">
          <div>
            <Link to="/" className="mp-footer-logo">
              <img
                src="/images/logo.png"
                alt="Millet Plus"
              />
            </Link>

            <p>{ui("footerText")}</p>
            <strong>{ui("cta")}</strong>
          </div>

          <div>
            <h2>{ui("explore")}</h2>

            <Link to="/#home">{ui("home")}</Link>
            <Link to="/#about">{ui("about")}</Link>
            <Link to="/#harvests">{ui("harvests")}</Link>

            <p>{ui("languages")}</p>
          </div>

          <div>
            <h2>{ui("support")}</h2>
            <p>{ui("region")}</p>
            <p>{ui("supportText")}</p>
          </div>
        </div>

        <div className="mp-footer-bottom">
          <span>
            © {new Date().getFullYear()} Millet Plus
          </span>

          <span>{ui("footerLine")}</span>
        </div>
      </div>
    </footer>
  );
}

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

    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
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
          className="mp-close"
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label={t.close}
        >
          ✕
        </button>
      </div>

      {children}
    </dialog>
  );
}

const VARIETY_IMAGES = {
  "pearl millet": "pearl-millet.png",
  "finger millet": "finger-millet.png",
  "foxtail millet": "foxtail-millet.png",
  "little millet": "little-millet.png",
};

function SilverMilletArt() {
  const filterId = useId();

  return (
    <div className="mp-hero-art" aria-hidden="true">
      <svg
        className="mp-hero-filter"
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
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4 -2 -2 0 -.30"
              result="redMask"
            />

            <feComposite
              in="SourceGraphic"
              in2="redMask"
              operator="out"
              result="originalTones"
            />

            <feFlood
              floodColor="#971915"
              result="grainRed"
            />

            <feComposite
              in="grainRed"
              in2="redMask"
              operator="in"
              result="redDisc"
            />

            <feComposite
              in="redDisc"
              in2="SourceAlpha"
              operator="in"
              result="clippedDisc"
            />

            <feComposite
              in="originalTones"
              in2="clippedDisc"
              operator="arithmetic"
              k2="1"
              k3="1"
            />
          </filter>
        </defs>
      </svg>

      <img
        src="/images/banner-buyer-art.png"
        alt=""
        style={{
          filter: `url("#${filterId}")`,
        }}
      />
    </div>
  );
}

export default function LandingPage() {
  const { lang, setLang, t, ui } = useLanguage();
  const location = useLocation();

  const {
    records: stocks,
    loading,
    refreshing,
    error,
    refresh,
  } = usePublicStocks({ limit: 8 });

  const [selected, setSelected] = useState(null);

  const say = (english) =>
    lang === "ta" ? tamilText(english) : english;

  const selectedStock = stocks.find(
    (stock) => stock.id === selected,
  );

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
      className="mp-site mp-final-landing mp-wine-theme"
      lang={lang}
    >
      <MilletPageTheme />

      <style>{LANDING_FIX}</style>

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
                {ui("eyebrow")}
              </p>

              <h1 className="mp-stepped-title">
                <span>{say("Grow with care.")}</span>
                <span>{say("Harvest with")}</span>
                <span>{say("confidence.")}</span>
              </h1>

              <div className="mp-actions">
                <Link
                  to="/register?role=farmer"
                  className="mp-button mp-red"
                >
                  {ui("farmerCTA")}
                </Link>

                <Link
                  to="/register?role=buyer"
                  className="mp-button mp-white"
                >
                  {ui("buyerCTA")}
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
                <h2>{say("Available millets")}</h2>

                <p>
                  {say(
                    "Explore current stock and selling prices from Millet Plus.",
                  )}
                </p>
              </div>

              <button
                className="mp-text-button"
                type="button"
                disabled={refreshing}
                onClick={() => refresh()}
              >
                {ui("refresh")} ↻
              </button>
            </div>

            {loading ? (
              <div className="mp-state" role="status">
                {say("Loading stock…")}
              </div>
            ) : error ? (
              <div className="mp-state" role="alert">
                <p>
                  {say(
                    "Stock could not be loaded. Please try again.",
                  )}
                </p>

                <button
                  className="mp-button mp-green mp-space"
                  type="button"
                  disabled={refreshing}
                  onClick={() => refresh()}
                >
                  {ui("retry")}
                </button>
              </div>
            ) : !stocks.length ? (
              <div className="mp-state">
                <h3>{say("No stock available yet.")}</h3>
                <p>
                  {say(
                    "Available millets will appear here when stock is ready.",
                  )}
                </p>
              </div>
            ) : (
              <div className="mp-four-grid">
                {stocks.map((stock) => {
                  const name = String(
                    stock.variety_name || "",
                  )
                    .trim()
                    .toLowerCase();

                  const image =
                    VARIETY_IMAGES[name] ||
                    "millet-stock.png";

                  return (
                    <article
                      className="mp-harvest-card"
                      key={stock.id}
                    >
                      <div className="mp-harvest-photo">
                        <Photo
                          src={
                            stock.image_url ||
                            `/images/${image}`
                          }
                          alt={stock.variety_name}
                        />

                        <span className="mp-status">
                          {say(
                            stock.in_stock
                              ? "In stock"
                              : "Out of Stock",
                          )}
                        </span>
                      </div>

                      {!stock.image_url && (
                        <small className="mp-image-note">
                          {ui("illustration")}
                        </small>
                      )}

                      <h3>{stock.variety_name}</h3>

                      <p>
                        {say("Available")}:{" "}
                        {formatStockValue(
                          stock.available_quantity,
                          lang,
                        )}{" "}
                        kg
                      </p>

                      <strong>
                        LKR{" "}
                        {formatStockValue(
                          stock.selling_price_per_kg,
                          lang,
                        )}{" "}
                        / kg
                      </strong>

                      <button
                        className="mp-button mp-green"
                        type="button"
                        onClick={() =>
                          setSelected(stock.id)
                        }
                      >
                        {ui("details")}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            <p className="mp-caption">
              {say(
                "Stock availability and prices are updated from current inventory.",
              )}
            </p>
          </div>
        </section>

        <section
          className="mp-about-section"
          id="about"
        >
          <div className="mp-container mp-about-content">
            <img
              src="/images/millet-harvest.png"
              alt={say("Millet harvest")}
              loading="lazy"
            />

            <div>
              <h2>{ui("aboutTitle")}</h2>
              <p>{ui("aboutText")}</p>
            </div>
          </div>
        </section>

        <section className="mp-cta">
          <div className="mp-container mp-cta-row">
            <h2>{ui("cta")}</h2>

            <Link
              className="mp-button mp-red"
              to="/register"
            >
              {ui("getStarted")}
            </Link>
          </div>
        </section>
      </main>

      <Footer t={t} />

      {selected !== null && (
        <Dialog
          title={selectedStock?.variety_name || say("Stock")}
          t={t}
          onClose={() => setSelected(null)}
        >
          {selectedStock ? (
            <dl className="mp-detail-list">
              <div>
                <dt>{say("Available")}</dt>
                <dd>
                  {formatStockValue(
                    selectedStock.available_quantity,
                    lang,
                  )}{" "}
                  kg
                </dd>
              </div>

              <div>
                <dt>{say("Price / kg")}</dt>
                <dd>
                  LKR{" "}
                  {formatStockValue(
                    selectedStock.selling_price_per_kg,
                    lang,
                  )}
                </dd>
              </div>

              <div>
                <dt>{say("Status")}</dt>
                <dd>
                  {say(
                    selectedStock.in_stock
                      ? "In stock"
                      : "Out of Stock",
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p>
              {say(
                "Stock details are not available right now. Please refresh.",
              )}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}

const LANDING_FIX = `
.mp-site.mp-final-landing.mp-wine-theme .mp-hero::before {
  display:none!important;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero-grid {
  display:grid!important;
  grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);
  align-items:center;
  gap:12px;
  width:min(1120px,calc(100% - 32px));
  min-height:0;
  margin-inline:auto;
  padding-block:22px 30px;
  position:relative;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero-copy {
  position:relative;
  z-index:2;
  min-width:0;
  width:100%;
  max-width:none;
  padding:0;
  border:0;
  background:transparent;
  box-shadow:none;
}

.mp-site.mp-final-landing.mp-wine-theme
.mp-copy-layer[aria-hidden="true"] {
  display:none!important;
}

.mp-site.mp-final-landing.mp-wine-theme
.mp-copy-layer.is-visible {
  display:block!important;
  visibility:visible!important;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero .mp-eyebrow {
  margin:0 0 8px;
  font-size:12px;
}

.mp-site.mp-final-landing.mp-wine-theme
.mp-hero .mp-hero-copy .mp-stepped-title {
  margin:0;
  max-width:100%;
  color:white;
  font-size:clamp(36px,4.2vw,58px)!important;
  font-weight:800;
  line-height:1.08!important;
  letter-spacing:-1px;
}

.mp-site.mp-final-landing.mp-wine-theme
.mp-stepped-title>span {
  display:block;
}

.mp-site.mp-final-landing.mp-wine-theme
.mp-stepped-title>span:nth-child(2) {
  padding-inline-start:24px;
}

.mp-site.mp-final-landing.mp-wine-theme
.mp-stepped-title>span:nth-child(3) {
  padding-inline-start:48px;
}

.mp-site.mp-final-landing.mp-wine-theme[lang="ta"]
.mp-hero .mp-hero-copy .mp-stepped-title {
  font-size:clamp(25px,3.2vw,42px)!important;
  line-height:1.3!important;
  letter-spacing:0;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero .mp-actions {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  width:min(100%,360px);
  gap:10px;
  margin-top:18px;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero .mp-button {
  min-width:0;
  width:100%;
  min-height:40px;
  padding:9px 12px;
  font-size:13px;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero-art {
  display:block!important;
  position:relative!important;
  inset:auto!important;
  width:100%!important;
  height:clamp(300px,31vw,420px);
  min-width:0;
  margin:0!important;
  z-index:1;
  pointer-events:none;
  overflow:visible;
  align-self:center;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero-art::after {
  display:none!important;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero-filter {
  position:absolute;
  pointer-events:none;
}

.mp-site.mp-final-landing.mp-wine-theme .mp-hero-art img {
  display:block;
  width:100%;
  height:100%;
  max-height:none;
  object-fit:contain;
  object-position:left center;
  border:0;
  border-radius:0;
  box-shadow:none;
  background:transparent;
  transform-origin:center bottom;
  animation:landingMilletSway 8s ease-in-out infinite;
}

@keyframes landingMilletSway {
  0%,100% {transform:rotate(-1deg);}
  50% {transform:rotate(1deg);}
}

@media(max-width:760px) {
  .mp-site.mp-final-landing.mp-wine-theme .mp-hero-grid {
    grid-template-columns:minmax(0,1fr);
    gap:12px;
    padding-block:22px 26px;
  }

  .mp-site.mp-final-landing.mp-wine-theme .mp-hero-art {
    height:250px;
  }

  .mp-site.mp-final-landing.mp-wine-theme .mp-hero-art img {
    object-position:center;
  }
}

@media(max-width:600px) {
  .mp-site.mp-final-landing.mp-wine-theme
  .mp-hero .mp-hero-copy .mp-stepped-title {
    font-size:32px!important;
  }

  .mp-site.mp-final-landing.mp-wine-theme[lang="ta"]
  .mp-hero .mp-hero-copy .mp-stepped-title {
    font-size:25px!important;
  }

  .mp-site.mp-final-landing.mp-wine-theme
  .mp-stepped-title>span:nth-child(2) {
    padding-inline-start:12px;
  }

  .mp-site.mp-final-landing.mp-wine-theme
  .mp-stepped-title>span:nth-child(3) {
    padding-inline-start:24px;
  }
}

@media(prefers-reduced-motion:reduce) {
  .mp-site.mp-final-landing.mp-wine-theme .mp-hero-art img {
    animation:none;
  }
}
`;

const PAGE_THEME = `
.mp-wine-theme {
  --millet-green:#005536;
  --millet-green-deep:#00402c;
  --millet-grain-red:#932c2f;
  --millet-grain-red-deep:#7c2427;
  --millet-gold:#c8ad56;
  --millet-cream:#fdfcf7;
  --millet-silver:#c5cbd0;
  --green:var(--millet-green);
  --dark:var(--millet-green-deep);
}

.mp-wine-theme :is(
  .mp-hero,.mp-auth-hero,.mp-cta,.mp-auth-bottom-cta
) {
  color:#fff;
  background-color:var(--millet-green);
}

.mp-wine-theme .unique-banner {
  background-color:var(--millet-green);
}

.mp-wine-theme .unique-banner::before {
  background:linear-gradient(
    90deg,#00402ce8 0%,#005536a6 45%,transparent 100%
  );
}

.mp-wine-theme :is(
  .unique-banner-quote,
  .unique-banner-admin-quote,
  .unique-banner-buyer-quote
) {
  color:#fff4d9;
  text-shadow:0 1px 4px #002e20;
}

.mp-wine-theme :is(.mp-red,.btn.red,.mp-stock-primary) {
  --millet-button:var(--millet-grain-red);
  --millet-button-hover:var(--millet-grain-red-deep);
}

.mp-wine-theme :is(.mp-green,.btn.green) {
  --millet-button:var(--millet-green);
  --millet-button-hover:var(--millet-green-deep);
}

.mp-wine-theme :is(
  .mp-red,.mp-green,.btn.red,.btn.green,.mp-stock-primary
) {
  border-color:var(--millet-button)!important;
  background:var(--millet-button)!important;
  color:#fff;
}

.mp-wine-theme :is(
  .mp-red,.mp-green,.btn.red,.btn.green,.mp-stock-primary
):hover:not(:disabled) {
  border-color:var(--millet-button-hover)!important;
  background:var(--millet-button-hover)!important;
}

.mp-wine-theme :is(.mp-header,.site-header) {
  border-bottom-color:#dde6dc;
  background:var(--millet-cream);
}

.mp-wine-theme .mp-nav>a:not(.mp-button):is(
  .active,[aria-current="page"]
) {
  color:var(--millet-green);
  border-color:var(--millet-green);
}

.mp-wine-theme .dashboard-nav>.nav-tab:is(
  .active,[aria-current="page"]
) {
  background:var(--millet-green);
  color:#fff;
}

.mp-wine-theme .mp-footer {
  border-top-color:var(--millet-gold);
  background:var(--millet-green-deep);
  color:#fff;
}

.mp-wine-theme .mp-footer :is(h2,strong) {
  color:var(--millet-gold);
}

.mp-wine-theme .mp-footer :is(p,a) {
  color:#fff4e9;
}

.mp-wine-theme :is(.mp-photo,.silver-photo,.mp-farmer-photo) {
  border-color:var(--millet-silver);
}

.mp-wine-theme .mp-calendar-grid button:is(
  .selected,[aria-pressed="true"]
) {
  border-color:var(--millet-green);
  background:var(--millet-green);
  color:#fff;
}

.mp-wine-theme .mp-calendar-dot {
  background:var(--millet-green);
}

.mp-wine-theme .mp-calendar-grid
button[aria-pressed="true"] .mp-calendar-dot {
  background:#fff;
}

.mp-wine-theme input[name="send_sms"] {
  accent-color:var(--millet-green);
}

.mp-wine-theme :is(
  .mp-feature,.mp-auth-card,.summary-card,.dashboard-content .panel
) {
  border-color:#dce6dc;
  border-radius:12px;
  box-shadow:0 3px 12px #003e2b0d;
}

.mp-wine-theme :is(
  .mp-auth-column,.dashboard-content,.dashboard-content .panel
) {
  min-width:0;
}

.mp-wine-theme .dashboard-content .table-scroll {
  max-width:100%;
  overflow-x:auto;
}

@media(min-width:761px) and (max-width:1150px) {
  .mp-wine-theme:is(.dash-farmer,.dash-buyer) .header-row {
    flex-wrap:wrap;
    padding-block:8px;
  }

  .mp-wine-theme:is(.dash-farmer,.dash-buyer) .dashboard-nav {
    order:1;
    flex:0 0 100%;
    flex-wrap:wrap;
  }
}

@media(max-width:760px) {
  .mp-wine-theme .dashboard-nav.open {
    max-height:65vh;
    overflow-y:auto;
  }

  .mp-wine-theme .unique-banner h1 {
    font-size:clamp(25px,5.5vw,36px);
    overflow-wrap:anywhere;
  }
}

@media(max-width:480px) {
  .mp-wine-theme .summary-grid {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
`;

export function MilletPageTheme() {
  return <style>{PAGE_THEME}</style>;
}