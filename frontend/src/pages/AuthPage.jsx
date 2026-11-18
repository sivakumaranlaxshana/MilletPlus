import "./auth.css";

import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  apiRequest,
  dashboardPath,
} from "../api";

import { tamilText } from "../translations";

import {
  Dialog,
  Features,
  Footer,
  Header,
  Icon,
  Lessons,
  MilletPageTheme,
  useLanguage,
} from "./LandingPage";

/* --------------------------------------------------
   Error messages
-------------------------------------------------- */

function getErrorMessage(error) {
  if (Array.isArray(error?.detail)) {
    return error.detail
      .map((item) => {
        const field = item.loc?.slice(1).join(".");

        return field
          ? `${field}: ${item.msg}`
          : item.msg;
      })
      .join(" ");
  }

  if (typeof error?.detail === "string") {
    return error.detail;
  }

  return (
    error?.message ||
    "Request failed. Please try again."
  );
}

/* --------------------------------------------------
   Google sign-in button
-------------------------------------------------- */

function GoogleButton({
  lang,
  disabled,
  onCredential,
}) {
  const containerRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const disabledRef = useRef(disabled);

  const [failed, setFailed] = useState(false);

  callbackRef.current = onCredential;
  disabledRef.current = disabled;

  const clientId =
    import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;

    let active = true;
    setFailed(false);

    function renderButton() {
      if (
        !active ||
        !containerRef.current ||
        !window.google?.accounts?.id
      ) {
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,

        callback: (response) => {
          if (
            active &&
            !disabledRef.current &&
            response.credential
          ) {
            callbackRef.current(response.credential);
          }
        },
      });

      containerRef.current.replaceChildren();

      window.google.accounts.id.renderButton(
        containerRef.current,
        {
          theme: "outline",
          size: "large",
          text: "continue_with",
          width: 280,
          locale: lang,
        },
      );
    }

    function handleError() {
      if (active) {
        setFailed(true);
      }
    }

    let script = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    if (window.google?.accounts?.id) {
      renderButton();
    } else if (!script) {
      script = document.createElement("script");
      script.src =
        "https://accounts.google.com/gsi/client";
      script.async = true;

      script.addEventListener("load", renderButton);
      script.addEventListener("error", handleError);

      document.head.appendChild(script);
    } else {
      script.addEventListener("load", renderButton);
      script.addEventListener("error", handleError);
    }

    return () => {
      active = false;

      script?.removeEventListener(
        "load",
        renderButton,
      );

      script?.removeEventListener(
        "error",
        handleError,
      );
    };
  }, [clientId, lang]);

  if (!clientId) return null;

  if (failed) {
    const message =
      "Google sign-in could not load. Please use email and password.";

    return (
      <p
        className="mp-alert mp-error"
        role="alert"
      >
        {lang === "ta"
          ? tamilText(message)
          : message}
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mp-google"
      aria-disabled={disabled}
      style={{
        pointerEvents: disabled ? "none" : "auto",
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}

/* --------------------------------------------------
   Password field
-------------------------------------------------- */

function PasswordField({
  label,
  name,
  placeholder,
  show,
  onToggle,
  toggleLabel,
  register = false,
}) {
  return (
    <label>
      {label}

      <div className="mp-password">
        <input
          name={name}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={
            register
              ? "new-password"
              : "current-password"
          }
          minLength={register ? 8 : 1}
          maxLength={128}
          required
        />

        <button
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-pressed={show}
        >
          <Icon
            name={show ? "eyeOff" : "eye"}
            size={17}
          />
        </button>
      </div>
    </label>
  );
}

/* --------------------------------------------------
   Password reset
-------------------------------------------------- */

function ForgotPassword({
  t,
  ui,
  onClose,
}) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;

    const timer = window.setTimeout(() => {
      setSeconds((value) => value - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function sendCode() {
    if (busy || seconds > 0) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await apiRequest("/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
        }),
      });

      setStep(2);
      setSeconds(60);
      setMessage("resetSent");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();

    if (busy) return;

    if (step === 1) {
      await sendCode();
      return;
    }

    const values = Object.fromEntries(
      new FormData(event.currentTarget),
    );

    if (
      values.new_password !==
      values.confirm_password
    ) {
      setError(t.mismatch);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: values.otp,
          new_password: values.new_password,
          confirm_password: values.confirm_password,
        }),
      });

      setStep(3);
      setMessage("resetDone");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={ui("resetTitle")}
      t={t}
      busy={busy}
      onClose={onClose}
    >
      <p>{ui("resetText")}</p>

      {error && (
        <p
          className="mp-alert mp-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {message && (
        <p
          className="mp-alert mp-success"
          role="status"
        >
          {ui(message)}
        </p>
      )}

      {step === 3 ? (
        <button
          type="button"
          className="mp-button mp-green mp-full"
          onClick={onClose}
        >
          {ui("login")}
        </button>
      ) : (
        <form
          className="mp-form"
          onSubmit={submit}
        >
          <fieldset disabled={busy}>
            {step === 1 ? (
              <label>
                {ui("email")}

                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                />
              </label>
            ) : (
              <>
                <p>{email}</p>

                <label>
                  {ui("code")}

                  <input
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    minLength={6}
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                  />
                </label>

                <label>
                  {ui("newPassword")}

                  <input
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>

                <label>
                  {ui("confirm")}

                  <input
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
              </>
            )}

            <button
              type="submit"
              className="mp-button mp-red mp-full"
            >
              {ui(
                busy
                  ? "waiting"
                  : step === 1
                    ? "send"
                    : "reset",
              )}
            </button>
          </fieldset>
        </form>
      )}

      {step === 2 && (
        <button
          type="button"
          className="mp-text-button mp-space"
          disabled={busy || seconds > 0}
          onClick={sendCode}
        >
          {seconds > 0 ? (
            <>
              {ui("resendWait")} {seconds}s
            </>
          ) : (
            ui("resend")
          )}
        </button>
      )}
    </Dialog>
  );
}

/* --------------------------------------------------
   Login and Register page
-------------------------------------------------- */

export default function AuthPage() {
  const {
    lang,
    setLang,
    t,
    ui,
  } = useLanguage();

  const location = useLocation();
  const navigate = useNavigate();

  const register =
    location.pathname === "/register";

  const requestedRole = new URLSearchParams(
    location.search,
  ).get("role");

  const googleClientId =
    import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const [role, setRole] = useState(
    requestedRole === "buyer"
      ? "buyer"
      : "farmer",
  );

  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState(null);

  const [linkCredential, setLinkCredential] =
    useState(null);

  const text = (value) =>
    lang === "ta"
      ? tamilText(value)
      : value;

  useEffect(() => {
    setError("");
    setShow(false);
    setForgot(false);
    setCredential(null);

    setRole(
      requestedRole === "buyer"
        ? "buyer"
        : "farmer",
    );

    const pending =
      location.state?.googleLinkCredential ||
      null;

    setLinkCredential(pending);

    setMessage(
      pending
        ? "googleLink"
        : location.state?.registered
          ? "created"
          : "",
    );

    if (location.state) {
      navigate(
        location.pathname + location.search,
        {
          replace: true,
          state: null,
        },
      );
    }
  }, [location.pathname, requestedRole]);

  function finishLogin(data) {
    sessionStorage.setItem(
      "millet_access_token",
      data.access_token,
    );

    navigate(
      dashboardPath(data.user.role),
      {
        replace: true,
      },
    );
  }

  async function submit(event) {
    event.preventDefault();

    if (busy) return;

    const values = Object.fromEntries(
      new FormData(event.currentTarget),
    );

    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (credential) {
        const data = await apiRequest(
          "/auth/google/register",
          {
            method: "POST",
            auth: false,
            body: JSON.stringify({
              credential,
              phone: values.phone.trim(),
              role,
            }),
          },
        );

        finishLogin(data);
        return;
      }

      if (register) {
        if (
          values.password !==
          values.confirm_password
        ) {
          throw new Error(t.mismatch);
        }

        await apiRequest("/auth/register", {
          method: "POST",
          auth: false,
          body: JSON.stringify({
            name: values.name.trim(),
            email: values.email
              .trim()
              .toLowerCase(),
            phone: values.phone.trim(),
            password: values.password,
            role,
          }),
        });

        navigate("/login", {
          replace: true,
          state: {
            registered: true,
          },
        });

        return;
      }

      const data = await apiRequest(
        "/auth/login",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({
            email: values.email
              .trim()
              .toLowerCase(),
            password: values.password,
          }),
        },
      );

      if (linkCredential) {
        sessionStorage.setItem(
          "millet_access_token",
          data.access_token,
        );

        try {
          await apiRequest(
            "/auth/google/link",
            {
              method: "POST",
              body: JSON.stringify({
                credential: linkCredential,
              }),
            },
          );
        } catch (err) {
          sessionStorage.removeItem(
            "millet_access_token",
          );

          throw err;
        }
      }

      finishLogin(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin(value) {
    if (busy) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await apiRequest(
        "/auth/google",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({
            credential: value,
          }),
        },
      );

      finishLogin(data);
    } catch (err) {
      if (
        err.code ===
        "GOOGLE_REGISTRATION_REQUIRED"
      ) {
        setCredential(value);
        setMessage("googleDetails");
      } else if (
        err.code ===
        "GOOGLE_LINK_REQUIRED"
      ) {
        if (register) {
          navigate("/login", {
            state: {
              googleLinkCredential: value,
            },
          });
        } else {
          setLinkCredential(value);
          setMessage("googleLink");
        }
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const collectDetails =
    register || Boolean(credential);

  const benefits = [
    ["leaf", "Crop Guidance"],
    ["people", "Farm Records"],
    ["cart", "Quality Millet"],
  ];

  return (
    <div
      id="mp-auth-page"
      className={`mp-site mp-wine-theme mp-clean-design ${
        register
          ? "mp-register-page"
          : "mp-login-page"
      }`}
      lang={lang}
    >
      <MilletPageTheme />

      <style>{AUTH_REFERENCE_STYLES}</style>

      <Header
        lang={lang}
        setLang={setLang}
        t={t}
      />

      <main>
        <section className="mp-auth-hero">
          <div className="mp-straight-decoration" aria-hidden="true">
            <span className="mp-straight-red-panel" />
            <img
              src={register ? "/images/millet-register.png" : "/images/millet-login.png"}
              alt=""
              onError={(event) => {
                if (!event.currentTarget.dataset.fallback) {
                  event.currentTarget.dataset.fallback = "1";
                  event.currentTarget.src = "/images/millet-register.png";
                }
              }}
            />
          </div>
          <div className="mp-auth-grid">
            {/* Left portrait and heading */}

            <div className="mp-auth-story">
              <div className="mp-auth-portrait-frame">
                <img
                  className="mp-auth-portrait-image"
                  src={
                    register
                      ? "/images/farmer-register.png"
                      : "/images/farmer.png"
                  }
                  alt={text(
                    "Farmer holding millet",
                  )}
                  onError={(event) => {
                    const image =
                      event.currentTarget;

                    if (!image.dataset.fallback) {
                      image.dataset.fallback = "1";
                      image.src =
                        "/images/millet-harvest.png";
                    }
                  }}
                />
              </div>

              <h1>
                {text(
                  "Grow better, together.",
                )}
              </h1>

              <p className="mp-story-text">
                {text(
                  "Your millet journey starts here.",
                )}
              </p>

              {!register && (
                <div className="mp-story-features">
                  {benefits.map(
                    ([icon, title]) => (
                      <article key={icon}>
                        <span>
                          <Icon
                            name={icon}
                            size={26}
                          />
                        </span>

                        <h2>{text(title)}</h2>
                      </article>
                    ),
                  )}
                </div>
              )}
            </div>

            {/* Right form */}

            <div className="mp-auth-column">
              {register && (
                <div className="mp-register-title">
                  <p className="mp-eyebrow">
                    {text(
                      "GOOD GRAINS. BETTER TOMORROWS.",
                    )}
                  </p>

                  <h1>
                    {text(
                      "Create your account",
                    )}
                  </h1>

                  <p>
                    {text(
                      "Join our millet-growing community.",
                    )}
                  </p>
                </div>
              )}

              <section className="mp-auth-card">
                {!register && (
                  <>
                    <nav
                      className="mp-auth-tabs"
                      aria-label={text("Account")}
                    >
                      <Link
                        to="/login"
                        className="active"
                        aria-current="page"
                      >
                        {text("Sign in")}
                      </Link>

                      <Link to="/register">
                        {text("Create account")}
                      </Link>
                    </nav>

                    <div className="mp-form-heading">
                      <h2>
                        {credential
                          ? ui("complete")
                          : text("Welcome back")}
                      </h2>

                      <p>
                        {text(
                          "Sign in to your Millet Plus account.",
                        )}
                      </p>
                    </div>
                  </>
                )}

                {error && (
                  <p
                    className="mp-alert mp-error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                {message && (
                  <p
                    className="mp-alert mp-success"
                    role="status"
                  >
                    {ui(message)}
                  </p>
                )}

                <form
                  className="mp-form"
                  key={`${register}-${Boolean(
                    credential,
                  )}`}
                  onSubmit={submit}
                  aria-busy={busy}
                >
                  <fieldset disabled={busy}>
                    {collectDetails && (
                      <div
                        className="mp-role-options"
                        role="group"
                        aria-label={text(
                          "Account type",
                        )}
                      >
                        {[
                          "farmer",
                          "buyer",
                        ].map((value) => (
                          <label
                            key={value}
                            className={`mp-role-card ${
                              role === value
                                ? "selected"
                                : ""
                            }`}
                          >
                            <input
                              type="radio"
                              name="role"
                              value={value}
                              checked={
                                role === value
                              }
                              onChange={() =>
                                setRole(value)
                              }
                            />

                            <Icon
                              name={
                                value === "farmer"
                                  ? "leaf"
                                  : "cart"
                              }
                              size={28}
                            />

                            <div className="mp-auth-role-copy">
                              <strong>
                                {ui(value)}
                              </strong>

                              <small>
                                {ui(
                                  `${value}Text`,
                                )}
                              </small>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}

                    {collectDetails &&
                      !credential && (
                        <label>
                          {ui("name")}

                          <input
                            name="name"
                            placeholder={text(
                              "Enter your full name",
                            )}
                            autoComplete="name"
                            minLength={2}
                            maxLength={100}
                            required
                          />
                        </label>
                      )}

                    {!credential && (
                      <label>
                        {ui("email")}

                        <input
                          name="email"
                          type="email"
                          placeholder="you@example.com"
                          autoComplete="email"
                          maxLength={254}
                          required
                        />
                      </label>
                    )}

                    {collectDetails && (
                      <label>
                        {ui("phone")}

                        <input
                          name="phone"
                          type="tel"
                          placeholder="0771234567"
                          autoComplete="tel"
                          maxLength={30}
                          required
                        />
                      </label>
                    )}

                    {!credential && (
                      <div
                        className={
                          register
                            ? "mp-password-pair"
                            : ""
                        }
                      >
                        <PasswordField
                          label={ui("password")}
                          name="password"
                          placeholder={text(
                            "Enter your password",
                          )}
                          show={show}
                          register={register}
                          toggleLabel={
                            show
                              ? t.hide
                              : t.show
                          }
                          onToggle={() =>
                            setShow(
                              (value) => !value,
                            )
                          }
                        />

                        {register && (
                          <PasswordField
                            label={ui("confirm")}
                            name="confirm_password"
                            placeholder={text(
                              "Confirm password",
                            )}
                            show={show}
                            register
                            toggleLabel={
                              show
                                ? t.hide
                                : t.show
                            }
                            onToggle={() =>
                              setShow(
                                (value) => !value,
                              )
                            }
                          />
                        )}
                      </div>
                    )}

                    {!register &&
                      !credential && (
                        <button
                          type="button"
                          className="mp-text-button mp-forgot"
                          onClick={() =>
                            setForgot(true)
                          }
                        >
                          {ui("forgot")}
                        </button>
                      )}

                    <button
                      type="submit"
                      className="mp-button mp-red mp-full"
                    >
                      {busy
                        ? ui("waiting")
                        : credential
                          ? ui("complete")
                          : text(
                              register
                                ? "Create account"
                                : "Sign in",
                            )}
                    </button>
                  </fieldset>
                </form>

                {!credential &&
                  googleClientId && (
                    <>
                      <div className="mp-or">
                        {text("or")}
                      </div>

                      <GoogleButton
                        lang={lang}
                        disabled={busy}
                        onCredential={
                          googleLogin
                        }
                      />
                    </>
                  )}

                <div className="mp-auth-switch">
                  {ui(
                    register
                      ? "existing"
                      : "newUser",
                  )}{" "}

                  <Link
                    to={
                      register
                        ? "/login"
                        : "/register"
                    }
                  >
                    {text(
                      register
                        ? "Sign in"
                        : "Create account",
                    )}
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </section>

        {register && <Features t={t} />}

        <Lessons
          t={t}
          register={register}
        />

        {register && (
          <section className="mp-auth-bottom-cta">
            <div className="mp-container mp-cta-row">
              <h2>
                {text(
                  "Better crops. Stronger communities.",
                )}
              </h2>

              <Link
                to="/register"
                className="mp-button mp-red"
              >
                {text("Get started")}
              </Link>
            </div>
          </section>
        )}
      </main>

      <Footer t={t} />

      {forgot && (
        <ForgotPassword
          t={t}
          ui={ui}
          onClose={() =>
            setForgot(false)
          }
        />
      )}
    </div>
  );
}

/* --------------------------------------------------
   Reference styling
-------------------------------------------------- */

const AUTH_REFERENCE_STYLES = `
#mp-auth-page#mp-auth-page#mp-auth-page {
  background: #fff !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-hero {
  position: relative !important;
  overflow: hidden;
  padding: 32px 0 38px !important;
  background: var(--waves), #005536 !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-hero::before {
  display: none !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-hero::after {
  content: "";
  display: block !important;
  position: absolute;
  z-index: 0;
  inset: 10px 0 0 auto;
  width: 165px;
  height: calc(100% - 10px);
  background: url(/images/millet-login.png) right bottom/contain no-repeat;
  pointer-events: none;
  opacity: 1;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-grid {
  position: relative;
  z-index: 1;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
  align-items: center !important;
  gap: 36px !important;
  width: min(900px, calc(100% - 48px)) !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 auto !important;
  padding: 0 !important;
}
#mp-auth-page .mp-auth-portrait-frame {
  position: relative;
  width: min(100%, 335px);
  aspect-ratio: 1;
  margin: 0 auto 18px;
  padding: 0;
  border: 4px solid #b4bdc5;
  border-radius: 50%;
  background: #005536;
  overflow: hidden;
  box-shadow: 0 0 0 2px #edf1f4, 0 4px 9px #001c1638;
}
#mp-auth-page .mp-auth-portrait-frame .mp-auth-portrait-image {
  display: block !important;
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
  object-fit: cover !important;
  object-position: center !important;
  transform: scale(1.16) !important;
  animation: none !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-story {
  padding: 0 !important;
  text-align: center !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-story h1 {
  max-width: 390px;
  margin: 12px auto 8px !important;
  color: #fff !important;
  font-size: clamp(34px, 3.8vw, 46px) !important;
  font-weight: 850 !important;
  line-height: 1.03 !important;
  letter-spacing: -1px !important;
  text-align: center !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-story-text {
  margin: 0 !important;
  color: #fff !important;
  font-size: 17px !important;
  line-height: 1.4 !important;
}
#mp-auth-page .mp-story-features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 24px;
}
#mp-auth-page .mp-story-features article > span {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin: 0 auto 9px;
  border-radius: 50%;
  background: #e7f3e8;
  color: #005536;
}
#mp-auth-page .mp-story-features h2 {
  margin: 0;
  color: #fff;
  font-size: 14px;
  line-height: 1.3;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-column {
  width: 100% !important;
  max-width: 400px !important;
  margin: 0 auto !important;
  padding: 0 !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-card {
  width: 100% !important;
  margin: 0 !important;
  padding: 24px !important;
  border: 1px solid #dce4dd !important;
  border-radius: 9px !important;
  background: #fffefa !important;
  color: #102a29;
  box-shadow: 0 5px 15px #001b1625 !important;
}
#mp-auth-page .mp-auth-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 22px;
  gap: 8px;
}
#mp-auth-page .mp-auth-tabs a {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 9px 6px;
  border-bottom: 3px solid transparent;
  background: none;
  color: #173b68;
  font-size: 13px;
  text-decoration: none;
}
#mp-auth-page .mp-auth-tabs a.active {
  border-bottom-color: #005536;
  color: #005536;
  font-weight: 750;
}
#mp-auth-page .mp-form-heading {
  margin-bottom: 22px;
}
#mp-auth-page .mp-form-heading h2 {
  margin: 0 0 6px;
  color: #063c32;
  font-size: 29px;
  line-height: 1.15;
}
#mp-auth-page .mp-form-heading p {
  margin: 0;
  color: #173b68;
  font-size: 13px;
}
#mp-auth-page .mp-form fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
#mp-auth-page .mp-form label:not(.mp-role-card) {
  display: block;
  margin-bottom: 13px;
  color: #132337;
  font-size: 12px;
  font-weight: 700;
}
#mp-auth-page .mp-form input:not([type=radio]):not([type=checkbox]) {
  display: block;
  width: 100%;
  height: 39px;
  min-height: 39px;
  margin-top: 5px;
  padding: 8px 11px;
  border: 1px solid #ccd5de;
  border-radius: 5px;
  background: #fff;
  color: #132337;
  font:
    400 13px/1.3 "Segoe UI",
    Arial,
    sans-serif;
}
#mp-auth-page .mp-password {
  position: relative;
}
#mp-auth-page .mp-password input {
  padding-right: 40px !important;
}
#mp-auth-page .mp-password button {
  display: grid;
  place-items: center;
  position: absolute;
  top: 50%;
  right: 6px;
  width: 30px;
  height: 30px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: #173b56;
  transform: translateY(-50%);
}
#mp-auth-page .mp-password-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
#mp-auth-page .mp-forgot {
  display: block;
  margin: 0 0 18px auto;
  font-size: 12px;
}
#mp-auth-page .mp-auth-card .mp-button.mp-red {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100%;
  height: 40px;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid #9b343b;
  border-radius: 5px;
  background: #932c2f !important;
  color: #fff;
  font-size: 14px;
  line-height: 1.2;
}
#mp-auth-page .mp-or {
  display: flex;
  align-items: center;
  margin: 18px 0;
  gap: 14px;
  color: #254669;
  font-size: 13px;
}
#mp-auth-page .mp-or::before,
#mp-auth-page .mp-or::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #b4bec8;
}
#mp-auth-page .mp-google {
  display: flex;
  justify-content: center;
}
#mp-auth-page .mp-auth-switch {
  margin-top: 18px;
  color: #173b68;
  font-size: 12px;
  text-align: center;
}
#mp-auth-page .mp-auth-switch a {
  color: #005536;
  font-weight: 750;
  text-decoration: underline;
}
#mp-auth-page .mp-alert {
  margin: 0 0 18px;
  padding: 12px;
  border: 1px solid;
  border-radius: 8px;
  font-size: 14px;
}
#mp-auth-page .mp-error {
  color: #8b2231;
  background: #fff0f1;
  border-color: #e3b3ba;
}
#mp-auth-page .mp-success {
  color: #175a36;
  background: #e9f5ed;
  border-color: #acd0b7;
}
#mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-auth-hero {
  background: var(--waves), linear-gradient(#005536 0 365px, #fff 365px) !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-auth-grid {
  align-items: start !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-auth-hero::after {
  height: 350px;
  background-image: url(/images/millet-register.png);
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-register-title {
  position: static !important;
  inset: auto !important;
  transform: none !important;
  width: 100%;
  margin: 0 0 20px !important;
  padding: 0 8px !important;
  border: 0 !important;
  background: none !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-register-title h1 {
  margin: 0 0 8px !important;
  color: #fff !important;
  font-size: 39px !important;
  line-height: 1.04 !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-register-title .mp-eyebrow {
  margin: 0 0 8px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-register-title > p:last-child {
  margin: 0;
  color: #fff;
  font-size: 14px;
}
#mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-auth-story h1 {
  margin-top: 55px !important;
  color: #102137 !important;
  font-size: 36px !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-story-text {
  color: #23394b !important;
}
#mp-auth-page .mp-role-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 18px;
  gap: 12px;
}
#mp-auth-page .mp-role-card {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 65px;
  padding: 10px;
  gap: 10px;
  border: 1px solid #c3ccd2;
  border-radius: 8px;
  background: #fafbfc;
  color: #005536;
  cursor: pointer;
}
#mp-auth-page .mp-role-card.selected {
  background: #e8f4ed;
  border-color: #76ab91;
}
#mp-auth-page .mp-role-card input[type=radio] {
  position: absolute;
  top: 8px;
  right: 8px;
  accent-color: #005536;
}
#mp-auth-page .mp-role-card strong {
  padding-right: 12px;
  font-size: 14px;
}
#mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-features {
  margin-top: 0 !important;
  padding-top: 20px !important;
}
#mp-auth-page[lang=ta] .mp-auth-story h1 {
  font-size: 34px !important;
  line-height: 1.35 !important;
  letter-spacing: 0 !important;
}
#mp-auth-page[lang=ta] .mp-register-title h1 {
  font-size: 29px !important;
  line-height: 1.35 !important;
}
@media (max-width: 760px) {
  #mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-grid {
    grid-template-columns: minmax(0, 1fr) !important;
    width: calc(100% - 32px) !important;
    gap: 28px !important;
  }
  #mp-auth-page .mp-auth-portrait-frame {
    width: 235px;
  }
  #mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-hero::after {
    opacity: .2;
  }
  #mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-auth-hero {
    background: var(--waves), #005536 !important;
  }
  #mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-auth-story h1 {
    margin-top: 15px !important;
    color: #fff !important;
  }
  #mp-auth-page#mp-auth-page#mp-auth-page.mp-register-page .mp-story-text {
    color: #fff !important;
  }
}
@media (max-width: 380px) {
  #mp-auth-page .mp-password-pair {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}

/* Straight upper-right millet decoration, without a circular image frame. */
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-hero::before,
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-hero::after {
  display: none !important;
}
#mp-auth-page .mp-straight-decoration {
  position: absolute;
  z-index: 0;
  top: 0;
  right: 0;
  bottom: 0;
  width: clamp(150px, 20vw, 290px);
  overflow: hidden;
  pointer-events: none;
}
#mp-auth-page .mp-straight-red-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  height: 92%;
  background: #b52235;
  clip-path: polygon(100% 0, 100% 100%, 8% 72%, 0 33%, 58% 7%);
}
#mp-auth-page .mp-straight-decoration img {
  display: block !important;
  position: absolute !important;
  top: 0 !important;
  right: -12px !important;
  bottom: auto !important;
  left: auto !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  object-fit: contain !important;
  object-position: right top !important;
  transform: none !important;
  animation: none !important;
}
#mp-auth-page#mp-auth-page#mp-auth-page .mp-auth-grid {
  position: relative;
  z-index: 2;
}
#mp-auth-page.mp-register-page .mp-straight-decoration {
  bottom: auto;
  height: 350px;
}
@media (max-width: 760px) {
  #mp-auth-page .mp-straight-decoration {
    width: 135px;
    height: 310px;
    bottom: auto;
    opacity: .35;
  }
}
`;
