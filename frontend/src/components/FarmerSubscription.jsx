import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";

export default function FarmerSubscription({ userId, t }) {
  const [state, setState] = useState({ plans: [], history: [], loading: true, error: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(null);
  const mounted = useRef(true);
  const working = useRef(false);

  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setState((old) => ({ ...old, loading: true, error: "" }));
    try {
      const [plans, history] = await Promise.all([
        apiRequest("/subscription-plans", { signal: controller.signal }),
        (async () => {
          const rows = [];
          for (let offset = 0; offset < 10000; offset += 100) {
            const batch = await apiRequest(`/farmer/subscriptions?limit=100&offset=${offset}`, { signal: controller.signal });
            if (!Array.isArray(batch)) throw new Error("Could not load subscriptions.");
            if (batch.some((item) => rows.some((old) => old.id === item.id))) throw new Error("Could not load subscription history. Please refresh.");
            rows.push(...batch);
            if (batch.length < 100) return rows;
          }
          throw new Error("Please contact support to load this many subscriptions.");
        })(),
      ]);
      if (!Array.isArray(plans)) throw new Error("Could not load subscription plans.");
      if (!controller.signal.aborted) setState({ plans, history, loading: false, error: "" });
    } catch (err) {
      if (!controller.signal.aborted) setState((old) => ({ ...old, loading: false, error: err.message || "Could not load subscriptions." }));
    }
  }, [userId]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; pending.current?.abort(); };
  }, [load]);

  const open = state.history.find((row) => ["pending", "active"].includes(row.effective_status));

  async function request(plan) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const storageKey = `millet-subscription-request:${userId}:${plan.id}`;
      let key = sessionStorage.getItem(storageKey);
      if (key && state.history.some((row) => row.request_key === key && ["cancelled", "expired"].includes(row.effective_status))) key = null;
      if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); }
      await apiRequest("/farmer/subscriptions", {
        method: "POST", body: JSON.stringify({ plan_id: plan.id, request_key: key }),
      });
      if (mounted.current) { setNotice(t("Subscription request saved. Payment is still pending.")); await load(); }
    } catch (err) { if (mounted.current) setError(err.message || t("Could not save your changes. Please try again.")); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  async function cancel(row) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/farmer/subscriptions/${row.id}/cancel`, { method: "PATCH" });
      sessionStorage.removeItem(`millet-subscription-request:${userId}:${row.plan_id}`);
      if (mounted.current) { setNotice(t("Subscription request cancelled.")); await load(); }
    } catch (err) { if (mounted.current) setError(err.message || t("Could not save your changes. Please try again.")); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="fd-panel fd-subscriptions">
    <div className="fd-section-heading"><h2>{t("Farmer Subscription")}</h2><button className="fd-button fd-outline" type="button" disabled={busy || state.loading} onClick={load}>{t("Refresh")}</button></div>
    <p className="fd-muted">{t("Online payment is not available yet. A request does not activate the paid plan.")}</p>
    {(error || state.error) && <p className="fd-alert fd-error" role="alert">{error || state.error}</p>}
    {notice && <p className="fd-alert fd-success" role="status">{notice}</p>}
    {state.loading ? <p role="status">{t("Loading subscription…")}</p> : !state.error && <>
      {open && <p className="fd-context">{t("Current subscription status")}: <strong>{t(open.effective_status === "pending" ? "Pending" : "Active")}</strong> · {t(open.has_access ? "Paid features are active." : "Paid features are not active.")}</p>}
      {!state.plans.length && <p>{t("No subscription plans are available right now.")}</p>}
      <div className="fd-plan-grid">{state.plans.map((plan) => <article className="fd-plan" key={plan.id}>
        <h3>{plan.name}</h3><strong>{plan.currency} {Number(plan.amount).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <p>{plan.duration_months} {t("month")}</p><p>{t("Explore extra AI guidance and SMS reminders.")}</p>
        <button className="fd-button fd-red" type="button" disabled={busy || Boolean(open)} onClick={() => request(plan)}>{t(busy ? "Saving…" : open ? "Subscription already requested" : "Request subscription")}</button>
      </article>)}</div>
      <h3>{t("Subscription History")}</h3>
      {!state.history.length ? <p>{t("No subscriptions yet.")}</p> : <div className="fd-table-scroll"><table className="fd-table"><thead><tr>{["Plan", "Amount", "Status", "Payment", "Period", "Actions"].map((label) => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{state.history.map((row) => <tr key={row.id}>
        <td>{row.plan_name}</td><td>{row.currency} {row.amount}</td><td>{t(({ pending: "Pending", active: "Active", expired: "Expired", cancelled: "Cancelled" })[row.effective_status] || row.effective_status)}</td>
        <td>{t(({ pending: "Pending", paid: "Paid", failed: "Failed", cancelled: "Cancelled", refunded: "Refunded" })[row.payment?.status] || "Not available")}</td>
        <td>{row.starts_at && row.ends_at ? `${row.starts_at.slice(0, 10)} → ${row.ends_at.slice(0, 10)}` : t("Not started")}</td>
        <td>{row.status === "pending" && <button type="button" className="fd-button fd-outline fd-small" disabled={busy} onClick={() => cancel(row)}>{t("Cancel request")}</button>}</td>
      </tr>)}</tbody></table></div>}
    </>}
  </section>;
}
