import React, { useRef, useState } from "react";
import { apiRequest } from "../api";
import { tamilText } from "../translations";
import usePublicStocks, { formatStockValue } from "../hooks/usePublicStocks";

const cents = (value) => {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
};

const decimal = (value) => (value / 100).toFixed(2);
const cartKey = (id) => `millet_cart_v1_${id}`;
const pendingKey = (id) => `millet_order_retry_v1_${id}`;

function readCart(id) {
  try {
    const rows = JSON.parse(localStorage.getItem(cartKey(id)) || "[]");
    if (!Array.isArray(rows)) return [];
    const seen = new Set();

    return rows.filter((row) => {
      if (
        !Number.isInteger(row.id) ||
        row.id <= 0 ||
        seen.has(row.id) ||
        typeof row.name !== "string" ||
        !cents(row.quantity) ||
        !cents(row.price)
      ) {
        return false;
      }

      seen.add(row.id);
      return true;
    });
  } catch {
    return [];
  }
}

function readPending(id) {
  try {
    return JSON.parse(sessionStorage.getItem(pendingKey(id)) || "null");
  } catch {
    return null;
  }
}

function photo(name) {
  const value = name.toLowerCase();
  for (const variety of ["finger", "foxtail", "pearl", "little"]) {
    if (value.includes(variety)) return `/images/${variety}-millet.png`;
  }
  return "/images/millet-harvest.png";
}

export default function BuyerShop({
  user,
  lang = "en",
  view = "shop",
  onCart,
  onOrders,
}) {
  const say = (text) => (lang === "ta" ? tamilText(text) : text);
  const stock = usePublicStocks();
  const [cart, setCart] = useState(() => readCart(user.id));
  const [pending, setPending] = useState(() => readPending(user.id));
  const [quantities, setQuantities] = useState({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [contact, setContact] = useState({
    recipient_name: pending?.recipient_name || user.name || "",
    phone: pending?.phone || user.phone || "",
    delivery_address: pending?.delivery_address || "",
  });

  const money = (value) => `LKR ${formatStockValue(value, lang)}`;

  function saveCart(next) {
    try {
      localStorage.setItem(cartKey(user.id), JSON.stringify(next));
      setCart(next);
      return true;
    } catch {
      setMessage("Cart could not be saved in this browser.");
      return false;
    }
  }

  function add(row) {
    setMessage("");

    if (pending) {
      setMessage("An order request needs confirmation. Open Cart and retry it.");
      return;
    }

    const amount = cents(quantities[row.id] ?? "1");
    const existing = cart.find((item) => item.id === row.id);
    const combined =
      amount === null ? null : amount + (existing ? cents(existing.quantity) : 0);

    if (!row.in_stock || !amount || combined > cents(row.available_quantity)) {
      setMessage("Enter a valid quantity within available stock.");
      return;
    }

    if (existing && cents(existing.price) !== cents(row.selling_price_per_kg)) {
      setMessage("Price changed. Remove this item from Cart and add it again.");
      return;
    }

    const next = cart.filter((item) => item.id !== row.id);
    next.push({
      id: row.id,
      name: row.variety_name,
      quantity: decimal(combined),
      price: row.selling_price_per_kg,
    });

    if (saveCart(next)) {
      setMessage("Added to Cart.");
      onCart?.();
    }
  }

  function update(id, value) {
    const amount = cents(value);

    if (!amount) {
      setMessage("Enter a valid quantity within available stock.");
      return;
    }

    const row = stock.records.find((item) => item.id === id);

    if (!row?.in_stock || amount > cents(row.available_quantity)) {
      setMessage("Enter a valid quantity within available stock.");
      return;
    }

    setMessage("");
    saveCart(
      cart.map((item) =>
        item.id === id ? { ...item, quantity: decimal(amount) } : item
      )
    );
  }

  const cartInvalid = cart.some((item) => {
    const row = stock.records.find((record) => record.id === item.id);
    return (
      !row?.in_stock ||
      cents(item.quantity) > cents(row.available_quantity) ||
      cents(item.price) !== cents(row.selling_price_per_kg)
    );
  });

  const total = cart.reduce(
    (sum, row) => sum + Number(row.quantity) * Number(row.price),
    0
  );

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;

    if (!pending && (!cart.length || stock.loading || stock.error || cartInvalid)) {
      setMessage("Refresh stock and review your cart before ordering.");
      return;
    }

    submitting.current = true;
    setBusy(true);
    setMessage("");

    try {
      let payload = pending;

      if (!payload) {
        payload = {
          request_key: crypto.randomUUID(),
          recipient_name: contact.recipient_name.trim(),
          phone: contact.phone.trim(),
          delivery_address: contact.delivery_address.trim(),
          items: cart.map((row) => ({
            stock_id: row.id,
            quantity_kg: row.quantity,
            expected_unit_price: row.price,
          })),
        };

        // Keep the same request key if the response is lost.
        sessionStorage.setItem(pendingKey(user.id), JSON.stringify(payload));
        setPending(payload);
      }

      const order = await apiRequest("/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      sessionStorage.removeItem(pendingKey(user.id));
      setPending(null);
      saveCart([]);
      setMessage(`${say("Order saved.")} #${order.id}`);
      stock.refresh();
      onOrders?.();
    } catch (error) {
      const certainFailure =
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status);

      if (certainFailure) {
        sessionStorage.removeItem(pendingKey(user.id));
        setPending(null);
        const detail = typeof error.detail === "string" ? error.detail : error.message;
        setMessage(detail || "Order could not be saved. Review your cart.");
      } else {
        setMessage("The order result is uncertain. Retry the same request or check My Orders.");
      }

      stock.refresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mp-order-ui">
      <div className="page-actions">
        <button
          type="button"
          className="btn outline"
          onClick={() => stock.refresh()}
          disabled={stock.refreshing}
        >
          {say("Refresh")}
        </button>
        {onCart && (
          <button type="button" className="btn red" onClick={onCart}>
            {say("Cart")} ({cart.length})
          </button>
        )}
        <button type="button" className="btn outline" onClick={onOrders}>
          {say("My Orders")}
        </button>
      </div>

      {message && <p className="alert" role="status">{say(message)}</p>}
      {stock.loading && <p role="status">{say("Loading stock…")}</p>}
      {stock.error && <p className="alert error" role="alert">{say(stock.error)}</p>}

      {view === "shop" ? (
        <>
          <div className="shop-controls">
            <label>
              {say("Search millet")}
              <input value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>

            <div className="filter-row">
              <button
                type="button"
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                {say("All Millets")}
              </button>
              {[...new Set(stock.records.map((row) => row.variety_name))].map((name) => (
                <button
                  type="button"
                  key={name}
                  className={filter === name ? "active" : ""}
                  onClick={() => setFilter(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="shop-products">
            {stock.records
              .filter(
                (row) =>
                  (filter === "all" || filter === row.variety_name) &&
                  row.variety_name.toLowerCase().includes(search.toLowerCase())
              )
              .map((row) => (
                <article className="product-card" key={row.id}>
                  <img className="silver-photo" src={photo(row.variety_name)} alt={row.variety_name} />
                  <h3>{row.variety_name}</h3>
                  <p>{say(row.in_stock ? "In stock" : "Out of Stock")}</p>
                  <p>{say("Available")}: {formatStockValue(row.available_quantity, lang)} kg</p>
                  <strong>{money(row.selling_price_per_kg)} / kg</strong>
                  <label>
                    {say("Quantity (kg)")}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={row.available_quantity}
                      value={quantities[row.id] ?? "1"}
                      disabled={!!pending}
                      onChange={(event) =>
                        setQuantities({ ...quantities, [row.id]: event.target.value })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn red full"
                    disabled={!row.in_stock || !!pending}
                    onClick={() => add(row)}
                  >
                    {say("Add to Cart")}
                  </button>
                </article>
              ))}
          </div>

          {!stock.loading && !stock.error && !stock.records.length && (
            <p>{say("No stock available yet.")}</p>
          )}
        </>
      ) : (
        <section className="panel">
          <h2>{say("Your Cart")}</h2>
          {!cart.length && !pending && <p>{say("Your cart is empty")}</p>}

          {cart.map((row) => (
            <div className="mp-cart-row" key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <p>{money(row.price)} / kg</p>
              </div>
              <label>
                {say("Quantity (kg)")}
                <input
                  key={row.quantity}
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={row.quantity}
                  disabled={busy || !!pending}
                  onBlur={(event) => {
                    update(row.id, event.target.value);
                    event.target.value = row.quantity;
                  }}
                />
              </label>
              <strong>{money(Number(row.price) * Number(row.quantity))}</strong>
              <button
                type="button"
                className="btn outline"
                disabled={busy || !!pending}
                onClick={() => saveCart(cart.filter((item) => item.id !== row.id))}
              >
                {say("Remove")}
              </button>
            </div>
          ))}

          {!!cart.length && <p><strong>{say("Product total")}: {money(total)}</strong></p>}

          {cartInvalid && !!cart.length && (
            <p className="alert error">
              {say("Stock or price changed. Remove unavailable items and add updated items from Shop.")}
            </p>
          )}

          {(!!cart.length || pending) && (
            <form onSubmit={submit}>
              <fieldset disabled={busy || !!pending}>
                <label>
                  {say("Recipient name")}
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={contact.recipient_name}
                    onChange={(event) =>
                      setContact({ ...contact, recipient_name: event.target.value })
                    }
                  />
                </label>
                <label>
                  {say("Phone")}
                  <input
                    type="tel"
                    required
                    minLength={7}
                    maxLength={30}
                    value={contact.phone}
                    onChange={(event) =>
                      setContact({ ...contact, phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  {say("Delivery address")}
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={contact.delivery_address}
                    onChange={(event) =>
                      setContact({ ...contact, delivery_address: event.target.value })
                    }
                  />
                </label>
              </fieldset>
              <p>{say("This order records product cost only. Delivery and payment are arranged separately.")}</p>
              {pending && (
                <p role="status">
                  {say("Retry uses the original order details. Cart editing is paused until the result is confirmed.")}
                </p>
              )}
              <button
                className="btn red"
                type="submit"
                disabled={busy || (!pending && (stock.loading || !!stock.error || cartInvalid))}
              >
                {say(busy ? "Saving…" : pending ? "Retry same order" : "Place Order")}
              </button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}