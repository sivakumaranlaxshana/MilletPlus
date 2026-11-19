import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import { useLocation } from "react-router-dom";
import { apiRequest } from "../api";
import { tamilText } from "../translations";

const CHECKOUT_URL =
  "https://sandbox.payhere.lk/pay/checkout";

async function paymentHistory(orderId, signal) {
  const records = [];

  for (let offset = 0; offset < 1000; offset += 100) {
    const data = await apiRequest(
      `/orders/${orderId}/payments?limit=100&offset=${offset}`,
      { signal },
    );

    if (!Array.isArray(data)) {
      throw new Error("Invalid payment history response.");
    }

    records.push(...data);

    if (data.length < 100) {
      return records;
    }
  }

  throw new Error(
    "Too many payment records. Please contact admin.",
  );
}

export default function BuyerOrderPayment({
  order,
  user,
  lang = "en",
  readOnly = false,
}) {
  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const orderId = String(order?.id ?? "");
  const validId = /^[1-9]\d*$/.test(orderId);

  const [revision, setRevision] = useState(0);

  const [state, setState] = useState({
    orderId: "",
    records: [],
    loading: true,
    error: "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const working = useRef(false);
  const mounted = useRef(false);
  const currentOrderId = useRef(orderId);

  currentOrderId.current = orderId;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!validId) return;

    const controller = new AbortController();

    setState({
      orderId,
      records: [],
      loading: true,
      error: "",
    });

    paymentHistory(orderId, controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;

        setState({
          orderId,
          records,
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        setState({
          orderId,
          records: [],
          loading: false,
          error: err.message,
        });
      });

    return () => controller.abort();
  }, [orderId, validId, revision]);

  if (!validId) return null;

  const loading =
    state.orderId !== orderId || state.loading;

  const records =
    state.orderId === orderId ? state.records : [];

  const paid = records.find(
    (payment) => payment.status === "paid",
  );

  const blocked = records.some(
    (payment) =>
      payment.requires_review ||
      payment.status === "refunded",
  );

  const canPay =
    !readOnly &&
    order.status === "pending" &&
    !loading &&
    !state.error &&
    !paid &&
    !blocked;

  const names = String(
    order.recipient_name || user?.name || "",
  )
    .trim()
    .split(/\s+/);

  const latest = records[0];

  const status = paid
    ? "paid"
    : latest?.status || "unpaid";

  const labels = {
    paid: "Paid",
    pending: "Pending confirmation",
    unpaid: "Unpaid",
    failed: "Failed",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };

  function refresh() {
    setError("");
    setRevision((value) => value + 1);
  }

  async function pay(event) {
    event.preventDefault();

    if (working.current || !canPay) return;

    const formData = new FormData(event.currentTarget);

    const customer = Object.fromEntries(
      ["first_name", "last_name", "email", "city"].map(
        (key) => [
          key,
          String(formData.get(key) || "").trim(),
        ],
      ),
    );

    if (
      Object.values(customer).some((value) => !value)
    ) {
      setError(t("Complete all payment details."));
      return;
    }

    working.current = true;
    setBusy(true);
    setError("");

    const stillHere = () =>
      mounted.current &&
      currentOrderId.current === orderId;

    try {
      const fresh = await paymentHistory(orderId);

      if (!stillHere()) return;

      setState({
        orderId,
        records: fresh,
        loading: false,
        error: "",
      });

      if (
        fresh.some(
          (payment) => payment.status === "paid",
        )
      ) {
        return;
      }

      if (
        fresh.some(
          (payment) =>
            payment.requires_review ||
            payment.status === "refunded",
        )
      ) {
        throw new Error(
          "This order needs admin review before another payment.",
        );
      }

      let payment = fresh.find(
        (record) => record.status === "pending",
      );

      if (!payment) {
        const storageKey =
          `millet_order_payment_` +
          `${user?.id || "buyer"}_${orderId}`;

        let requestKey =
          localStorage.getItem(storageKey);

        if (!requestKey) {
          requestKey = crypto.randomUUID();

          localStorage.setItem(
            storageKey,
            requestKey,
          );
        }

        // Reuse the same key if a request times out.
        payment = await apiRequest(
          `/orders/${orderId}/payments`,
          {
            method: "POST",

            body: JSON.stringify({
              request_key: requestKey,
            }),
          },
        );

        if (!payment?.id) {
          throw new Error(
            "Payment response is incomplete. Refresh before retrying.",
          );
        }

        if (
          ["failed", "cancelled"].includes(
            payment.status,
          )
        ) {
          localStorage.removeItem(storageKey);

          throw new Error(
            "The earlier payment attempt is closed. Refresh and try again.",
          );
        }
      }

      if (!stillHere()) return;

      if (
        payment.status !== "pending" ||
        payment.provider !== "payhere"
      ) {
        throw new Error(
          "Payment is not eligible for PayHere checkout. Refresh its status.",
        );
      }

      const checkout = await apiRequest(
        `/orders/${orderId}/payments/${payment.id}/checkout`,
        {
          method: "POST",
          body: JSON.stringify(customer),
        },
      );

      if (!stillHere()) return;

      if (
        checkout?.sandbox !== true ||
        checkout.method !== "POST" ||
        checkout.action_url !== CHECKOUT_URL ||
        String(checkout.order_id) !== orderId ||
        String(checkout.payment_id) !==
          String(payment.id) ||
        !checkout.fields ||
        typeof checkout.fields !== "object" ||
        Array.isArray(checkout.fields)
      ) {
        throw new Error(
          "The backend did not return a valid PayHere Sandbox checkout.",
        );
      }

      const requiredFields = [
        "merchant_id",
        "order_id",
        "amount",
        "currency",
        "hash",
        "return_url",
        "cancel_url",
        "notify_url",
      ];

      for (const key of requiredFields) {
        if (
          typeof checkout.fields[key] !== "string" ||
          !checkout.fields[key]
        ) {
          throw new Error(
            "Checkout fields are incomplete.",
          );
        }
      }

      if (
        Object.values(checkout.fields).some(
          (value) => typeof value !== "string",
        )
      ) {
        throw new Error(
          "Invalid checkout field value.",
        );
      }

      const paymentForm =
        document.createElement("form");

      paymentForm.method = "POST";
      paymentForm.action = checkout.action_url;
      paymentForm.hidden = true;

      for (const [name, value] of Object.entries(
        checkout.fields,
      )) {
        const input =
          document.createElement("input");

        input.type = "hidden";
        input.name = name;
        input.value = value;

        paymentForm.appendChild(input);
      }

      document.body.appendChild(paymentForm);

      try {
        HTMLFormElement.prototype.submit.call(
          paymentForm,
        );
      } finally {
        paymentForm.remove();
      }
    } catch (err) {
      if (stillHere()) {
        setError(
          `${t(err.message)} ` +
            t(
              "Refresh payment status before retrying.",
            ),
        );

        setRevision((value) => value + 1);
      }
    } finally {
      working.current = false;

      if (stillHere()) {
        setBusy(false);
      }
    }
  }

  return (
    <section className="bop-payment">
      <div className="bop-heading">
        <div>
          <small>{t("PayHere Sandbox")}</small>

          <h3>
            {t("Order payment")} #{orderId}
          </h3>
        </div>

        <button
          type="button"
          className="bop-btn bop-outline"
          disabled={busy || loading}
          onClick={refresh}
        >
          {t("Refresh")}
        </button>
      </div>

      <p className="bop-note">
        {t("Test checkout only. No live payment.")}
      </p>

      {loading ? (
        <p role="status">
          {t("Checking payment…")}
        </p>
      ) : state.error ? (
        <p className="bop-error" role="alert">
          {t(state.error)}
        </p>
      ) : (
        <p className="bop-status">
          {t("Payment")}:

          <strong
            className={
              paid ? "bop-paid" : "bop-pending"
            }
          >
            {t(labels[status] || status)}
          </strong>
        </p>
      )}

      {paid && (
        <p className="bop-success" role="status">
          {t(
            "Payment confirmed by the backend. Order fulfilment is tracked separately.",
          )}
        </p>
      )}

      {blocked && (
        <p className="bop-error">
          {t(
            "Contact admin before attempting another payment.",
          )}
        </p>
      )}

      {error && (
        <p className="bop-error" role="alert">
          {error}
        </p>
      )}

      {canPay && (
        <form className="bop-form" onSubmit={pay}>
          <label>
            {t("First name")}

            <input
              name="first_name"
              autoComplete="given-name"
              required
              maxLength={100}
              defaultValue={names[0] || ""}
              disabled={busy}
            />
          </label>

          <label>
            {t("Last name")}

            <input
              name="last_name"
              autoComplete="family-name"
              required
              maxLength={100}
              defaultValue={names.slice(1).join(" ")}
              disabled={busy}
            />
          </label>

          <label>
            {t("Email")}

            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              defaultValue={user?.email || ""}
              disabled={busy}
            />
          </label>

          <label>
            {t("City")}

            <input
              name="city"
              autoComplete="address-level2"
              required
              maxLength={100}
              disabled={busy}
            />
          </label>

          <p className="bop-note bop-wide">
            {t(
              "Phone and delivery address are taken from your saved order. The backend sets the payment amount.",
            )}
          </p>

          <button
            type="submit"
            className="bop-btn bop-wide"
            disabled={busy}
          >
            {t(
              busy
                ? "Opening checkout…"
                : "Pay with PayHere →",
            )}
          </button>
        </form>
      )}
    </section>
  );
}

export function BuyerPaymentReturn({
  lang = "en",
}) {
  const location = useLocation();

  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const query = new URLSearchParams(
    location.search,
  );

  const orderId = query.get("order_id") || "";
  const result = query.get("payment");

  if (
    !/^[1-9]\d*$/.test(orderId) ||
    !["return", "cancel"].includes(result)
  ) {
    return null;
  }

  return (
    <div className="bop-return">
      <p>
        {t(
          "You have returned from checkout. The backend payment status is shown below. If it is still pending, press Refresh.",
        )}
      </p>

      <BuyerOrderPayment
        key={orderId}
        order={{ id: orderId }}
        lang={lang}
        readOnly
      />
    </div>
  );
}