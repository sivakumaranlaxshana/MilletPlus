import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiRequest } from "../api";


const LABELS = {
  pending: "Pending",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

function Icon({ name = "leaf", size = 28 }) {
  const paths = {
    leaf: "M20 4C10 2 3 7 5 14c2 7 13 7 15-10ZM5 21 16 10",
    calendar:
      "M5 5h14v16H5zM8 2v6m8-6v6M5 11h14M9 15h1m4 0h1",
    crown: "m3 7 4 4 5-7 5 7 4-4-2 13H5ZM6 17h12",
    bars: "M5 20V12m7 8V4m7 16V8",
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.leaf} />
    </svg>
  );
}

async function loadHistory(signal) {
  const rows = [];
  const seen = new Set();

  for (let offset = 0; offset < 10000; offset += 100) {
    const batch = await apiRequest(
      `/farmer/subscriptions?limit=100&offset=${offset}`,
      { signal },
    );

    if (!Array.isArray(batch)) {
      throw new Error("Could not load subscription history.");
    }

    for (const row of batch) {
      if (row?.id == null || seen.has(String(row.id))) {
        throw new Error("Invalid subscription history. Please refresh.");
      }

      seen.add(String(row.id));
      rows.push(row);
    }

    if (batch.length < 100) return rows;
  }

  throw new Error("Too many subscription records. Please contact support.");
}

function openSandboxCheckout(data) {
  const action = new URL(
    data?.action_url || "",
    window.location.origin,
  );

  if (
    data?.sandbox !== true ||
    String(data.method).toUpperCase() !== "POST" ||
    action.origin !== "https://sandbox.payhere.lk" ||
    action.pathname.replace(/\/$/, "") !== "/pay/checkout" ||
    action.search ||
    action.hash ||
    action.username ||
    action.password
  ) {
    throw new Error(
      "The backend did not return a valid PayHere Sandbox checkout.",
    );
  }

  const fields = data.fields;

  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("Checkout fields are missing.");
  }

  const required = [
    "merchant_id",
    "order_id",
    "amount",
    "currency",
    "hash",
    "notify_url",
    "return_url",
    "cancel_url",
  ];

  for (const name of required) {
    if (typeof fields[name] !== "string" || !fields[name].trim()) {
      throw new Error(`Checkout field is missing: ${name}`);
    }
  }

  const form = document.createElement("form");

  form.method = "POST";
  form.action = action.href;
  form.acceptCharset = "UTF-8";
  form.style.display = "none";

  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "string") {
      throw new Error("Invalid checkout field value.");
    }

    const input = document.createElement("input");

    input.type = "hidden";
    input.name = name;
    input.value = value;

    form.appendChild(input);
  }

  document.body.appendChild(form);

  try {
    HTMLFormElement.prototype.submit.call(form);
  } finally {
    form.remove();
  }
}

export default function FarmerSubscription({
  userId,
  t = (text) => text,
}) {
  const location = useLocation();
  const query = new URLSearchParams(location.search);

  const returnMode = query.get("subscription_payment");
  const returnedId = query.get("subscription_id");

  const [revision, setRevision] = useState(0);

  const [state, setState] = useState({
    plans: [],
    history: [],
    loading: true,
    error: "",
  });

  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkoutId, setCheckoutId] = useState(null);

  const session = useRef(0);
  const work = useRef(null);
  const polls = useRef(0);

  useEffect(() => {
    session.current += 1;

    setBusy(false);
    setError("");
    setNotice("");
    setCheckoutId(null);
    setProfile(null);

    polls.current = 0;

    return () => {
      session.current += 1;
      work.current?.abort();
      work.current = null;
    };
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();

    setState((old) => ({
      ...old,
      loading: true,
      error: "",
    }));

    async function load() {
      const [plans, history, account] = await Promise.all([
        apiRequest("/subscription-plans", {
          signal: controller.signal,
        }),
        loadHistory(controller.signal),
        apiRequest("/auth/me", {
          signal: controller.signal,
        }),
      ]);

      if (!Array.isArray(plans)) {
        throw new Error("Could not load subscription plans.");
      }

      if (!controller.signal.aborted) {
        setProfile(account);

        setState({
          plans,
          history,
          loading: false,
          error: "",
        });
      }
    }

    load().catch((err) => {
      if (!controller.signal.aborted) {
        setState((old) => ({
          ...old,
          loading: false,
          error: err.message || "Could not load subscriptions.",
        }));
      }
    });

    return () => controller.abort();
  }, [userId, revision]);

  const active = state.history.find(
    (row) => row.effective_status === "active",
  );

  const pending = state.history.find(
    (row) => row.effective_status === "pending",
  );

  const current = active || pending;

  const returned = state.history.find(
    (row) => String(row.id) === returnedId,
  );

  const checkout = state.history.find(
    (row) => String(row.id) === String(checkoutId),
  );

  useEffect(() => {
    polls.current = 0;
  }, [returnMode, returnedId]);

  useEffect(() => {
    if (
      returnMode !== "return" ||
      !returnedId ||
      state.loading ||
      state.error ||
      busy
    ) {
      return;
    }

    const terminal =
      returned &&
      (
        returned.effective_status === "active" ||
        ["paid", "failed", "cancelled", "refunded"].includes(
          returned.payment?.status,
        ) ||
        ["cancelled", "expired"].includes(returned.effective_status)
      );

    if (terminal || polls.current >= 5) return;

    const timer = window.setTimeout(() => {
      polls.current += 1;
      setRevision((value) => value + 1);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [
    returnMode,
    returnedId,
    returned,
    state.loading,
    state.error,
    busy,
  ]);

  function refresh() {
    polls.current = 0;
    setError("");
    setNotice("");
    setRevision((value) => value + 1);
  }

  function money(value, currency = "LKR") {
    if (
      value == null ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return `${currency} ${Number(value).toLocaleString("en-LK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function status(value) {
    return t(LABELS[value] || value || "Not available");
  }

  function canPay(row) {
    return (
      !active &&
      row?.status === "pending" &&
      row.effective_status === "pending" &&
      row.payment?.status === "pending" &&
      !row.payment?.requires_review &&
      !row.payment?.provider_payment_id &&
      (
        !row.payment?.provider ||
        row.payment.provider === "payhere"
      )
    );
  }

  async function run(action) {
    if (work.current) return;

    const controller = new AbortController();
    const owner = session.current;

    work.current = controller;

    setBusy(true);
    setError("");
    setNotice("");

    const valid = () =>
      session.current === owner && !controller.signal.aborted;

    try {
      await action(controller.signal, valid);
    } catch (err) {
      if (valid()) {
        setError(
          err.message ||
          t("Could not save your changes. Please try again."),
        );
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
      }

      if (valid()) setBusy(false);
    }
  }

  function requestSubscription(plan) {
    if (
      current ||
      state.loading ||
      state.error ||
      userId == null
    ) {
      return;
    }

    run(async (signal, valid) => {
      const storageKey =
        `millet-subscription-request:${userId}:${plan.id}`;

      let key = sessionStorage.getItem(storageKey);

      const finishedRequest = key && state.history.some(
        (row) =>
          row.request_key === key &&
          ["expired", "cancelled"].includes(row.effective_status),
      );

      if (finishedRequest) key = null;

      if (!key) {
        key = crypto.randomUUID();
        sessionStorage.setItem(storageKey, key);
      }

      await apiRequest("/farmer/subscriptions", {
        method: "POST",
        signal,
        body: JSON.stringify({
          plan_id: plan.id,
          request_key: key,
        }),
      });

      if (valid()) {
        setNotice(
          t("Request saved. Use Pay with PayHere to continue."),
        );

        setRevision((value) => value + 1);
      }
    });
  }

  function cancelSubscription(row) {
    run(async (signal, valid) => {
      await apiRequest(
        `/farmer/subscriptions/${row.id}/cancel`,
        {
          method: "PATCH",
          signal,
        },
      );

      if (valid()) {
        sessionStorage.removeItem(
          `millet-subscription-request:${userId}:${row.plan_id}`,
        );

        setCheckoutId(null);
        setNotice(t("Subscription request cancelled."));
        setRevision((value) => value + 1);
      }
    });
  }

  function openCheckout(row) {
    setCheckoutId(row.id);
    setError("");
    setNotice("");

    window.requestAnimationFrame(() => {
      document.getElementById("fs-checkout")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function submitCheckout(event) {
    event.preventDefault();

    if (busy || state.loading || !canPay(checkout)) return;

    const form = new FormData(event.currentTarget);

    const customer = Object.fromEntries(
      ["first_name", "last_name", "email", "address", "city"].map(
        (name) => [name, String(form.get(name) || "").trim()],
      ),
    );

    if (
      Object.values(customer).some((value) => !value) ||
      customer.address.length < 5
    ) {
      setError(
        t(
          "Complete all checkout details. Address must have at least 5 characters.",
        ),
      );

      return;
    }

    run(async (signal, valid) => {
      const data = await apiRequest(
        `/farmer/subscriptions/${checkout.id}/checkout`,
        {
          method: "POST",
          signal,
          body: JSON.stringify(customer),
        },
      );

      if (valid()) openSandboxCheckout(data);
    });
  }

  function toggleSms() {
    if (!profile?.phone) {
      setError(
        t(
          "Save your phone number in My Profile before enabling SMS reminders.",
        ),
      );

      return;
    }

    const enabled = !profile.sms_opt_in;

    run(async (signal, valid) => {
      const account = await apiRequest("/auth/me", {
        method: "PATCH",
        signal,
        body: JSON.stringify({
          name: profile.name,
          phone: profile.phone,
          sms_opt_in: enabled,
        }),
      });

      if (valid()) {
        setProfile(account);

        setNotice(
          t(
            enabled
              ? "SMS consent saved. Reminder delivery also depends on crop access and the reminder settings."
              : "SMS reminders turned off in your profile.",
          ),
        );
      }
    });
  }

  let returnText = "";

  if (returnMode === "cancel") {
    returnText = t(
      "Checkout was closed or cancelled. Your latest backend status is shown below.",
    );
  } else if (returnMode === "return") {
    if (returned?.payment?.status === "paid") {
      returnText = t(
        "The backend has confirmed your payment. Check subscription access below.",
      );
    } else if (
      returned &&
      ["failed", "cancelled", "refunded"].includes(
        returned.payment?.status,
      )
    ) {
      returnText =
        `${t("Payment status")}: ${status(returned.payment.status)}`;
    } else {
      returnText = t(
        "Checking payment confirmation. If still pending, wait a moment and press Refresh. Returning from checkout does not confirm payment.",
      );
    }
  }

  return (
    <section className="fd-subscriptions fs-page">
      <div className="fs-hero">
        <div className="fs-hero-copy">
          <p className="fs-eyebrow">
            {t("Farmer Support")}
          </p>

          <h2>
            {t("A little more support.")}
            <br />
            <span>{t("Every growing season.")}</span>
          </h2>

          <p>
            {t("Care for your crops. Plan your next season.")}
          </p>
        </div>
      </div>

      <div className="fs-content">
        <div className="fs-toolbar">
          <span>
            {t(
              "PayHere Sandbox — test checkout. This is not a live payment.",
            )}
          </span>

          <button
            type="button"
            className="fd-button fd-outline fd-small"
            disabled={busy || state.loading}
            onClick={refresh}
          >
            {t("Refresh")}
          </button>
        </div>

        {returnText && (
          <p className="fd-context" role="status">
            {returnText}
          </p>
        )}

        {(error || state.error) && (
          <p className="fd-alert fd-error" role="alert">
            {error || t(state.error)}
          </p>
        )}

        {notice && (
          <p className="fd-alert fd-success" role="status">
            {notice}
          </p>
        )}

        {state.loading ? (
          <p className="fs-loading" role="status">
            {t("Loading subscription…")}
          </p>
        ) : state.error ? (
          <button
            type="button"
            className="fd-button fd-outline"
            disabled={busy}
            onClick={refresh}
          >
            {t("Retry")}
          </button>
        ) : (
          <>
            <div className="fs-overview">
              <div className="fs-benefits">
                <h3>
                  {t("One subscription. All your crops.")}
                </h3>

                <p className="fs-subtitle">
                  {t("More guidance. Better planning.")}
                </p>

                {[
                  [
                    "leaf",
                    "AI crop guidance",
                    "Get crop care suggestions and photo-based health checks.",
                  ],
                  [
                    "calendar",
                    "SMS reminders",
                    "Receive reminders for your saved crop care tasks.",
                  ],
                ].map(([icon, title, description]) => (
                  <article className="fs-benefit" key={title}>
                    <span className="fs-benefit-icon">
                      <Icon name={icon} size={34} />
                    </span>

                    <div>
                      <h4>{t(title)}</h4>
                      <p>{t(description)}</p>
                    </div>
                  </article>
                ))}

                <img
                  className="fs-care-photo"
                  src="/images/crop-leaf.png"
                  alt={t("Millet crop leaves")}
                />
              </div>

              <div className="fs-plans">
                {!state.plans.length && (
                  <article className="fs-plan">
                    <p>
                      {t(
                        "No subscription plans are available right now.",
                      )}
                    </p>
                  </article>
                )}

                {state.plans.map((plan) => {
                  const own =
                    current &&
                    String(current.plan_id) === String(plan.id)
                      ? current
                      : null;

                  return (
                    <article className="fs-plan" key={plan.id}>
                      <h3>
                        <Icon name="crown" size={28} />
                        {t(plan.name)}
                      </h3>

                      <strong className="fs-price">
                        {money(plan.amount, plan.currency)}
                      </strong>

                      <p className="fs-term">
                        {plan.duration_months} {t("month")}
                      </p>

                      <p className="fs-free-pill">
                        {t("First crop cycle free")}
                      </p>

                      <ul className="fs-inclusions">
                        {[
                          "AI crop guidance",
                          "Crop health checks",
                          "SMS reminders",
                        ].map((label) => (
                          <li key={label}>✓ {t(label)}</li>
                        ))}
                      </ul>

                      {own && (
                        <>
                          <span
                            className={
                              `fs-plan-status ${
                                own.effective_status === "active"
                                  ? "is-active"
                                  : ""
                              }`
                            }
                          >
                            {status(own.effective_status)}
                          </span>

                          <p className="fs-access">
                            {t(
                              own.has_access === true
                                ? "Paid features are active."
                                : "Paid features are not active.",
                            )}
                          </p>
                        </>
                      )}

                      {canPay(own) ? (
                        <button
                          type="button"
                          className="fd-button fd-red fs-plan-button"
                          disabled={busy}
                          onClick={() => openCheckout(own)}
                        >
                          {t("Pay with PayHere")} →
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="fd-button fd-red fs-plan-button"
                          disabled={
                            busy ||
                            Boolean(current) ||
                            userId == null
                          }
                          onClick={() => requestSubscription(plan)}
                        >
                          {t(
                            busy
                              ? "Saving…"
                              : active
                                ? "Subscription active"
                                : pending
                                  ? "Subscription request pending"
                                  : "Request subscription",
                          )}
                        </button>
                      )}

                      <small>
                        {t("Sandbox checkout · Test payment")}
                      </small>
                    </article>
                  );
                })}
              </div>
            </div>

            {checkout && canPay(checkout) && (
              <section
                className="fs-checkout fd-inline-editor"
                id="fs-checkout"
              >
                <div className="fd-section-heading">
                  <h3>{t("Pay with PayHere")}</h3>

                  <button
                    type="button"
                    className="fd-button fd-outline fd-small"
                    disabled={busy}
                    onClick={() => setCheckoutId(null)}
                  >
                    {t("Close")}
                  </button>
                </div>

                <p className="fd-context">
                  {t(checkout.plan_name)} ·{" "}
                  {money(checkout.amount, checkout.currency)}
                </p>

                <p className="fd-muted">
                  {t(
                    "Save your phone number in My Profile before checkout.",
                  )}
                </p>

                <form onSubmit={submitCheckout}>
                  <fieldset disabled={busy}>
                    <div className="fd-form-grid">
                      <label>
                        {t("First name")}
                        <input
                          name="first_name"
                          autoComplete="given-name"
                          required
                          maxLength={100}
                        />
                      </label>

                      <label>
                        {t("Last name")}
                        <input
                          name="last_name"
                          autoComplete="family-name"
                          required
                          maxLength={100}
                        />
                      </label>

                      <label>
                        {t("Email address")}
                        <input
                          name="email"
                          type="email"
                          autoComplete="email"
                          defaultValue={profile?.email || ""}
                          required
                          maxLength={254}
                        />
                      </label>

                      <label>
                        {t("City")}
                        <input
                          name="city"
                          autoComplete="address-level2"
                          required
                          maxLength={100}
                        />
                      </label>

                      <label className="fd-span-all">
                        {t("Address")}
                        <input
                          name="address"
                          autoComplete="street-address"
                          required
                          minLength={5}
                          maxLength={500}
                        />
                      </label>
                    </div>

                    <div className="fd-actions">
                      <button
                        type="submit"
                        className="fd-button fd-red"
                      >
                        {t(
                          busy
                            ? "Opening checkout…"
                            : "Continue to PayHere Sandbox",
                        )}{" "}
                        →
                      </button>
                    </div>
                  </fieldset>
                </form>
              </section>
            )}

            <div className="fs-eligibility">
              <strong>
                {t("Your first crop cycle is free.")}
              </strong>

              <span>
                {t(
                  "Additional crop cycles require an active paid plan.",
                )}
              </span>
            </div>

            <section className="fs-comparison">
              <h3>
                <Icon name="bars" size={26} />
                {t("Your plan at a glance")}
              </h3>

              <div className="fd-table-scroll">
                <table className="fs-table">
                  <thead>
                    <tr>
                      <th>{t("Feature")}</th>
                      <th>{t("First crop cycle")}</th>
                      <th>{t("Paid plan")}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {[
                      "Crop records",
                      "AI crop guidance",
                      "Crop health checks",
                      "SMS reminders",
                    ].map((label) => (
                      <tr key={label}>
                        <td>{t(label)}</td>

                        {[0, 1].map((column) => (
                          <td key={column}>
                            <span
                              className="fs-check"
                              aria-label={t("Included")}
                            >
                              ✓
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="fs-footnote">
                {t(
                  "First crop cycle access is free. Additional crop cycles require an active paid plan. SMS requires your consent.",
                )}
              </p>
            </section>

            <section className="fs-sms">
              <span className="fs-benefit-icon">
                <Icon name="calendar" size={29} />
              </span>

              <div>
                <h3>{t("SMS reminders")}</h3>

                <p>
                  {t(
                    "Requires an eligible crop cycle and your consent.",
                  )}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={profile?.sms_opt_in === true}
                aria-label={t("SMS reminders")}
                className="fs-toggle"
                disabled={busy || !profile}
                onClick={toggleSms}
              >
                <span />
              </button>

              <span className="fs-toggle-label">
                {t(profile?.sms_opt_in ? "On" : "Off")}
              </span>
            </section>

            <section className="fs-history">
              <h3>{t("Subscription History")}</h3>

              {!state.history.length ? (
                <div className="fd-empty">
                  <p>{t("No subscriptions yet.")}</p>
                </div>
              ) : (
                <div className="fd-table-scroll">
                  <table className="fd-table">
                    <thead>
                      <tr>
                        {[
                          "Plan",
                          "Amount",
                          "Status",
                          "Payment",
                          "Period",
                          "Actions",
                        ].map((label) => (
                          <th key={label}>{t(label)}</th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {state.history.map((row) => (
                        <tr key={row.id}>
                          <td>{t(row.plan_name)}</td>

                          <td>
                            {money(row.amount, row.currency)}
                          </td>

                          <td>
                            {status(row.effective_status)}
                          </td>

                          <td>
                            {status(row.payment?.status)}
                          </td>

                          <td>
                            {row.starts_at && row.ends_at
                              ? `${row.starts_at.slice(0, 10)} → ${row.ends_at.slice(0, 10)}`
                              : t("Not started")}
                          </td>

                          <td>
                            <div className="fd-inline-actions">
                              {canPay(row) && (
                                <button
                                  type="button"
                                  className="fd-button fd-red fd-small"
                                  disabled={busy}
                                  onClick={() => openCheckout(row)}
                                >
                                  {t("Pay with PayHere")}
                                </button>
                              )}

                              {row.status === "pending" && (
                                <button
                                  type="button"
                                  className="fd-button fd-outline fd-small"
                                  disabled={
                                    busy ||
                                    Boolean(
                                      row.payment?.requires_review ||
                                      row.payment?.provider_payment_id,
                                    )
                                  }
                                  onClick={() =>
                                    cancelSubscription(row)
                                  }
                                >
                                  {t("Cancel request")}
                                </button>
                              )}

                              {row.status !== "pending" && (
                                <span>—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}