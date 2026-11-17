import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";
import { tamilText } from "../translations";
import { formatStockValue } from "../hooks/usePublicStocks";

export default function OrdersPanel({ role, lang = "en" }) {
  const admin = role === "admin";
  const say = (text) => lang === "ta" ? tamilText(text) : text;
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const active = useRef(null);
  const limit = 20;
  const load = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(`${admin ? "/admin/orders" : "/orders"}?offset=${offset}&limit=${limit}`, { signal: controller.signal });
      if (!controller.signal.aborted) setRows(data);
    } catch (err) {
      if (!controller.signal.aborted) { setRows([]); setError(err.message || "Orders could not be loaded."); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [admin, offset]);
  useEffect(() => { load(); return () => active.current?.abort(); }, [load]);

  async function change(order, status) {
    if (mutation.current) return;
    if (!window.confirm(say(status === "completed" ? "Complete this order after fulfilment?" : "Cancel this order and release reserved stock?"))) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await apiRequest(admin ? `/admin/orders/${order.id}/status` : `/orders/${order.id}/cancel`, {
        method: "PATCH", ...(admin ? { body: JSON.stringify({ status }) } : {}),
      });
      await load();
    } catch (err) {
      setError(`${err.message || "Update failed."} ${say("Refresh orders to confirm the current status before retrying.")}`);
    } finally { mutation.current = false; setBusy(false); }
  }

  return <section className="mp-order-ui panel">
    <div className="page-actions"><h2>{say(admin ? "Admin Orders" : "My Orders")}</h2><button type="button" className="btn outline" disabled={loading || busy} onClick={load}>{say("Refresh")}</button></div>
    {error && <p className="alert error" role="alert">{error}</p>}
    {loading ? <p role="status">{say("Loading…")}</p> : <>
      {!rows.length && !error && <p>{say("No orders yet.")}</p>}
      {rows.map((order) => <article className="mp-order-card" key={order.id}>
        <div className="page-actions"><h3>{say("Order")} #{order.id}</h3><span className={`badge ${order.status === "completed" ? "approved" : order.status === "cancelled" ? "rejected" : "pending"}`}>{say(order.status)}</span></div>
        <p>{order.recipient_name} · {order.phone}</p>
        <p>{order.delivery_address}</p>
        <p>{say("Created")}: {new Date(`${order.created_at}Z`).toLocaleString(lang === "ta" ? "ta-LK" : "en-LK")}</p>
        <div className="table-scroll"><table className="harvest-table"><thead><tr>{["Millet", "Quantity (kg)", "Price / kg", "Total"].map((text) => <th key={text}>{say(text)}</th>)}</tr></thead><tbody>
          {order.items.map((item) => <tr key={item.id}><td>{item.variety_name}</td><td>{formatStockValue(item.quantity_kg, lang)}</td><td>LKR {formatStockValue(item.unit_price, lang)}</td><td>LKR {formatStockValue(item.line_total, lang)}</td></tr>)}
        </tbody></table></div>
        <p><strong>{say("Product total")}: LKR {formatStockValue(order.total_amount, lang)}</strong></p>
        {order.status === "pending" && <div className="page-actions">
          {admin && <button type="button" className="btn red" disabled={busy} onClick={() => change(order, "completed")}>{say("Complete Order")}</button>}
          <button type="button" className="btn outline" disabled={busy} onClick={() => change(order, "cancelled")}>{say("Cancel Order")}</button>
        </div>}
      </article>)}
    </>}
    <div className="page-actions"><button type="button" className="btn outline" disabled={offset === 0 || loading || busy} onClick={() => setOffset(Math.max(0, offset - limit))}>{say("Previous")}</button><button type="button" className="btn outline" disabled={rows.length < limit || loading || busy} onClick={() => setOffset(offset + limit)}>{say("Next")}</button></div>
  </section>;
}
