import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { apiRequest } from "../api";
import { translate } from "../translations";

const PAGE_SIZE = 100;
const ZERO = BigInt(0);
const MAX_AMOUNT = BigInt("999999999999");

function scaled(value) {
  const text = String(value).trim();

  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(text)) {
    return null;
  }

  const negative = text.startsWith("-");

  const [whole, fraction = ""] = text
    .replace(/^-/, "")
    .split(".");

  const result =
    BigInt(whole) * BigInt(100) +
    BigInt(fraction.padEnd(2, "0"));

  return negative ? -result : result;
}

function decimal(value) {
  const negative = value < ZERO;
  const absolute = negative ? -value : value;

  const whole = absolute / BigInt(100);

  const fraction = String(
    absolute % BigInt(100),
  ).padStart(2, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function localDate() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(
    now.getMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    now.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

async function allRecords(path, signal) {
  const result = [];
  const seen = new Set();

  for (
    let offset = 0;
    ;
    offset += PAGE_SIZE
  ) {
    const separator = path.includes("?")
      ? "&"
      : "?";

    const batch = await apiRequest(
      `${path}${separator}offset=${offset}&limit=${PAGE_SIZE}`,
      { signal },
    );

    if (!Array.isArray(batch)) {
      throw new Error(
        "Unexpected stock response.",
      );
    }

    for (const row of batch) {
      if (seen.has(row.id)) {
        throw new Error(
          "The list changed while loading. Please refresh.",
        );
      }

      seen.add(row.id);
      result.push(row);
    }

    if (batch.length < PAGE_SIZE) {
      return result;
    }
  }
}

function StockDialog({
  title,
  busy,
  close,
  children,
  text,
}) {
  const ref = useRef(null);
  const headingId = React.useId();

  useEffect(() => {
    const dialog = ref.current;

    dialog.showModal();

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="mp-stock-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        if (busy) {
          event.preventDefault();
        } else {
          close();
        }
      }}
    >
      <div className="mp-stock-dialog-heading">
        <h2 id={headingId}>{title}</h2>

        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label={text("Close")}
        >
          ×
        </button>
      </div>

      {children}
    </dialog>
  );
}

export default function AdminStock({
  lang = "en",
  compact = false,
  onOpen,
}) {
  const text = (value) =>
    translate(value, lang);

  const [stocks, setStocks] = useState([]);
  const [harvests, setHarvests] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const [history, setHistory] = useState(null);

  const [
    historyError,
    setHistoryError,
  ] = useState("");

  const [
    historyLoading,
    setHistoryLoading,
  ] = useState(false);

  const request = useRef(null);
  const historyRequest = useRef(null);
  const mutation = useRef(false);

  const refresh = useCallback(async () => {
    request.current?.abort();

    const controller = new AbortController();

    request.current = controller;

    setLoading(true);
    setError("");

    try {
      const [items, approved] =
        await Promise.all([
          allRecords(
            "/admin/stocks",
            controller.signal,
          ),

          compact
            ? Promise.resolve([])
            : allRecords(
                "/admin/harvests?review_status=approved",
                controller.signal,
              ),
        ]);

      if (controller.signal.aborted) {
        return;
      }

      setStocks(items);
      setHarvests(approved);
      setPage(0);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err.message ||
            "Could not load stock.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [compact]);

  useEffect(() => {
    refresh();

    return () => {
      request.current?.abort();
      historyRequest.current?.abort();
    };
  }, [refresh]);

  const receivedIds = new Set(
    stocks.map((item) => item.harvest_id),
  );

  const eligible = harvests.filter(
    (item) =>
      item.status === "approved" &&
      !receivedIds.has(item.id),
  );

  const selectedHarvest = eligible.find(
    (item) =>
      String(item.id) === editor?.harvestId,
  );

  const matches = stocks.filter((item) => {
    const value =
      `${item.variety_name} ` +
      `${item.farmer_name} ` +
      `${item.harvest_id}`;

    return value
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  const visible = compact
    ? stocks.slice(0, 5)
    : matches.slice(
        page * 10,
        page * 10 + 10,
      );

  const pageCount = Math.max(
    1,
    Math.ceil(matches.length / 10),
  );

  const total = (key) =>
    decimal(
      stocks.reduce(
        (sum, item) =>
          sum + (scaled(item[key]) ?? ZERO),
        ZERO,
      ),
    );

  const display = (value) =>
    Number(value).toLocaleString(
      lang === "ta" ? "ta-LK" : "en-LK",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    );

  const title =
    editor?.kind === "receive"
      ? "Receive Stock"
      : editor?.kind === "settings"
        ? "Edit Price and Availability"
        : "Adjust Stock";

  function open(kind, stock = null) {
    setNotice("");
    setFormError("");

    setEditor({
      kind,
      stock,
      harvestId: "",

      amount:
        kind === "settings"
          ? stock.selling_price_per_kg ?? ""
          : "",

      active: stock?.is_active ?? false,
      date: localDate(),
      note: "",
    });
  }

  async function showHistory(stock) {
    historyRequest.current?.abort();

    const controller = new AbortController();

    historyRequest.current = controller;

    setHistory({
      stock,
      rows: [],
    });

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const rows = await allRecords(
        `/admin/stocks/${stock.id}/movements`,
        controller.signal,
      );

      if (!controller.signal.aborted) {
        setHistory({
          stock,
          rows,
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setHistoryError(
          err.message ||
            "Could not load history.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setHistoryLoading(false);
      }
    }
  }

  async function submit(event) {
    event.preventDefault();

    if (
      mutation.current ||
      editor.uncertain
    ) {
      return;
    }

    const amount = scaled(editor.amount);

    const invalid =
      amount === null ||
      amount > MAX_AMOUNT ||
      amount < -MAX_AMOUNT;

    if (
      invalid ||
      (
        editor.kind !== "adjustment" &&
        amount <= ZERO
      ) ||
      (
        editor.kind === "adjustment" &&
        amount === ZERO
      )
    ) {
      setFormError(
        "Enter a valid amount with up to two decimal places.",
      );

      return;
    }

    let path;
    let method;
    let payload;

    if (editor.kind === "receive") {
      if (!selectedHarvest) {
        setFormError(
          "Choose an approved harvest.",
        );

        return;
      }

      if (
        amount >
        scaled(
          selectedHarvest.total_quantity_kg,
        )
      ) {
        setFormError(
          "Received quantity cannot exceed the submitted harvest quantity.",
        );

        return;
      }

      if (
        !editor.date ||
        editor.date <
          selectedHarvest.harvest_date ||
        editor.date > localDate()
      ) {
        setFormError(
          "Choose a valid received date.",
        );

        return;
      }

      path = "/admin/stocks/receive";
      method = "POST";

      payload = {
        harvest_id: selectedHarvest.id,
        received_quantity_kg: decimal(amount),
        received_date: editor.date,
        note: editor.note.trim() || null,
      };
    } else if (
      editor.kind === "settings"
    ) {
      path =
        `/admin/stocks/${editor.stock.id}`;

      method = "PATCH";

      payload = {
        selling_price_per_kg:
          decimal(amount),

        is_active: editor.active,
      };
    } else {
      const balance =
        scaled(
          editor.stock.quantity_on_hand,
        ) + amount;

      if (
        balance <
          scaled(
            editor.stock.reserved_quantity,
          ) ||
        balance > MAX_AMOUNT
      ) {
        setFormError(
          "Adjustment would reduce stock below the reserved quantity or exceed the maximum.",
        );

        return;
      }

      if (
        editor.note.trim().length < 3
      ) {
        setFormError(
          "Provide a reason of at least three characters.",
        );

        return;
      }

      path =
        `/admin/stocks/${editor.stock.id}` +
        "/adjustments";

      method = "POST";

      payload = {
        quantity_change: decimal(amount),
        reason: editor.note.trim(),
      };
    }

    mutation.current = true;

    setBusy(true);
    setFormError("");

    try {
      await apiRequest(path, {
        method,
        body: JSON.stringify(payload),
      });

      setEditor(null);

      setNotice(
        "Stock saved successfully.",
      );

      setHistory(null);

      await refresh();
    } catch (err) {
      setFormError(
        err.message ||
          "Could not save stock.",
      );

      if (
        !err.status ||
        err.status >= 500
      ) {
        setFormError(
          "The save result is uncertain. Close this form, refresh stock and check history before submitting again.",
        );

        setEditor((value) =>
          value
            ? {
                ...value,
                uncertain: true,
              }
            : value,
        );
      }
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className={
        `mp-stock panel ` +
        (compact ? "mp-stock-compact" : "")
      }
      aria-label={text("Stock Management")}
    >
      <div className="mp-stock-heading">
        <div>
          <p className="mp-stock-eyebrow">
            MILLET PULSE
          </p>

          <h2>
            {text(
              compact
                ? "Recent Stock Received"
                : "Stock Management",
            )}
          </h2>

          {!compact && (
            <p>
              {text(
                "Receive approved harvests and manage actual inventory.",
              )}
            </p>
          )}
        </div>

        <div className="mp-stock-actions">
          {compact ? (
            <button
              type="button"
              className="mp-stock-outline"
              onClick={onOpen}
            >
              {text("View all")} →
            </button>
          ) : (
            <>
              <button
                type="button"
                className="mp-stock-outline"
                onClick={refresh}
                disabled={loading || busy}
              >
                {text("Refresh")}
              </button>

              <button
                type="button"
                className="mp-stock-primary"
                onClick={() =>
                  open("receive")
                }
                disabled={
                  loading ||
                  busy ||
                  !!error ||
                  !eligible.length
                }
              >
                + {text("Receive Stock")}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p
          className="mp-stock-error"
          role="alert"
        >
          {text(error)}{" "}

          <button
            type="button"
            onClick={refresh}
          >
            {text("Retry")}
          </button>
        </p>
      )}

      {notice && (
        <p
          className="mp-stock-success"
          role="status"
        >
          {text(notice)}
        </p>
      )}

      {!compact && (
        <>
          <div className="mp-stock-summary">
            {[
              [
                "On hand",
                "quantity_on_hand",
              ],
              [
                "Reserved",
                "reserved_quantity",
              ],
              [
                "Available",
                "available_quantity",
              ],
            ].map(([label, key]) => (
              <article key={key}>
                <span>{text(label)}</span>

                <strong>
                  {loading && !stocks.length
                    ? "—"
                    : `${display(total(key))} kg`}
                </strong>
              </article>
            ))}
          </div>

          <p className="mp-stock-note">
            {text(
              "Available = on hand minus reserved. Inactive batches cannot be sold.",
            )}
          </p>

          {!loading &&
            !error &&
            !eligible.length && (
              <p className="mp-stock-note">
                {text(
                  "No approved harvests are waiting to be received.",
                )}
              </p>
            )}

          <label className="mp-stock-search">
            {text("Search stock")}

            <input
              type="search"
              value={search}
              placeholder={text(
                "Millet, farmer or harvest ID",
              )}
              onChange={(event) => {
                setSearch(
                  event.target.value,
                );

                setPage(0);
              }}
            />
          </label>
        </>
      )}

      {loading && (
        <p role="status">
          {text("Loading stock…")}
        </p>
      )}

      <div className="mp-stock-table-scroll">
        <table>
          <thead>
            <tr>
              {(
                compact
                  ? [
                      "Millet",
                      "On hand",
                      "Received date",
                      "Farmer",
                    ]
                  : [
                      "Millet / Harvest",
                      "On hand",
                      "Reserved",
                      "Available",
                      "Price / kg",
                      "Status",
                      "Actions",
                    ]
              ).map((label) => (
                <th
                  key={label}
                  scope="col"
                >
                  {text(label)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {!loading &&
              !error &&
              !visible.length && (
                <tr>
                  <td
                    colSpan={
                      compact ? 4 : 7
                    }
                  >
                    {text(
                      stocks.length
                        ? "No matching stock."
                        : "No stock received yet.",
                    )}
                  </td>
                </tr>
              )}

            {visible.map((stock) => (
              <tr key={stock.id}>
                <td>
                  <strong>
                    {stock.variety_name}
                  </strong>

                  {!compact && (
                    <small>
                      #{stock.harvest_id}
                      {" · "}
                      {stock.farmer_name}
                    </small>
                  )}
                </td>

                <td>
                  {display(
                    stock.quantity_on_hand,
                  )}{" "}
                  kg
                </td>

                {compact ? (
                  <>
                    <td>
                      {stock.received_date}
                    </td>

                    <td>
                      {stock.farmer_name}
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      {display(
                        stock.reserved_quantity,
                      )}{" "}
                      kg
                    </td>

                    <td>
                      {display(
                        stock.available_quantity,
                      )}{" "}
                      kg
                    </td>

                    <td>
                      {stock.selling_price_per_kg ===
                      null
                        ? "—"
                        : `LKR ${display(
                            stock.selling_price_per_kg,
                          )}`}
                    </td>

                    <td>
                      <span
                        className={
                          "mp-stock-badge " +
                          (
                            stock.is_active &&
                            Number(
                              stock.available_quantity,
                            ) > 0
                              ? "active"
                              : ""
                          )
                        }
                      >
                        {text(
                          !stock.is_active
                            ? "Inactive"
                            : Number(
                                  stock.available_quantity,
                                ) <= 0
                              ? "Out of Stock"
                              : "Active",
                        )}
                      </span>
                    </td>

                    <td>
                      <div className="mp-stock-row-actions">
                        <button
                          type="button"
                          onClick={() =>
                            open(
                              "settings",
                              stock,
                            )
                          }
                          disabled={
                            loading ||
                            busy ||
                            !!error
                          }
                        >
                          {text("Edit price")}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            open(
                              "adjustment",
                              stock,
                            )
                          }
                          disabled={
                            loading ||
                            busy ||
                            !!error
                          }
                        >
                          {text("Adjust")}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            showHistory(stock)
                          }
                          disabled={busy}
                        >
                          {text("History")}
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!compact && (
        <nav
          className="mp-stock-pagination"
          aria-label={text("Stock pages")}
        >
          <button
            type="button"
            onClick={() =>
              setPage((value) =>
                Math.max(0, value - 1),
              )
            }
            disabled={page === 0}
          >
            {text("Previous")}
          </button>

          <span>
            {page + 1} / {pageCount}
          </span>

          <button
            type="button"
            onClick={() =>
              setPage(
                (value) => value + 1,
              )
            }
            disabled={
              page + 1 >= pageCount
            }
          >
            {text("Next")}
          </button>
        </nav>
      )}

      {editor && (
        <StockDialog
          title={text(title)}
          busy={busy}
          close={() => setEditor(null)}
          text={text}
        >
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {formError && (
                <p
                  className="mp-stock-error"
                  role="alert"
                >
                  {text(formError)}
                </p>
              )}

              {editor.kind === "receive" ? (
                <>
                  <label>
                    {text("Approved harvest")}

                    <select
                      required
                      value={editor.harvestId}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          harvestId:
                            event.target.value,
                        })
                      }
                    >
                      <option value="">
                        {text(
                          "Choose an approved harvest.",
                        )}
                      </option>

                      {eligible.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                        >
                          #{item.id}
                          {" · "}
                          {item.variety_name}
                          {" · "}
                          {item.farmer_name}
                          {" · "}
                          {item.total_quantity_kg}
                          {" kg"}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedHarvest && (
                    <p className="mp-stock-note">
                      {text("Harvest date")}
                      {": "}
                      {
                        selectedHarvest.harvest_date
                      }
                      {" · "}
                      {text(
                        "Submitted quantity",
                      )}
                      {": "}
                      {
                        selectedHarvest.total_quantity_kg
                      }
                      {" kg"}
                    </p>
                  )}

                  <label>
                    {text("Received date")}

                    <input
                      type="date"
                      required
                      min={
                        selectedHarvest?.harvest_date
                      }
                      max={localDate()}
                      value={editor.date}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          date:
                            event.target.value,
                        })
                      }
                    />
                  </label>

                  <p className="mp-stock-note">
                    {text(
                      "Record the actual quantity received. Each harvest can be received only once.",
                    )}
                  </p>
                </>
              ) : (
                <p>
                  <strong>
                    {
                      editor.stock.variety_name
                    }
                  </strong>

                  {" · "}
                  {text("On hand")}
                  {": "}

                  {display(
                    editor.stock.quantity_on_hand,
                  )}
                  {" kg"}
                </p>
              )}

              <label>
                {text(
                  editor.kind === "settings"
                    ? "Selling price (LKR / kg)"
                    : editor.kind === "receive"
                      ? "Actual received quantity (kg)"
                      : "Quantity change (kg)",
                )}

                <input
                  type="number"
                  required
                  step="0.01"
                  min={
                    editor.kind ===
                    "adjustment"
                      ? "-9999999999.99"
                      : "0.01"
                  }
                  max={
                    editor.kind ===
                      "receive" &&
                    selectedHarvest
                      ? selectedHarvest.total_quantity_kg
                      : "9999999999.99"
                  }
                  value={editor.amount}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      amount:
                        event.target.value,
                    })
                  }
                />
              </label>

              {editor.kind === "settings" ? (
                <label className="mp-stock-checkbox">
                  <input
                    type="checkbox"
                    checked={editor.active}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        active:
                          event.target.checked,
                      })
                    }
                  />

                  {text(
                    "Available for sale",
                  )}
                </label>
              ) : (
                <>
                  {editor.kind ===
                    "adjustment" && (
                    <p className="mp-stock-note">
                      {text(
                        "Use a negative amount to reduce stock and a positive amount to correct an increase.",
                      )}
                    </p>
                  )}

                  <label>
                    {text(
                      editor.kind ===
                        "adjustment"
                        ? "Reason"
                        : "Notes (optional)",
                    )}

                    <textarea
                      required={
                        editor.kind ===
                        "adjustment"
                      }
                      maxLength={2000}
                      value={editor.note}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          note:
                            event.target.value,
                        })
                      }
                    />
                  </label>
                </>
              )}

              <div className="mp-stock-actions">
                <button
                  type="button"
                  className="mp-stock-outline"
                  onClick={() =>
                    setEditor(null)
                  }
                >
                  {text("Cancel")}
                </button>

                <button
                  type="submit"
                  className="mp-stock-primary"
                  disabled={editor.uncertain}
                >
                  {text(
                    busy
                      ? "Saving…"
                      : "Save stock",
                  )}
                </button>
              </div>
            </fieldset>
          </form>
        </StockDialog>
      )}

      {history && (
        <StockDialog
          title={
            `${text("Stock History")} · ` +
            history.stock.variety_name
          }
          busy={false}
          close={() => {
            historyRequest.current?.abort();
            setHistory(null);
          }}
          text={text}
        >
          {historyLoading && (
            <p role="status">
              {text("Loading history…")}
            </p>
          )}

          {historyError && (
            <p
              className="mp-stock-error"
              role="alert"
            >
              {text(historyError)}{" "}

              <button
                type="button"
                onClick={() =>
                  showHistory(
                    history.stock,
                  )
                }
              >
                {text("Retry")}
              </button>
            </p>
          )}

          {!historyLoading &&
            !historyError &&
            !history.rows.length && (
              <p>
                {text("No history yet.")}
              </p>
            )}

          <ol className="mp-stock-history">
            {history.rows.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {text(
                      {
                        receipt: "Received",
                        adjustment:
                          "Adjustment",
                        settings:
                          "Settings changed",
                      }[
                        row.movement_type
                      ] ||
                        row.movement_type,
                    )}
                  </strong>

                  <span>
                    {row.quantity_change}
                    {" kg → "}
                    {row.quantity_after}
                    {" kg"}
                  </span>
                </div>

                <p>{row.note || "—"}</p>

                <small>
                  {text("Admin ID")}
                  {": "}
                  {row.performed_by}
                  {" · "}
                  {row.created_at.replace(
                    "T",
                    " ",
                  )}
                </small>
              </li>
            ))}
          </ol>

          <p className="mp-stock-note">
            {text(
              "History dates and times are shown as recorded by the server.",
            )}
          </p>
        </StockDialog>
      )}
    </section>
  );
}