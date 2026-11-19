import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import { apiRequest } from "../api";
import { tamilText } from "../translations";

const translate = (lang) => (text) =>
  lang === "ta" ? tamilText(text) : text;

function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

function sriLankaTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type).value;

  return (
    `${get("year")}-${get("month")}-${get("day")}` +
    `T${get("hour")}:${get("minute")}`
  );
}

function cents(value) {
  const text = String(value ?? "");

  if (!/^\d{1,24}(\.\d{1,2})?$/.test(text)) {
    throw new Error(
      "Enter a valid amount with up to two decimal places.",
    );
  }

  const [whole, fraction = ""] = text.split(".");

  return (
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0"))
  );
}

function Input({ title, t, ...props }) {
  return (
    <label>
      {t(title)}
      <input {...props} />
    </label>
  );
}

/*
 * Purchase/payment requests keep their exact payload
 * after a timeout or network failure.
 */
function useRecordPost(
  storageKey,
  endpoint,
  onSaved,
) {
  const [pending, setPending] = useState(() =>
    readSaved(storageKey),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lock = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  async function send(buildPayload) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError("");

    let sent = false;

    try {
      const payload =
        pending || {
          ...buildPayload(),
          request_key: crypto.randomUUID(),
        };

      if (!pending) {
        localStorage.setItem(
          storageKey,
          JSON.stringify(payload),
        );

        setPending(payload);
      }

      sent = true;

      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!result?.id) {
        throw new Error(
          "The result is incomplete. Retry the same request.",
        );
      }

      localStorage.removeItem(storageKey);

      if (alive.current) {
        setPending(null);
        onSaved?.();
      }
    } catch (err) {
      const rejected =
        sent &&
        err.status >= 400 &&
        err.status < 500 &&
        ![408, 429].includes(err.status);

      if (rejected) {
        localStorage.removeItem(storageKey);

        if (alive.current) {
          setPending(null);
        }
      }

      if (alive.current) {
        setError(
          err.message || "Could not save the record.",
        );
      }
    } finally {
      lock.current = false;

      if (alive.current) {
        setBusy(false);
      }
    }
  }

  return {
    pending,
    busy,
    error,
    send,
  };
}

/* ADD USER AND EDIT USER */

export function AdminUserActions({
  selected,
  lang = "en",
  onSaved,
}) {
  const t = translate(lang);

  const [mode, setMode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lock = useRef(false);

  useEffect(() => {
    setMode("");
    setError("");
  }, [selected?.id]);

  async function save(event) {
    event.preventDefault();

    if (lock.current) return;

    const data = formValues(event.currentTarget);
    const editing = mode === "edit";
    const id = selected?.id;

    if (
      editing &&
      (!id || selected.role === "admin")
    ) {
      return;
    }

    let payload = {
      name: data.name.trim(),
    };

    if (editing) {
      const email = data.email.trim().toLowerCase();

      if (
        email &&
        email !==
          String(selected.email || "").toLowerCase()
      ) {
        payload.email = email;
      }
    } else {
      payload = {
        ...payload,
        phone: data.phone.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
        role: data.role,
      };
    }

    lock.current = true;
    setBusy(true);
    setError("");

    try {
      await apiRequest(
        editing
          ? `/admin/users/${id}`
          : "/admin/users",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );

      setMode("");
      onSaved?.();
    } catch (err) {
      setError(
        err.message ||
          t(
            "Could not save the user. Check the user list before retrying.",
          ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ad-panel ax-panel">
      <div className="ad-page-heading">
        <h2>{t("User actions")}</h2>

        <div className="ax-buttons">
          <button
            type="button"
            className="ad-btn"
            disabled={busy}
            onClick={() => {
              setMode("create");
              setError("");
            }}
          >
            {t("Add user")}
          </button>

          {selected &&
            selected.role !== "admin" && (
              <button
                type="button"
                className="ad-btn ad-outline"
                disabled={busy}
                onClick={() => {
                  setMode("edit");
                  setError("");
                }}
              >
                {t("Edit user")}
              </button>
            )}
        </div>
      </div>

      {error && (
        <p className="ad-alert ad-error" role="alert">
          {error}
        </p>
      )}

      {mode && (
        <form
          key={`${mode}-${selected?.id || "new"}`}
          className="ad-action-form"
          onSubmit={save}
        >
          <h3>
            {t(
              mode === "edit"
                ? "Edit user"
                : "Add user",
            )}
          </h3>

          <fieldset
            className="ax-fields"
            disabled={busy}
          >
            <Input
              title="Name"
              t={t}
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={
                mode === "edit" ? selected.name : ""
              }
            />

            <Input
              title="Email"
              t={t}
              name="email"
              type="email"
              maxLength={254}
              required={
                mode === "create" ||
                Boolean(selected?.email)
              }
              defaultValue={
                mode === "edit"
                  ? selected.email || ""
                  : ""
              }
            />

            {mode === "create" && (
              <>
                <Input
                  title="Phone"
                  t={t}
                  name="phone"
                  type="tel"
                  required
                  maxLength={15}
                  autoComplete="off"
                />

                <Input
                  title="Password"
                  t={t}
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />

                <label>
                  {t("Role")}

                  <select name="role">
                    <option value="farmer">
                      {t("Farmer")}
                    </option>

                    <option value="buyer">
                      {t("Buyer")}
                    </option>
                  </select>
                </label>
              </>
            )}
          </fieldset>

          <div className="ax-buttons">
            <button
              className="ad-btn"
              type="submit"
              disabled={busy}
            >
              {t(busy ? "Saving…" : "Save user")}
            </button>

            <button
              className="ad-btn ad-outline"
              type="button"
              disabled={busy}
              onClick={() => setMode("")}
            >
              {t("Close")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* CREATE FARMER PURCHASE */

function PurchaseForm({
  adminId,
  lang,
  onSaved,
}) {
  const t = translate(lang);

  const form = useRecordPost(
    `millet_admin_purchase_${adminId}`,
    "/admin/farmer-purchases",
    onSaved,
  );

  const [stocks, setStocks] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [stockId, setStockId] = useState(
    String(form.pending?.stock_id || ""),
  );

  const [date, setDate] = useState(
    form.pending?.purchase_date || "",
  );

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setLoadError("");

    apiRequest(
      `/admin/stocks?limit=100&offset=${offset}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error("Invalid stock response.");
        }

        if (!controller.signal.aborted) {
          setStocks(data);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoadError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [offset]);

  const chosen = stocks.find(
    (stock) => String(stock.id) === stockId,
  );

  function submit(event) {
    event.preventDefault();

    const data = formValues(event.currentTarget);

    form.send(() => {
      if (
        !chosen ||
        !Number.isSafeInteger(Number(stockId))
      ) {
        throw new Error("Choose received stock.");
      }

      if (
        !/^\d{1,10}(\.\d{1,2})?$/.test(
          data.unit_price,
        ) ||
        cents(data.unit_price) <= 0n
      ) {
        throw new Error(
          "Enter a positive purchase price.",
        );
      }

      if (
        !date ||
        date > chosen.received_date ||
        date > sriLankaTime().slice(0, 10)
      ) {
        throw new Error(
          "Purchase date must not be after stock receipt or today.",
        );
      }

      return {
        stock_id: Number(stockId),
        purchase_date: date,
        unit_price: data.unit_price,
        note: data.note.trim() || null,
      };
    });
  }

  return (
    <form
      className="ad-action-form"
      onSubmit={submit}
    >
      <h3>{t("New farmer purchase")}</h3>

      {loadError && (
        <p className="ad-alert ad-error" role="alert">
          {loadError}
        </p>
      )}

      {form.error && (
        <p className="ad-alert ad-error" role="alert">
          {t(form.error)}
        </p>
      )}

      {form.pending && (
        <p className="ad-report-note">
          {t(
            "A saved request is awaiting confirmation. Retry uses exactly the same details.",
          )}
        </p>
      )}

      <fieldset
        className="ax-fields"
        disabled={form.busy || Boolean(form.pending)}
      >
        <label>
          {t("Received stock")}

          <select
            required
            value={stockId}
            disabled={loading}
            onChange={(event) => {
              const id = event.target.value;

              setStockId(id);

              setDate(
                stocks.find(
                  (stock) => String(stock.id) === id,
                )?.received_date || "",
              );
            }}
          >
            <option value="">
              {t(
                loading
                  ? "Loading…"
                  : "Choose received stock",
              )}
            </option>

            {form.pending && !chosen && (
              <option value={stockId}>
                #{stockId}
              </option>
            )}

            {stocks.map((stock) => (
              <option
                key={stock.id}
                value={stock.id}
              >
                #{stock.id} · {stock.farmer_name}
                {" · "}
                {stock.variety_name}
                {" · "}
                {stock.received_quantity_kg} kg
              </option>
            ))}
          </select>
        </label>

        <Input
          title="Purchase date"
          t={t}
          type="date"
          required
          value={date}
          max={
            chosen?.received_date ||
            sriLankaTime().slice(0, 10)
          }
          onChange={(event) =>
            setDate(event.target.value)
          }
        />

        <Input
          title="Purchase price per kg (LKR)"
          t={t}
          name="unit_price"
          type="number"
          step="0.01"
          min="0.01"
          max="9999999999.99"
          required
          defaultValue={
            form.pending?.unit_price || ""
          }
        />

        <label>
          {t("Note")}

          <textarea
            name="note"
            rows={2}
            maxLength={1000}
            defaultValue={form.pending?.note || ""}
          />
        </label>
      </fieldset>

      <p className="ad-muted">
        {t(
          "The backend calculates the purchase total from the received quantity. Only one purchase is allowed per stock batch.",
        )}
      </p>

      <div className="ax-buttons">
        <button
          className="ad-btn ad-outline"
          type="button"
          disabled={
            form.busy ||
            Boolean(form.pending) ||
            loading ||
            offset === 0
          }
          onClick={() => {
            setOffset((value) =>
              Math.max(0, value - 100),
            );
            setStockId("");
          }}
        >
          {t("Previous stock")}
        </button>

        <button
          className="ad-btn ad-outline"
          type="button"
          disabled={
            form.busy ||
            Boolean(form.pending) ||
            loading ||
            stocks.length < 100
          }
          onClick={() => {
            setOffset((value) => value + 100);
            setStockId("");
          }}
        >
          {t("Next stock")}
        </button>

        <button
          className="ad-btn"
          type="submit"
          disabled={
            form.busy ||
            (!form.pending &&
              (loading || Boolean(loadError)))
          }
        >
          {t(
            form.busy
              ? "Saving…"
              : form.pending
                ? "Retry saved request"
                : "Save purchase",
          )}
        </button>
      </div>
    </form>
  );
}

/* RECORD CASH ALREADY PAID TO A FARMER */

function CashForm({
  purchase,
  adminId,
  lang,
  onSaved,
}) {
  const t = translate(lang);

  const form = useRecordPost(
    `millet_admin_cash_${adminId}_${purchase.id}`,
    `/admin/farmer-purchases/${purchase.id}/payments`,
    onSaved,
  );

  const defaultTime = form.pending?.paid_at
    ? sriLankaTime(new Date(form.pending.paid_at))
    : sriLankaTime();

  function submit(event) {
    event.preventDefault();

    const data = formValues(event.currentTarget);

    form.send(() => {
      const amount = cents(data.amount);

      if (
        amount <= 0n ||
        amount > cents(purchase.balance_amount)
      ) {
        throw new Error(
          "Payment must be positive and must not exceed the balance.",
        );
      }

      const receipt = data.receipt_number
        .trim()
        .toUpperCase();

      if (
        !/^[A-Z0-9][A-Z0-9/-]{2,49}$/.test(
          receipt,
        )
      ) {
        throw new Error(
          "Enter a valid receipt number using letters, digits, / or -.",
        );
      }

      const paidAt =
        `${data.paid_at}:00+05:30`;

      if (
        !Number.isFinite(Date.parse(paidAt)) ||
        Date.parse(paidAt) > Date.now() ||
        data.paid_at.slice(0, 10) <
          purchase.purchase_date
      ) {
        throw new Error(
          "Choose a payment time between the purchase date and now.",
        );
      }

      return {
        receipt_number: receipt,
        amount: data.amount,
        paid_at: paidAt,
        note: data.note.trim() || null,
      };
    });
  }

  return (
    <form
      className="ad-action-form"
      onSubmit={submit}
    >
      <h3>
        {t("Record cash payment")} · #{purchase.id}
      </h3>

      <p>
        {purchase.farmer_name}
        {" · "}
        {t("Balance")}: LKR {purchase.balance_amount}
      </p>

      <p className="ad-report-note">
        {t(
          "Record money already paid to the farmer. This form does not transfer money. Times use Sri Lanka time.",
        )}
      </p>

      {form.pending && (
        <p className="ad-report-note">
          {t(
            "A saved request is awaiting confirmation. Retry uses exactly the same details.",
          )}
        </p>
      )}

      {form.error && (
        <p className="ad-alert ad-error" role="alert">
          {t(form.error)}
        </p>
      )}

      <fieldset
        className="ax-fields"
        disabled={form.busy || Boolean(form.pending)}
      >
        <Input
          title="Receipt number"
          t={t}
          name="receipt_number"
          required
          minLength={3}
          maxLength={50}
          defaultValue={
            form.pending?.receipt_number || ""
          }
        />

        <Input
          title="Amount (LKR)"
          t={t}
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          max={purchase.balance_amount}
          required
          defaultValue={form.pending?.amount || ""}
        />

        <Input
          title="Paid at (Sri Lanka time)"
          t={t}
          name="paid_at"
          type="datetime-local"
          required
          min={`${purchase.purchase_date}T00:00`}
          max={sriLankaTime()}
          defaultValue={defaultTime}
        />

        <label>
          {t("Note")}

          <textarea
            name="note"
            rows={2}
            maxLength={1000}
            defaultValue={form.pending?.note || ""}
          />
        </label>
      </fieldset>

      <button
        className="ad-btn"
        type="submit"
        disabled={form.busy}
      >
        {t(
          form.busy
            ? "Saving…"
            : form.pending
              ? "Retry saved request"
              : "Record cash payment",
        )}
      </button>
    </form>
  );
}

export function AdminPurchaseActions({
  selected,
  adminId,
  lang = "en",
  onSaved,
}) {
  const t = translate(lang);

  const [open, setOpen] = useState(() =>
    Boolean(
      readSaved(
        `millet_admin_purchase_${adminId}`,
      ),
    ),
  );

  return (
    <section className="ad-panel ax-panel">
      <div className="ad-page-heading">
        <h2>{t("Farmer purchase actions")}</h2>

        <button
          type="button"
          className="ad-btn"
          onClick={() =>
            setOpen((value) => !value)
          }
        >
          {t(
            open
              ? "Close purchase form"
              : "New purchase",
          )}
        </button>
      </div>

      {open && (
        <PurchaseForm
          adminId={adminId}
          lang={lang}
          onSaved={() => {
            setOpen(false);
            onSaved?.();
          }}
        />
      )}

      {selected &&
        Number(selected.balance_amount) > 0 && (
          <CashForm
            key={selected.id}
            purchase={selected}
            adminId={adminId}
            lang={lang}
            onSaved={onSaved}
          />
        )}

      {!selected && (
        <p className="ad-muted">
          {t(
            "Select View on a purchase to record its cash payment.",
          )}
        </p>
      )}
    </section>
  );
}