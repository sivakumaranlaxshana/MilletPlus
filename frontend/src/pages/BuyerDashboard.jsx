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

import { apiRequest, dashboardPath } from "../api";
import usePublicStocks from "../hooks/usePublicStocks";
import { tamilText } from "../translations";
import { useSharedLanguage } from "../translations/language";

import BuyerOrderPayment, {
  BuyerPaymentReturn,
} from "../components/BuyerOrderPayment";

import "./BuyerDashboard.css";

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function units(value) {
  const text = String(value ?? "");

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return null;
  }

  const [whole, fraction = ""] = text.split(".");

  const amount =
    Number(whole) * 100 +
    Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(amount) ? amount : null;
}

function cropImage(name = "") {
  const text = String(name).toLowerCase();

  if (text.includes("finger") || text.includes("ragi")) {
    return "/images/finger-millet.png";
  }

  if (text.includes("foxtail")) {
    return "/images/foxtail-millet.png";
  }

  if (text.includes("pearl")) {
    return "/images/pearl-millet.png";
  }

  if (text.includes("little")) {
    return "/images/little-millet.png";
  }

  return "/images/millet-harvest.png";
}

function CropPhoto({ name }) {
  return (
    <img
      className="bd-photo"
      src={cropImage(name)}
      alt={name || "Millet"}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src =
          "/images/millet-harvest.png";
      }}
    />
  );
}

function formatOrderDate(value, lang) {
  if (!value) return "—";

  const text = String(value);
  const hasTimezone =
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(text);

  const date = new Date(
    hasTimezone ? text : `${text}Z`,
  );

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString(
    lang === "ta" ? "ta-LK" : "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Colombo",
    },
  );
}

export default function BuyerDashboard() {
  const navigate = useNavigate();
  const { lang } = useSharedLanguage();

  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    apiRequest("/auth/me", {
      signal: controller.signal,
    })
      .then((account) => {
        if (controller.signal.aborted) return;

        if (account.role !== "buyer") {
          navigate(dashboardPath(account.role), {
            replace: true,
          });
          return;
        }

        setUser(account);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        if (err.status === 401) {
          navigate("/login", { replace: true });
        } else {
          setError(
            err.message || "Could not load your account.",
          );
        }
      });

    return () => controller.abort();
  }, [navigate]);

  if (!user) {
    return (
      <main className="bd-loading">
        <p role={error ? "alert" : "status"}>
          {error || t("Loading buyer dashboard…")}
        </p>

        <Link to="/">{t("Home")}</Link>
      </main>
    );
  }

  return <BuyerWorkspace key={user.id} user={user} />;
}

function BuyerWorkspace({ user }) {
  const navigate = useNavigate();
  const location = useLocation();

  const { lang, setLang } = useSharedLanguage();

  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const stock = usePublicStocks({ enabled: true });

  const cartKey = `millet_buyer_cart_v2_${user.id}`;
  const pendingKey = `millet_buyer_order_v2_${user.id}`;

  const [cart, setCart] = useState(() => {
    const stored = readStorage(cartKey, []);

    return Array.isArray(stored)
      ? stored.filter(
          (item) =>
            item?.id != null &&
            units(item.quantity) > 0 &&
            units(item.price) !== null,
        )
      : [];
  });

  const [pending, setPending] = useState(() =>
    readStorage(pendingKey, null),
  );

  const [page, setPage] = useState(() => {
    if (readStorage(pendingKey, null)) {
      return "review";
    }

    const query = new URLSearchParams(location.search);

    return query.has("payment") ? "orders" : "shop";
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [orderFilter, setOrderFilter] = useState("all");

  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);

  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState(null);

  const [contact, setContact] = useState(() => {
    const draft = readStorage(pendingKey, null);

    return {
      recipient_name:
        draft?.recipient_name || user.name || "",
      phone: draft?.phone || user.phone || "",
      delivery_address: draft?.delivery_address || "",
    };
  });

  const working = useRef(false);
  const mutation = useRef(null);

  useEffect(() => {
    return () => mutation.current?.abort();
  }, []);

  useEffect(() => {
    if (page !== "orders") return;

    const controller = new AbortController();

    setOrdersLoading(true);
    setOrdersError("");
    setOrders([]);

    apiRequest(`/orders?limit=20&offset=${offset}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error("Orders could not be loaded.");
        }

        if (!controller.signal.aborted) {
          setOrders(data);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setOrdersError(
            err.message || "Orders could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setOrdersLoading(false);
        }
      });

    return () => controller.abort();
  }, [page, offset, revision]);

  const records = Array.isArray(stock.records)
    ? stock.records
    : [];

  const sameId = (a, b) => String(a) === String(b);

  function money(value) {
    if (
      value == null ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return `LKR ${Number(value).toLocaleString(
      lang === "ta" ? "ta-LK" : "en-LK",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`;
  }

  function statusLabel(value) {
    const labels = {
      pending: "Pending",
      completed: "Completed",
      cancelled: "Cancelled",
    };

    return t(labels[value] || value || "Not available");
  }

  const cartInvalid = cart.some((item) => {
    const row = records.find((record) =>
      sameId(record.id, item.id),
    );

    return (
      !row?.in_stock ||
      units(item.quantity) > units(row.available_quantity) ||
      units(item.price) !== units(row.selling_price_per_kg)
    );
  });

  const total = cart.reduce(
    (sum, item) =>
      sum +
      (units(item.quantity) * units(item.price)) / 10000,
    0,
  );

  const canContinue =
    cart.length > 0 &&
    !stock.loading &&
    !stock.error &&
    !cartInvalid;

  const products = records.filter(
    (row) =>
      (filter === "all" || row.variety_name === filter) &&
      String(row.variety_name)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  const visibleOrders = orders.filter(
    (order) =>
      orderFilter === "all" ||
      order.status === orderFilter,
  );

  const titles = {
    shop: "Good grains. Better choices.",
    cart: "Your next good choice.",
    details: "Almost yours.",
    review: "Review your order.",
    confirmation: "Your order is saved.",
    orders: "From farm to your table.",
  };

  function go(next) {
    if (busy) return;

    setError("");
    setNotice("");
    setPage(next);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function openOrders() {
    setOffset(0);
    setOrderFilter("all");
    setSelected(null);
    go("orders");
  }

  function saveCart(next) {
    try {
      localStorage.setItem(cartKey, JSON.stringify(next));
      setCart(next);
      return true;
    } catch {
      setError(t("Cart could not be saved in this browser."));
      return false;
    }
  }

  function addToCart(row) {
    setError("");

    if (pending) {
      setError(
        t(
          "An order request needs confirmation. Open Cart and retry it.",
        ),
      );
      return;
    }

    const existing = cart.find((item) =>
      sameId(item.id, row.id),
    );

    const quantity =
      (existing ? units(existing.quantity) : 0) + 100;

    if (
      stock.loading ||
      stock.error ||
      !row.in_stock ||
      quantity > units(row.available_quantity)
    ) {
      setError(
        t("Enter a valid quantity within available stock."),
      );
      return;
    }

    if (
      existing &&
      units(existing.price) !==
        units(row.selling_price_per_kg)
    ) {
      setError(
        t(
          "Price changed. Remove this item from Cart and add it again.",
        ),
      );
      return;
    }

    const next = cart.filter(
      (item) => !sameId(item.id, row.id),
    );

    next.push({
      id: row.id,
      name: row.variety_name,
      quantity: (quantity / 100).toFixed(2),
      price: row.selling_price_per_kg,
    });

    if (saveCart(next)) {
      setNotice(t("Added to Cart."));
      setPage("cart");

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  }

  function changeQuantity(item, delta) {
    if (pending) return;

    const quantity =
      units(item.quantity) + delta * 100;

    const row = records.find((record) =>
      sameId(record.id, item.id),
    );

    if (
      !row?.in_stock ||
      quantity <= 0 ||
      quantity > units(row.available_quantity)
    ) {
      setError(
        t("Enter a valid quantity within available stock."),
      );
      return;
    }

    setError("");

    saveCart(
      cart.map((record) =>
        sameId(record.id, item.id)
          ? {
              ...record,
              quantity: (quantity / 100).toFixed(2),
            }
          : record,
      ),
    );
  }

  async function placeOrder() {
    if (working.current) return;

    if (!pending && !canContinue) {
      setError(
        t("Refresh stock and review your cart before ordering."),
      );
      return;
    }

    if (
      !pending &&
      (!contact.recipient_name.trim() ||
        !contact.phone.trim() ||
        !contact.delivery_address.trim())
    ) {
      setError(t("Complete your contact details."));
      return;
    }

    const controller = new AbortController();
    mutation.current = controller;

    working.current = true;
    setBusy(true);
    setError("");

    try {
      let payload = pending;

      if (!payload) {
        payload = {
          request_key: crypto.randomUUID(),
          recipient_name: contact.recipient_name.trim(),
          phone: contact.phone.trim(),
          delivery_address: contact.delivery_address.trim(),

          items: cart.map((item) => ({
            stock_id: item.id,
            quantity_kg: item.quantity,
            expected_unit_price: item.price,
          })),
        };

        localStorage.setItem(
          pendingKey,
          JSON.stringify(payload),
        );

        setPending(payload);
      }

      const order = await apiRequest("/orders", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      if (controller.signal.aborted) return;

      if (order?.id == null) {
        throw new Error(
          "Order response is incomplete. Check My Orders before retrying.",
        );
      }

      localStorage.removeItem(pendingKey);
      setPending(null);

      saveCart([]);

      setSaved(order);
      setSelected(order);
      setPage("confirmation");

      stock.refresh();
    } catch (err) {
      if (controller.signal.aborted) return;

      const certainFailure =
        err.status >= 400 &&
        err.status < 500 &&
        ![408, 429].includes(err.status);

      if (certainFailure) {
        localStorage.removeItem(pendingKey);
        setPending(null);
      }

      setError(
        certainFailure
          ? err.message
          : t(
              "The order result is uncertain. Retry the same request or check My Orders.",
            ),
      );

      stock.refresh();
    } finally {
      working.current = false;

      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }

  async function cancelOrder(order) {
    if (working.current) return;

    if (
      !window.confirm(
        t("Cancel this order and release reserved stock?"),
      )
    ) {
      return;
    }

    const controller = new AbortController();
    mutation.current = controller;

    working.current = true;
    setBusy(true);
    setError("");

    try {
      await apiRequest(`/orders/${order.id}/cancel`, {
        method: "PATCH",
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        setSelected(null);
        setRevision((value) => value + 1);
        stock.refresh();
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          `${err.message} ${t(
            "Refresh orders to confirm the current status before retrying.",
          )}`,
        );
      }
    } finally {
      working.current = false;

      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }

  function logout() {
    sessionStorage.removeItem("millet_access_token");
    navigate("/", { replace: true });
  }

  function button(
    text,
    action,
    disabled = false,
    outline = false,
  ) {
    return (
      <button
        type="button"
        className={`bd-btn${outline ? " bd-outline" : ""}`}
        disabled={busy || disabled}
        onClick={action}
      >
        {t(text)}
      </button>
    );
  }

  function orderDetails(order) {
    return (
      <div className="bd-order-details">
        <div className="bd-detail-summary">
          <div>
            <span className="bd-order-number">
              {t("Order")}
            </span>
            <h3>#{order.id}</h3>
          </div>

          <span className={`bd-badge bd-${order.status}`}>
            {statusLabel(order.status)}
          </span>
        </div>

        <div className="bd-recipient">
          <h4>{t("Recipient details")}</h4>
          <p>{order.recipient_name}</p>
          <p>{order.phone}</p>
          <p>{order.delivery_address}</p>

          <p>
            {t("Ordered on")}:{" "}
            {formatOrderDate(order.created_at, lang)}
          </p>
        </div>

        <div className="bd-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Millet")}</th>
                <th>{t("Quantity (kg)")}</th>
                <th>{t("Price / kg")}</th>
                <th>{t("Total")}</th>
              </tr>
            </thead>

            <tbody>
              {(order.items || []).map((item) => (
                <tr key={item.id || item.stock_id}>
                  <td>{item.variety_name}</td>
                  <td>{item.quantity_kg}</td>
                  <td>{money(item.unit_price)}</td>
                  <td>{money(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bd-total">
          <strong>{t("Product total")}</strong>
          <strong>{money(order.total_amount)}</strong>
        </div>

        <BuyerOrderPayment
          key={order.id}
          order={order}
          user={user}
          lang={lang}
        />
      </div>
    );
  }

  return (
    <div className="buyer-dashboard" lang={lang}>
      <header className="bd-header">
        <div className="bd-wrap bd-header-inner">
          <Link to="/">
            <img
              className="bd-logo"
              src="/images/logo.png"
              alt="Millet Plus"
            />
          </Link>

          <div className="bd-header-actions">
            <button
              type="button"
              className="bd-language"
              onClick={() =>
                setLang(lang === "en" ? "ta" : "en")
              }
            >
              EN | தமிழ்
            </button>

            <span className="bd-avatar" title={user.name}>
              {user.name?.slice(0, 1)}
            </span>

            {button("Logout", logout, false, true)}
          </div>
        </div>
      </header>

      <section
        className={`bd-hero ${
          page === "orders" ? "bd-orders-hero" : ""
        }`}
      >
        <div className="bd-wrap">
          <p className="bd-eyebrow">
            {page === "orders"
              ? t("My Orders")
              : "MILLET PLUS"}
          </p>

          <h1>{t(titles[page])}</h1>

          <p>
            {t(
              page === "orders"
                ? "View your millet orders and their current status."
                : "Pure millet. Better everyday meals.",
            )}
          </p>
        </div>
      </section>

      <main className="bd-wrap bd-main">
        <BuyerPaymentReturn lang={lang} />

        <div className="bd-actions">
          {page !== "shop" &&
            button(
              "Back to shop",
              () => go("shop"),
              false,
              true,
            )}

          {page !== "orders" &&
            button("My Orders", openOrders, false, true)}

          {pending &&
            page !== "review" &&
            button(
              "Retry order request",
              () => go("review"),
            )}
        </div>

        {error && (
          <p className="bd-alert bd-error" role="alert">
            {error}
          </p>
        )}

        {notice && (
          <p className="bd-alert bd-success" role="status">
            {notice}
          </p>
        )}

        {/* SHOP */}

        {page === "shop" && (
          <>
            <section className="bd-panel">
              <div className="bd-search">
                <input
                  aria-label={t("Search millet")}
                  placeholder={t("Search millet…")}
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                />

                <select
                  aria-label={t("Millet variety")}
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value)
                  }
                >
                  <option value="all">
                    {t("All Millets")}
                  </option>

                  {[
                    ...new Set(
                      records.map(
                        (row) => row.variety_name,
                      ),
                    ),
                  ].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>

                {button(
                  "Refresh",
                  () => stock.refresh(),
                  stock.loading,
                  true,
                )}
              </div>
            </section>

            {stock.loading ? (
              <p role="status">{t("Loading…")}</p>
            ) : stock.error ? (
              <p className="bd-alert bd-error" role="alert">
                {t(
                  "Stock could not be loaded. Please refresh.",
                )}
              </p>
            ) : (
              <div className="bd-products">
                {products.map((row) => (
                  <article
                    className="bd-product"
                    key={row.id}
                  >
                    <CropPhoto name={row.variety_name} />

                    <h2>{row.variety_name}</h2>

                    <strong>
                      {money(row.selling_price_per_kg)} / kg
                    </strong>

                    <p className="bd-muted">
                      {t("Available")}:{" "}
                      {row.available_quantity} kg
                    </p>

                    {button(
                      row.in_stock
                        ? "Add to Cart"
                        : "Out of stock",
                      () => addToCart(row),
                      !row.in_stock ||
                        Boolean(pending) ||
                        units(row.available_quantity) < 100,
                    )}
                  </article>
                ))}
              </div>
            )}

            {!stock.loading &&
              !stock.error &&
              !products.length && (
                <p className="bd-empty">
                  {t("No millet found.")}
                </p>
              )}

            <section className="bd-basket">
              <strong>
                {t("Your Cart")} · {cart.length}{" "}
                {t("items")}
              </strong>

              <strong>{money(total)}</strong>

              {button(
                "View Cart",
                () => go("cart"),
              )}
            </section>
          </>
        )}

        {/* CART */}

        {page === "cart" && (
          <section className="bd-panel">
            <h2>{t("Your Cart")}</h2>

            {!cart.length ? (
              <div className="bd-empty">
                <p>{t("Your cart is empty")}</p>

                {button(
                  "Continue shopping",
                  () => go("shop"),
                )}
              </div>
            ) : (
              <>
                {cart.map((item) => (
                  <article
                    className="bd-cart-item"
                    key={item.id}
                  >
                    <CropPhoto name={item.name} />

                    <div>
                      <h3>{item.name}</h3>
                      <p>{money(item.price)} / kg</p>

                      <div className="bd-quantity">
                        <button
                          type="button"
                          aria-label={`${t(
                            "Decrease quantity",
                          )}: ${item.name}`}
                          disabled={busy || Boolean(pending)}
                          onClick={() =>
                            changeQuantity(item, -1)
                          }
                        >
                          −
                        </button>

                        <strong>
                          {Number(item.quantity)} kg
                        </strong>

                        <button
                          type="button"
                          aria-label={`${t(
                            "Increase quantity",
                          )}: ${item.name}`}
                          disabled={busy || Boolean(pending)}
                          onClick={() =>
                            changeQuantity(item, 1)
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div>
                      <strong>
                        {money(
                          Number(item.quantity) *
                            Number(item.price),
                        )}
                      </strong>

                      {button(
                        "Remove",
                        () =>
                          saveCart(
                            cart.filter(
                              (record) =>
                                !sameId(
                                  record.id,
                                  item.id,
                                ),
                            ),
                          ),
                        Boolean(pending),
                        true,
                      )}
                    </div>
                  </article>
                ))}

                <div className="bd-total">
                  <strong>{t("Product total")}</strong>
                  <strong>{money(total)}</strong>
                </div>

                {cartInvalid && (
                  <p className="bd-alert bd-error">
                    {t(
                      "Stock or price has changed. Review your cart before ordering.",
                    )}
                  </p>
                )}

                <div className="bd-actions">
                  {button(
                    "Continue shopping",
                    () => go("shop"),
                    false,
                    true,
                  )}

                  {button(
                    "Refresh stock",
                    () => stock.refresh(),
                    stock.loading,
                    true,
                  )}

                  {button(
                    "Continue",
                    () =>
                      go(
                        pending
                          ? "review"
                          : "details",
                      ),
                    !pending && !canContinue,
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* DELIVERY DETAILS */}

        {page === "details" && (
          <section className="bd-panel">
            <h2>{t("Your Details")}</h2>

            <form
              onSubmit={(event) => {
                event.preventDefault();

                if (canContinue) {
                  go("review");
                }
              }}
            >
              <fieldset
                className="bd-form"
                disabled={busy || Boolean(pending)}
              >
                {[
                  ["recipient_name", "Recipient name"],
                  ["phone", "Phone number"],
                ].map(([name, title]) => (
                  <label key={name}>
                    {t(title)}

                    <input
                      name={name}
                      required
                      maxLength={
                        name === "phone" ? 30 : 100
                      }
                      type={
                        name === "phone" ? "tel" : "text"
                      }
                      value={contact[name]}
                      onChange={(event) =>
                        setContact({
                          ...contact,
                          [name]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}

                <label className="bd-full">
                  {t("Address")}

                  <textarea
                    required
                    maxLength={500}
                    rows={3}
                    value={contact.delivery_address}
                    onChange={(event) =>
                      setContact({
                        ...contact,
                        delivery_address:
                          event.target.value,
                      })
                    }
                  />
                </label>
              </fieldset>

              <div className="bd-total">
                <strong>{t("Product total")}</strong>
                <strong>{money(total)}</strong>
              </div>

              <button
                className="bd-btn"
                type="submit"
                disabled={busy || !canContinue}
              >
                {t("Review order")}
              </button>
            </form>
          </section>
        )}

        {/* REVIEW AND CREATE ORDER */}

        {page === "review" && (
          <section className="bd-panel">
            <h2>{t("Review your order")}</h2>

            <p>
              {pending?.recipient_name ||
                contact.recipient_name}
            </p>

            <p>
              {pending?.phone || contact.phone}
            </p>

            <p>
              {pending?.delivery_address ||
                contact.delivery_address}
            </p>

            {pending ? (
              <p className="bd-alert">
                {t(
                  "An order request is awaiting confirmation. Retry uses the same request key.",
                )}
              </p>
            ) : (
              <>
                {cart.map((item) => (
                  <div
                    className="bd-review-row"
                    key={item.id}
                  >
                    <span>
                      {item.name} · {item.quantity} kg
                    </span>

                    <strong>
                      {money(
                        Number(item.quantity) *
                          Number(item.price),
                      )}
                    </strong>
                  </div>
                ))}

                <div className="bd-total">
                  <strong>{t("Product total")}</strong>
                  <strong>{money(total)}</strong>
                </div>
              </>
            )}

            <div className="bd-payment-note">
              <h3>{t("PayHere Sandbox")}</h3>

              <p>
                {t(
                  "Save your order, then continue to PayHere Sandbox payment.",
                )}
              </p>
            </div>

            <div className="bd-actions">
              {!pending &&
                button(
                  "Edit details",
                  () => go("details"),
                  false,
                  true,
                )}

              {button(
                busy
                  ? "Saving…"
                  : pending
                    ? "Retry same request"
                    : "Continue to payment",
                placeOrder,
                !pending && !canContinue,
              )}
            </div>
          </section>
        )}

        {/* SAVED ORDER AND PAYMENT */}

        {page === "confirmation" && saved && (
          <section className="bd-panel bd-confirmation">
            <div className="bd-success-icon">✓</div>

            <h2>{t("Order received")}</h2>

            <p>{t("Your order has been saved.")}</p>

            {orderDetails(saved)}

            <div className="bd-actions">
              {button(
                "View My Orders",
                openOrders,
              )}

              {button(
                "Continue shopping",
                () => go("shop"),
                false,
                true,
              )}
            </div>
          </section>
        )}

        {/* MY ORDERS */}

        {page === "orders" && (
          <section className="bd-panel bd-my-orders">
            <div className="bd-orders-heading">
              <div>
                <h2>{t("My Orders")}</h2>

                <p>
                  {t(
                    "View your millet orders and their current status.",
                  )}
                </p>
              </div>

              <div className="bd-orders-controls">
                <select
                  value={orderFilter}
                  aria-label={t("Filter orders")}
                  onChange={(event) => {
                    setOrderFilter(event.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="all">
                    {t("All Orders")}
                  </option>

                  <option value="pending">
                    {t("Pending")}
                  </option>

                  <option value="completed">
                    {t("Completed")}
                  </option>

                  <option value="cancelled">
                    {t("Cancelled")}
                  </option>
                </select>

                {button(
                  "Refresh",
                  () =>
                    setRevision((value) => value + 1),
                  ordersLoading,
                  true,
                )}
              </div>
            </div>

            {ordersLoading ? (
              <p className="bd-empty" role="status">
                {t("Loading…")}
              </p>
            ) : ordersError ? (
              <p className="bd-alert bd-error" role="alert">
                {ordersError}
              </p>
            ) : (
              <>
                <div className="bd-order-list">
                  {visibleOrders.map((order) => {
                    const isSelected =
                      selected &&
                      sameId(selected.id, order.id);

                    return (
                      <article
                        className={`bd-order-tile ${
                          isSelected
                            ? "is-selected"
                            : ""
                        }`}
                        key={order.id}
                      >
                        <div className="bd-order-image">
                          <CropPhoto
                            name={
                              order.items?.[0]
                                ?.variety_name
                            }
                          />
                        </div>

                        <div className="bd-order-description">
                          <span className="bd-order-number">
                            {t("Order")} #{order.id}
                          </span>

                          <h3>
                            {order.items?.[0]
                              ?.variety_name ||
                              t("Millet")}
                          </h3>

                          <div className="bd-order-items">
                            {(order.items || []).map(
                              (item) => (
                                <p
                                  key={
                                    item.id ||
                                    item.stock_id
                                  }
                                >
                                  {item.variety_name}
                                  {" · "}
                                  {item.quantity_kg} kg
                                </p>
                              ),
                            )}
                          </div>

                          <p className="bd-order-date">
                            {t("Ordered on")}{" "}
                            {formatOrderDate(
                              order.created_at,
                              lang,
                            )}
                          </p>
                        </div>

                        <div className="bd-order-price">
                          <span>
                            {t("Product total")}
                          </span>

                          <strong>
                            {money(order.total_amount)}
                          </strong>
                        </div>

                        <div className="bd-order-status-area">
                          <span
                            className={`bd-badge bd-${order.status}`}
                          >
                            {statusLabel(order.status)}
                          </span>

                          {button(
                            isSelected
                              ? "Hide Details"
                              : "View Details",
                            () =>
                              setSelected(
                                isSelected
                                  ? null
                                  : order,
                              ),
                          )}

                          {order.status === "pending" &&
                            button(
                              "Cancel Order",
                              () =>
                                cancelOrder(order),
                              false,
                              true,
                            )}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {!visibleOrders.length && (
                  <div className="bd-empty">
                    <p>
                      {t(
                        "No orders found in this page.",
                      )}
                    </p>

                    {button(
                      "Continue shopping",
                      () => go("shop"),
                    )}
                  </div>
                )}

                {selected &&
                  visibleOrders.some((order) =>
                    sameId(
                      order.id,
                      selected.id,
                    ),
                  ) && (
                    <div className="bd-expanded-order">
                      <div className="bd-expanded-heading">
                        <h3>{t("Order details")}</h3>

                        {button(
                          "Close",
                          () => setSelected(null),
                          false,
                          true,
                        )}
                      </div>

                      {orderDetails(selected)}
                    </div>
                  )}
              </>
            )}

            <div className="bd-orders-pagination">
              {button(
                "Previous",
                () => {
                  setSelected(null);

                  setOffset((value) =>
                    Math.max(0, value - 20),
                  );
                },
                offset === 0 || ordersLoading,
                true,
              )}

              <span>
                {t("Page")}{" "}
                {Math.floor(offset / 20) + 1}
              </span>

              {button(
                "Next",
                () => {
                  setSelected(null);

                  setOffset(
                    (value) => value + 20,
                  );
                },
                orders.length < 20 ||
                  ordersLoading ||
                  Boolean(ordersError),
                true,
              )}
            </div>

            <p className="bd-orders-filter-note">
              {t(
                "The filter applies to orders on the current page.",
              )}
            </p>
          </section>
        )}
      </main>

      {/* FOOTER */}

      <footer className="bd-footer">
        <div className="bd-wrap">
          <div className="bd-footer-top">
            <div className="bd-footer-brand">
              <Link
                to="/"
                aria-label="Millet Plus Home"
              >
                <img
                  className="bd-footer-logo"
                  src="/images/logo.png"
                  alt="Millet Plus"
                />
              </Link>

              <p>
                {t(
                  "Helping millet farmers and buyers connect through better choices.",
                )}
              </p>

              <strong>
                {t(
                  "Better crops. Stronger communities.",
                )}
              </strong>
            </div>

            <div className="bd-footer-explore">
              <h3>{t("Explore Millet Plus")}</h3>

              <div className="bd-footer-links">
                <Link to="/">{t("Home")}</Link>

                <span aria-hidden="true">|</span>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => go("shop")}
                >
                  {t("Shop millet")}
                </button>

                <span aria-hidden="true">|</span>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => go("cart")}
                >
                  {t("Your Cart")}
                </button>

                <span aria-hidden="true">|</span>

                <button
                  type="button"
                  disabled={busy}
                  onClick={openOrders}
                >
                  {t("My Orders")}
                </button>
              </div>

              <div className="bd-footer-language">
                <span>{t("Languages")}:</span>

                <button
                  type="button"
                  aria-pressed={lang === "en"}
                  onClick={() => setLang("en")}
                >
                  English
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
            </div>
          </div>

          <div className="bd-footer-bottom">
            <span>
              © {new Date().getFullYear()} Millet Plus
            </span>

            <span>
              {t(
                "Growing together, season after season.",
              )}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}