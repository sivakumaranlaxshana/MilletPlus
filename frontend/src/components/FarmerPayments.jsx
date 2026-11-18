import React, { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function FarmerPayments({
  userId,
  lang = "en",
  t = (value) => value,
}) {
  const [revision, setRevision] = useState(0);

  const [state, setState] = useState({
    rows: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    const controller = new AbortController();

    setState({
      rows: [],
      loading: true,
      error: "",
    });

    async function load() {
      const rows = [];
      const seen = new Set();

      for (let offset = 0; offset < 10000; offset += 100) {
        const batch = await apiRequest(
          `/farmer/payments?limit=100&offset=${offset}`,
          { signal: controller.signal },
        );

        if (!Array.isArray(batch)) {
          throw new Error(
            "Payment response format is not supported. Please check the farmer payments API.",
          );
        }

        for (const row of batch) {
          if (!row || row.id == null) {
            throw new Error("Payment record ID is missing.");
          }

          if (seen.has(String(row.id))) {
            throw new Error(
              "Payment pagination repeated records. Please check the API.",
            );
          }

          seen.add(String(row.id));
          rows.push(row);
        }

        if (batch.length < 100) {
          if (!controller.signal.aborted) {
            setState({
              rows,
              loading: false,
              error: "",
            });
          }

          return;
        }
      }

      throw new Error(
        "Too many payment records. Please contact support.",
      );
    }

    load().catch((error) => {
      if (controller.signal.aborted) return;

      setState({
        rows: [],
        loading: false,
        error:
          error.status === 404
            ? "Farmer payments endpoint was not found. Please check the backend route."
            : error.message || "Could not load payments.",
      });
    });

    return () => controller.abort();
  }, [userId, revision]);

  function money(value, currency = "LKR") {
    if (
      value == null ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return `${currency} ${Number(value).toLocaleString(
      lang === "ta" ? "ta-LK" : "en-LK",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`;
  }

  function date(value) {
    if (!value) return "—";

    const parsed = new Date(value);

    if (!Number.isFinite(parsed.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat(
      lang === "ta" ? "ta-LK" : "en-GB",
      {
        dateStyle: "medium",
        timeZone: "Asia/Colombo",
      },
    ).format(parsed);
  }

  return (
    <section
      className="fd-payments"
      aria-labelledby="fd-payment-title"
    >
      <div className="fd-section-heading">
        <h3 id="fd-payment-title">
          {t("Payment details")}
        </h3>

        <button
          type="button"
          className="fd-button fd-outline fd-small"
          disabled={state.loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          {t("Refresh")}
        </button>
      </div>

      <p className="fd-payment-scope">
        {t(
          "All payment records for your farmer account. These records are not filtered to this crop.",
        )}
      </p>

      {state.loading ? (
        <p role="status">{t("Loading payments…")}</p>
      ) : state.error ? (
        <p className="fd-alert fd-error" role="alert">
          {t(state.error)}
        </p>
      ) : !state.rows.length ? (
        <div className="fd-empty">
          <p>{t("No payment records yet.")}</p>
        </div>
      ) : (
        <div className="fd-table-scroll">
          <table className="fd-table">
            <thead>
              <tr>
                {[
                  "Reference",
                  "Date",
                  "Purchase amount",
                  "Payment amount",
                  "Paid amount",
                  "Balance",
                  "Status",
                ].map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.receipt_number ||
                      `#${row.purchase_id ?? row.id}`}
                  </td>

                  <td>
                    {date(row.paid_at ?? row.purchase_date)}
                  </td>

                  <td>
                    {money(row.total_amount, row.currency)}
                  </td>

                  <td>
                    {money(row.amount, row.currency)}
                  </td>

                  <td>
                    {money(row.paid_amount, row.currency)}
                  </td>

                  <td>
                    {money(row.balance_amount, row.currency)}
                  </td>

                  <td>
                    {row.payment_status || row.status
                      ? t(row.payment_status || row.status)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}