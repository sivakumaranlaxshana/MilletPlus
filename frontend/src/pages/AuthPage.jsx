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

function getErrorMessage(error) {
  if (Array.isArray(error.detail)) {
    return error.detail
      .map((item) => {
        const field = item.loc?.slice(1).join(".");

        return field
          ? `${field}: ${item.msg}`
          : item.msg;
      })
      .join(" ");
  }

  return (
    error.message ||
    "Request failed. Please try again."
  );
}

function GoogleButton({
  lang,
  disabled,
  onCredential,
}) {
  const containerRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const disabledRef = useRef(disabled);

  callbackRef.current = onCredential;
  disabledRef.current = disabled;

  const clientId =
    import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;

    let active = true;

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
          if (!disabledRef.current) {
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

    let script = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    if (window.google?.accounts?.id) {
      renderButton();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://accounts.google.com/gsi/client";
        script.async = true;
        document.head.appendChild(script);
      }

      script.addEventListener("load", renderButton);
    }

    return () => {
      active = false;

      script?.removeEventListener(
        "load",
        renderButton,
      );
    };
  }, [clientId, lang]);

  if (!clientId) return null;

  return (
    <div
      ref={containerRef}
      className={`mp-google ${
        disabled ? "mp-disabled" : ""
      }`}
      aria-disabled={disabled}
    />
  );
}

function PasswordField({
  label,
  name,
  placeholder,
  show,
  onToggle,
  toggleLabel,
  register,
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

function ForgotPassword({ t, ui, onClose }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;

    const timer = setTimeout(() => {
      setSeconds((value) => value - 1);
    }, 1000);

    return () => clearTimeout(timer);
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
      <p className="mp-form-description">
        {ui("resetText")}
      </p>

      {error && (
        <p className="mp-alert mp-error" role="alert">
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
                <p className="mp-reset-email">
                  {email}
                </p>

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

export default function AuthPage() {
  const { lang, setLang, t, ui } = useLanguage();
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
    requestedRole === "buyer" ? "buyer" : "farmer",
  );

  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState(null);

  const [linkCredential, setLinkCredential] =
    useState(null);

  const text = (english) =>
    lang === "ta" ? tamilText(english) : english;

  useEffect(() => {
    setError("");
    setShow(false);
    setForgot(false);
    setCredential(null);

    setRole(
      requestedRole === "buyer" ? "buyer" : "farmer",
    );

    const pending =
      location.state?.googleLinkCredential || null;

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

    navigate(dashboardPath(data.user.role), {
      replace: true,
    });
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
            email: values.email.trim().toLowerCase(),
            phone: values.phone.trim(),
            password: values.password,
            role,
          }),
        });

        navigate("/login", {
          replace: true,
          state: { registered: true },
        });

        return;
      }

      const data = await apiRequest(
        "/auth/login",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({
            email: values.email.trim().toLowerCase(),
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
          await apiRequest("/auth/google/link", {
            method: "POST",
            body: JSON.stringify({
              credential: linkCredential,
            }),
          });
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
        err.code === "GOOGLE_REGISTRATION_REQUIRED"
      ) {
        setCredential(value);
        setMessage("googleDetails");
      } else if (
        err.code === "GOOGLE_LINK_REQUIRED"
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

  return (
    <div
      className={`mp-site mp-reference-auth mp-wine-theme mp-auth-reference mp-auth-exact ${
        register
          ? "mp-reference-register"
          : "mp-reference-login"
      }`}
      lang={lang}
    >
      <MilletPageTheme />

      <style>{AUTH_TEXT_FIX}</style>

      <Header
        lang={lang}
        setLang={setLang}
        t={t}
      />

      <main>
        <section className="mp-auth-hero">
          <div className="mp-auth-grid">
            <div className="mp-auth-story">
              <img
                key={
                  register
                    ? "register-photo"
                    : "login-photo"
                }
                className="mp-farmer-photo"
                src={
                  register
                    ? "/images/farmer-register.png"
                    : "/images/farmer.png"
                }
                alt={text("Farmer holding millet")}
                onError={(event) => {
                  const image = event.currentTarget;

                  if (!image.dataset.fallback) {
                    image.dataset.fallback = "1";
                    image.src = "/images/farmer.png";
                  }
                }}
              />

              {!register && (
                <>
                  <h1>{ui("storyLines")}</h1>

                  <p className="mp-story-text">
                    {ui("storyText")}
                  </p>

                  <div className="mp-story-features">
                    {t.storyFeatures.map(
                      (_, index) => (
                        <article key={index}>
                          <span aria-hidden="true">
                            <Icon
                              name={
                                [
                                  "leaf",
                                  "people",
                                  "bars",
                                ][index] || "leaf"
                              }
                              size={28}
                            />
                          </span>

                          <h2>
                            {ui(
                              `storyFeatures.${index}.1`,
                            )}
                          </h2>

                          <p>
                            {text(
                              [
                                "Keep your crop records together.",
                                "Connect through shared harvests.",
                                "Follow your farm’s progress.",
                              ][index] ||
                                "Keep your crop records together.",
                            )}
                          </p>
                        </article>
                      ),
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="mp-auth-column">
              <section className="mp-auth-card">
                {register && (
                  <div className="mp-register-title">
                    <p className="mp-eyebrow">
                      {text(
                        "GOOD GRAINS. BETTER TOMORROWS.",
                      )}
                    </p>

                    <h1>
                      {text("Create your account")}
                    </h1>

                    <p>
                      {text(
                        "Join our millet-growing community.",
                      )}
                    </p>
                  </div>
                )}

                {!register && (
                  <>
                    <nav
                      className="mp-auth-tabs"
                      aria-label="Account"
                    >
                      <Link
                        className="active"
                        to="/login"
                        aria-current="page"
                      >
                        {ui("login")}
                      </Link>

                      <Link to="/register">
                        {ui("register")}
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
                >
                  <fieldset disabled={busy}>
                    {collectDetails && (
                      <div
                        className="mp-role-options"
                        role="group"
                        aria-label={text("Account type")}
                      >
                        {["farmer", "buyer"].map(
                          (value) => (
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
                                checked={role === value}
                                onChange={() =>
                                  setRole(value)
                                }
                              />

                              <span className="mp-role-symbol">
                                <Icon
                                  name={
                                    value === "farmer"
                                      ? "leaf"
                                      : "cart"
                                  }
                                  size={28}
                                />
                              </span>

                              <span className="mp-role-description">
                                <strong>
                                  {ui(value)}
                                </strong>

                                <small>
                                  {ui(`${value}Text`)}
                                </small>
                              </span>
                            </label>
                          ),
                        )}
                      </div>
                    )}

                    {collectDetails && !credential && (
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
                            show ? t.hide : t.show
                          }
                          onToggle={() =>
                            setShow((value) => !value)
                          }
                        />

                        {register && (
                          <PasswordField
                            label={ui("confirm")}
                            name="confirm_password"
                            placeholder={text(
                              "Confirm your password",
                            )}
                            show={show}
                            register
                            toggleLabel={
                              show ? t.hide : t.show
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

                    {!register && !credential && (
                      <button
                        className="mp-text-button mp-forgot"
                        type="button"
                        onClick={() =>
                          setForgot(true)
                        }
                      >
                        {ui("forgot")}
                      </button>
                    )}

                    <button
                      className="mp-button mp-red mp-full"
                      type="submit"
                    >
                      {ui(
                        busy
                          ? "waiting"
                          : credential
                            ? "complete"
                            : register
                              ? "register"
                              : "login",
                      )}
                    </button>
                  </fieldset>
                </form>

                {!credential && googleClientId && (
                  <>
                    <div className="mp-or">
                      {text("or")}
                    </div>

                    <GoogleButton
                      lang={lang}
                      disabled={busy}
                      onCredential={googleLogin}
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
                    {ui(
                      register
                        ? "login"
                        : "register",
                    )}
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </section>

        {register && <Features t={t} />}

        <Lessons t={t} />

        {register && (
          <section className="mp-auth-bottom-cta">
            <div className="mp-container">
              <h2>{ui("cta")}</h2>

              <Link
                className="mp-button mp-red"
                to="/register"
              >
                {ui("getStarted")}
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
          onClose={() => setForgot(false)}
        />
      )}
    </div>
  );
}

const AUTH_TEXT_FIX = `
div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-register
.mp-register-title {
  margin:0 0 16px!important;
  padding:0 0 14px!important;
  border:0!important;
  border-bottom:1px solid #dce5de!important;
  background:transparent;
  color:#173c35!important;
  text-align:left;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-register
.mp-register-title h1 {
  max-width:none;
  margin:0 0 7px;
  color:#005536!important;
  font-size:30px!important;
  line-height:1.08!important;
  letter-spacing:-.7px;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-register
.mp-register-title .mp-eyebrow {
  margin-bottom:6px;
  color:#537366!important;
  font-size:9px!important;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-register
.mp-register-title>p:last-child {
  color:#4a6f93!important;
  font-size:12px!important;
  line-height:1.45;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login
.mp-form-heading h2 {
  margin-bottom:7px;
  font-size:32px!important;
  line-height:1.2!important;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login
.mp-form-heading p {
  font-size:14px!important;
  line-height:1.5!important;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login
.mp-form label {
  font-size:12px;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login
.mp-form input:not([type="radio"]):not([type="checkbox"]) {
  font-size:13px;
  min-height:38px;
  height:38px;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login
.mp-password button {
  height:38px;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login
:is(.mp-auth-switch,.mp-forgot,.mp-auth-tabs a) {
  font-size:12px;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-register[lang="ta"]
.mp-register-title h1 {
  font-size:26px!important;
  line-height:1.3!important;
  letter-spacing:0;
}

div.mp-site.mp-reference-auth.mp-auth-exact.mp-reference-login[lang="ta"]
.mp-form-heading h2 {
  font-size:27px!important;
  line-height:1.35!important;
}
`;