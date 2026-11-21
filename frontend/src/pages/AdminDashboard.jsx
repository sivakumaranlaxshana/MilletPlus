import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest, dashboardPath } from "../api";
import { tamilText } from "../translations";
import { useSharedLanguage } from "../translations/language";
import AdminStock from "../components/AdminStock";
import OrdersPanel from "../components/OrdersPanel";
import {
  AdminUserActions,
  AdminPurchaseActions,
} from "../components/AdminActions";
import "./AdminDashboard.css";

const LIMIT = 20;

const MENU = [
  ["overview", "Overview", "home"],
  ["harvests", "Harvests", "leaf"],
  ["stock", "Stock", "stock"],
  ["orders", "Orders", "cart"],
  ["payments", "Payments", "card"],
  ["users", "Users", "users"],
  ["plans", "Plans", "layers"],
  ["reports", "Reports", "chart"],
];

const TITLES = {
  overview: "Overview",
  harvests: "Harvest verification",
  stock: "Stock management",
  orders: "Buyer orders",
  payments: "Payment records",
  users: "User management",
  plans: "Subscription plans",
  reports: "Monthly reports",
};

const REPORT_FIELDS = [
  ["buyer_collections", "Buyer collections"],
  ["subscription_collections", "Subscription collections"],
  ["total_cash_inflow", "Total cash inflow"],
  ["farmer_cash_outflow", "Farmer cash payments"],
  ["cash_difference", "Cash difference"],
  ["purchase_amount_this_month", "Farmer purchases"],
];

function Icon({ name, size = 21 }) {
  const paths = {
    home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
    leaf: "M20 4C9 3 3 9 5 16c7 3 15-2 15-12ZM4 21l11-11",
    stock:
      "m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7 5l9 5",
    cart: "M2 3h3l3 13h11l3-9H6M9 21h.01M18 21h.01",
    card: "M3 5h18v14H3zM3 10h18M7 15h4",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87",
    layers:
      "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
    chart: "M4 21V11M10 21V3M16 21v-7M22 21H2",
    logout: "M9 4H3v16h6M14 8l5 4-5 4M8 12h11",
    search:
      "M21 21l-5-5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z",
    arrow: "M4 12h16M14 6l6 6-6 6",
    refresh: "M20 7V3l-3 3a8 8 0 1 0 3 10M20 3h-5",
    close: "M6 6l12 12M18 6 6 18",
    check: "m5 12 4 4L19 6",
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
      <path d={paths[name] || paths.layers} />
    </svg>
  );
}

function numeric(value) {
  if (
    value == null ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  return Number(value).toLocaleString("en-LK", {
    maximumFractionDigits: 2,
  });
}

function money(value) {
  return value == null || value === ""
    ? "—"
    : `LKR ${numeric(value)}`;
}

function display(value, t) {
  if (value == null || value === "") return "—";

  if (typeof value === "boolean") {
    return t(value ? "Yes" : "No");
  }

  return typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}

const recordId = (row) => row?.id ?? row?.payment_id;

const label = (key) =>
  key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  return (
    parts.find((part) => part.type === "year").value +
    "-" +
    parts.find((part) => part.type === "month").value
  );
}

function monthQuery(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return null;
  }

  const [year, value] = month.split("-");

  return new URLSearchParams({
    year,
    month: String(Number(value)),
  }).toString();
}

function Badge({ value, t }) {
  const text =
    typeof value === "boolean"
      ? value
        ? "Active"
        : "Inactive"
      : String(value || "Unknown");

  const normalized = text.toLowerCase();

  const tone = [
    "active",
    "paid",
    "approved",
    "completed",
    "success",
  ].includes(normalized)
    ? "good"
    : [
          "inactive",
          "cancelled",
          "rejected",
          "failed",
          "refunded",
        ].includes(normalized)
      ? "bad"
      : "wait";

  return (
    <span className={`ad-badge ${tone}`}>
      {t(text)}
    </span>
  );
}

function useRemote(path, revision = 0) {
  const key = `${path || ""}:${revision}`;

  const [state, setState] = useState({
    key: "",
    loading: false,
    data: null,
    error: "",
  });

  useEffect(() => {
    if (!path) return;

    const controller = new AbortController();

    setState({
      key,
      loading: true,
      data: null,
      error: "",
    });

    apiRequest(path, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            data,
            loading: false,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            data: null,
            loading: false,
            error:
              error.message ||
              "Records could not be loaded.",
          });
        }
      });

    return () => controller.abort();
  }, [path, key]);

  if (!path) {
    return {
      loading: false,
      data: null,
      error: "",
    };
  }

  return state.key === key
    ? state
    : {
        loading: true,
        data: null,
        error: "",
      };
}

function Table({ rows, columns, onView, t }) {
  if (!rows.length) {
    return (
      <p className="ad-empty">
        {t("No records found.")}
      </p>
    );
  }

  return (
    <div className="ad-table-scroll">
      <table className="ad-table">
        <thead>
          <tr>
            {columns.map(([key, title]) => (
              <th key={key}>{t(title)}</th>
            ))}

            {onView && <th>{t("Action")}</th>}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={recordId(row) ?? index}>
              {columns.map(([key]) => (
                <td key={key}>
                  {key === "is_active" ||
                  key === "status" ||
                  key.endsWith("_status") ? (
                    <Badge value={row[key]} t={t} />
                  ) : /amount|balance|unit_price/.test(key) ? (
                    money(row[key])
                  ) : (
                    display(row[key], t)
                  )}
                </td>
              ))}

              {onView && (
                <td>
                  <button
                    type="button"
                    className="ad-btn"
                    onClick={() => onView(row)}
                  >
                    {t("View")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordDetails({ record, t }) {
  return (
    <dl className="ad-details-grid">
      {Object.entries(record)
        .filter(
          ([key]) =>
            !["details_path", "request_key"].includes(key),
        )
        .map(([key, value]) => (
          <div key={key}>
            <dt>{t(label(key))}</dt>
            <dd>{display(value, t)}</dd>
          </div>
        ))}
    </dl>
  );
}

function AdminCropVarieties({ lang = "en" }) {
  const say = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pageOffset, setPageOffset] = useState(0);
  const [listRevision, setListRevision] = useState(0);

  const submitLock = useRef(false);
  const pageSize = 10;

  const result = useRemote(
    `/crop-varieties?offset=${pageOffset}&limit=${pageSize}`,
    listRevision,
  );

  const varieties = Array.isArray(result.data)
    ? result.data
    : [];

  async function saveVariety(event) {
    event.preventDefault();

    if (submitLock.current) return;

    const cleanedName = name.trim();
    const cleanedPrice = price.trim();

    setError("");
    setSuccess("");

    if (!cleanedName) {
      setError(say("Enter a crop variety name."));
      return;
    }

    if (
      cleanedPrice &&
      !/^\d{1,8}(\.\d{1,2})?$/.test(cleanedPrice)
    ) {
      setError(
        say(
          "Enter a valid price with at most two decimal places.",
        ),
      );
      return;
    }

    submitLock.current = true;
    setBusy(true);

    try {
      const saved = await apiRequest("/crop-varieties", {
        method: "POST",
        body: JSON.stringify({
          name: cleanedName,
          ...(cleanedPrice
            ? { market_price_per_kg: cleanedPrice }
            : {}),
        }),
      });

      setSuccess(
        `${saved.name}: ${say(
          "Variety added. Farmers can select it when adding a crop.",
        )}`,
      );

      setName("");
      setPrice("");
      setOpen(false);
      setPageOffset(0);
      setListRevision((value) => value + 1);
    } catch (err) {
      const message =
        err.status && err.message
          ? err.message
          : "Result could not be confirmed. Refresh the list before retrying.";

      setError(say(message));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="ad-panel adcv-panel"
      aria-labelledby="adcv-title"
    >
      <div className="ad-panel-heading adcv-heading">
        <div>
          <h2 id="adcv-title">
            {say("Crop Varieties")}
          </h2>

          <p className="adcv-help">
            {say("Add millet varieties for farmers to select.")}
          </p>
        </div>

        <div className="adcv-actions">
          <button
            type="button"
            className="ad-btn ad-outline"
            disabled={busy || result.loading}
            onClick={() =>
              setListRevision((value) => value + 1)
            }
          >
            {say("Refresh")}
          </button>

          <button
            type="button"
            className="ad-btn"
            disabled={busy}
            aria-expanded={open}
            aria-controls="adcv-form"
            onClick={() => setOpen((value) => !value)}
          >
            {say(open ? "Close" : "+ Add Variety")}
          </button>
        </div>
      </div>

      {success && (
        <p className="adcv-success" role="status">
          {success}
        </p>
      )}

      {error && (
        <p className="adcv-error" role="alert">
          {error}
        </p>
      )}

      {open && (
        <form
          id="adcv-form"
          className="adcv-form"
          onSubmit={saveVariety}
          aria-busy={busy}
        >
          <div className="adcv-fields">
            <label htmlFor="adcv-name">
              {say("Variety name")} *

              <input
                id="adcv-name"
                name="variety_name"
                type="text"
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                maxLength={100}
                placeholder="Foxtail Millet"
                required
                disabled={busy}
              />
            </label>

            <label htmlFor="adcv-price">
              {say("Market price / kg (LKR)")}

              <input
                id="adcv-price"
                name="market_price_per_kg"
                type="number"
                value={price}
                onChange={(event) =>
                  setPrice(event.target.value)
                }
                min="0"
                max="99999999.99"
                step="0.01"
                placeholder={say("Optional")}
                disabled={busy}
              />
            </label>
          </div>

          <p className="adcv-help">
            {say(
              "The name may already exist in English; check before adding it again.",
            )}
          </p>

          <button
            className="ad-btn"
            type="submit"
            disabled={busy}
          >
            {say(busy ? "Saving…" : "Save Variety")}
          </button>
        </form>
      )}

      {result.loading ? (
        <p role="status">
          {say("Loading varieties…")}
        </p>
      ) : result.error ? (
        <p className="adcv-error" role="alert">
          {result.error}
        </p>
      ) : varieties.length ? (
        <ul className="adcv-list">
          {varieties.map((variety) => (
            <li key={variety.id}>
              <span>{variety.name}</span>

              <span>
                {variety.market_price_per_kg == null
                  ? say("Not set")
                  : `LKR ${variety.market_price_per_kg}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{say("No varieties on this page.")}</p>
      )}

      <div className="adcv-pagination">
        <button
          type="button"
          className="ad-btn ad-outline"
          disabled={
            busy ||
            result.loading ||
            pageOffset === 0
          }
          onClick={() =>
            setPageOffset((value) =>
              Math.max(0, value - pageSize),
            )
          }
        >
          {say("Previous")}
        </button>

        <span>{pageOffset / pageSize + 1}</span>

        <button
          type="button"
          className="ad-btn ad-outline"
          disabled={
            busy ||
            result.loading ||
            Boolean(result.error) ||
            varieties.length < pageSize
          }
          onClick={() =>
            setPageOffset((value) => value + pageSize)
          }
        >
          {say("Next")}
        </button>
      </div>
    </section>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { lang, setLang } = useSharedLanguage();

  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const [account, setAccount] = useState(null);
  const [authError, setAuthError] = useState("");

  const [page, setPage] = useState("overview");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [userStatus, setUserStatus] = useState("");

  const [paymentTab, setPaymentTab] = useState("farmer");
  const [planTab, setPlanTab] = useState("plans");
  const [month, setMonth] = useState(currentMonth);

  const [selected, setSelected] = useState(null);
  const [historyOffset, setHistoryOffset] = useState(0);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const actionLock = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    apiRequest("/auth/me", {
      signal: controller.signal,
    })
      .then((user) => {
        if (controller.signal.aborted) return;

        if (user.role !== "admin") {
          navigate(dashboardPath(user.role), {
            replace: true,
          });
          return;
        }

        setAccount(user);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;

        if (error.status === 401) {
          navigate("/login", { replace: true });
        } else {
          setAuthError(
            error.message || "Could not load your account.",
          );
        }
      });

    return () => controller.abort();
  }, [navigate]);

  function clearSelection() {
    setSelected(null);
    setHistoryOffset(0);
    setActionError("");
    setNotice("");
  }

  function go(next) {
    if (actionLock.current) return;

    setPage(next);
    setOffset(0);
    setSearch("");
    setSearchInput("");
    clearSelection();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function refresh() {
    if (actionLock.current) return;

    clearSelection();
    setRevision((value) => value + 1);
  }

  function view(row) {
    setSelected(row);
    setHistoryOffset(0);
    setActionError("");
    setNotice("");
  }

  function switchPayment(next) {
    setPaymentTab(next);
    setOffset(0);
    clearSelection();
  }

  function switchPlan(next) {
    setPlanTab(next);
    setOffset(0);
    clearSelection();
  }

  function logout() {
    if (actionLock.current) return;

    sessionStorage.removeItem("millet_access_token");
    navigate("/", { replace: true });
  }

  let path = null;

  if (account) {
    const pagination = `limit=${LIMIT}&offset=${offset}`;

    if (page === "overview") {
      path = "/dashboard/admin";
    }

    if (page === "harvests") {
      path = `/admin/harvests?${pagination}`;
    }

    if (page === "users") {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
      });

      if (search) params.set("search", search);
      if (role) params.set("role", role);

      if (userStatus !== "") {
        params.set("is_active", userStatus);
      }

      path = `/admin/users?${params}`;
    }

    if (page === "payments") {
      const endpoints = {
        farmer: "/admin/farmer-purchases",
        buyer: "/admin/finance/buyer-payments",
        subscription: "/admin/finance/subscription-payments",
      };

      path = `${endpoints[paymentTab]}?${pagination}`;
    }

    if (page === "plans") {
      path =
        planTab === "plans"
          ? "/admin/subscription-plans"
          : `/admin/farmer-subscriptions?${pagination}`;
    }

    if (page === "reports" && monthQuery(month)) {
      path = `/admin/reports/monthly?${monthQuery(month)}`;
    }
  }

  const result = useRemote(path, revision);

  let historyPath = null;
  let detailPath = null;

  if (account && selected) {
    if (page === "users") {
      historyPath =
        `/admin/users/${selected.id}/status-history` +
        `?limit=${LIMIT}&offset=${historyOffset}`;
    }

    if (
      page === "payments" &&
      paymentTab === "farmer"
    ) {
      historyPath =
        `/admin/farmer-purchases/${selected.id}/payments` +
        `?limit=${LIMIT}&offset=${historyOffset}`;
    }

    if (
      page === "payments" &&
      paymentTab !== "farmer"
    ) {
      const kind =
        paymentTab === "buyer" ? "buyer" : "subscription";

      detailPath =
        `/admin/finance/${kind}-payments/` +
        recordId(selected);
    }
  }

  const history = useRemote(historyPath, revision);
  const details = useRemote(detailPath, revision);

  const isListPage = [
    "harvests",
    "payments",
    "users",
    "plans",
  ].includes(page);

  const expectsEnvelope =
    page === "users" || page === "payments";

  const rawRows = expectsEnvelope
    ? result.data?.items
    : result.data;

  const rows = Array.isArray(rawRows) ? rawRows : [];

  const invalidList =
    isListPage &&
    path &&
    !result.loading &&
    !result.error &&
    !Array.isArray(rawRows);

  const totalRecords =
    expectsEnvelope &&
    result.data?.total_records != null
      ? Number(result.data.total_records)
      : NaN;

  const hasNext = Number.isFinite(totalRecords)
    ? offset + rows.length < totalRecords
    : rows.length === LIMIT;

  const historyRows = Array.isArray(history.data)
    ? history.data
    : Array.isArray(history.data?.items)
      ? history.data.items
      : [];

  const hasHistoryNext =
    page === "users" &&
    history.data?.total_records != null
      ? historyOffset + historyRows.length <
        Number(history.data.total_records)
      : historyRows.length === LIMIT;

  const summary =
    page === "overview" && result.data
      ? result.data
      : {};

  const report =
    page === "reports" ? result.data : null;

  async function mutate(endpoint, payload, message) {
    if (actionLock.current) return;

    actionLock.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");

    try {
      await apiRequest(endpoint, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (mounted.current) {
        setSelected(null);
        setHistoryOffset(0);
        setRevision((value) => value + 1);
        setNotice(t(message));
      }
    } catch (error) {
      if (mounted.current) {
        setActionError(
          `${error.message || t("Update failed.")} ` +
            t(
              "Refresh to confirm the current status before retrying.",
            ),
        );
      }
    } finally {
      actionLock.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  function updateUserStatus(event) {
    event.preventDefault();

    if (
      !selected ||
      selected.role === "admin" ||
      selected.id === account.id ||
      actionLock.current
    ) {
      return;
    }

    const form = new FormData(event.currentTarget);

    const reason = String(form.get("reason") || "")
      .trim()
      .replace(/\s+/g, " ");

    if (
      reason.length < 3 ||
      reason.length > 1000
    ) {
      setActionError(
        t(
          "Enter a reason between 3 and 1000 characters.",
        ),
      );
      return;
    }

    const active = !selected.is_active;

    if (
      !window.confirm(
        t(
          active
            ? "Activate this user account?"
            : "Deactivate this user account?",
        ),
      )
    ) {
      return;
    }

    mutate(
      `/admin/users/${selected.id}/status`,
      {
        is_active: active,
        reason,
      },
      "User status updated.",
    );
  }

  function reviewHarvest(event) {
    event.preventDefault();

    if (
      !selected ||
      (selected.review_status ?? selected.status) !== "pending" ||
      actionLock.current
    ) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const status = String(form.get("status"));

    if (
      !["approved", "rejected"].includes(status) ||
      !window.confirm(t("Save this harvest review?"))
    ) {
      return;
    }

    mutate(
      `/admin/harvests/${selected.id}/review`,
      {
        status,
        review_note:
          String(form.get("review_note") || "").trim() ||
          null,
      },
      "Harvest review saved.",
    );
  }

  function toggleHarvestPublication() {
    if (
      !selected ||
      actionLock.current ||
      (selected.review_status ?? selected.status) !== "approved"
    ) {
      return;
    }

    const makePublic = !selected.is_public;

    mutate(
      `/admin/harvests/${selected.id}/publish`,
      {
        is_public: makePublic,
      },
      makePublic ? "Published" : "Not published",
    );
  }

  function updatePlan() {
    if (!selected || actionLock.current) return;

    const active = !selected.is_active;

    if (
      !window.confirm(
        t(
          active
            ? "Enable this subscription plan?"
            : "Disable this subscription plan?",
        ),
      )
    ) {
      return;
    }

    mutate(
      `/admin/subscription-plans/${selected.id}`,
      {
        is_active: active,
      },
      "Subscription plan updated.",
    );
  }

  async function downloadReport() {
    if (
      actionLock.current ||
      !monthQuery(month)
    ) {
      return;
    }

    actionLock.current = true;
    setBusy(true);
    setActionError("");

    try {
      const base = (
        import.meta.env.VITE_API_URL ||
        "http://127.0.0.1:8000"
      ).replace(/\/+$/, "");

      const headers = new Headers();

      const token = sessionStorage.getItem(
        "millet_access_token",
      );

      if (token) {
        headers.set(
          "Authorization",
          `Bearer ${token}`,
        );
      }

      const response = await fetch(
        `${base}/admin/reports/monthly/download?${monthQuery(month)}`,
        { headers },
      );

      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => null);

        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : t("Report download failed."),
        );
      }

      const url = URL.createObjectURL(
        await response.blob(),
      );

      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download =
        `millet-plus-report-${month}.csv`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(
        () => URL.revokeObjectURL(url),
        1000,
      );
    } catch (error) {
      if (mounted.current) {
        setActionError(error.message);
      }
    } finally {
      actionLock.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  function columns() {
    if (page === "users") {
      return [
        ["name", "Name"],
        ["role", "Role"],
        ["phone", "Phone"],
        ["email", "Email"],
        ["is_active", "Status"],
      ];
    }

    if (page === "harvests") {
      return [
        ["id", "ID"],
        ["crop_cycle_id", "Crop cycle"],
        ["total_quantity_kg", "Quantity (kg)"],
        ["harvest_date", "Harvest date"],
        ["status", "Status"],
      ];
    }

    if (
      page === "payments" &&
      paymentTab === "farmer"
    ) {
      return [
        ["id", "Purchase"],
        ["farmer_name", "Farmer"],
        ["variety_name", "Millet"],
        ["total_amount", "Total"],
        ["paid_amount", "Paid"],
        ["balance_amount", "Balance"],
        ["payment_status", "Status"],
      ];
    }

    if (page === "payments") {
      return [
        ["payment_id", "Payment"],
        [
          paymentTab === "buyer"
            ? "buyer_name"
            : "farmer_name",
          paymentTab === "buyer"
            ? "Buyer"
            : "Farmer",
        ],
        ["amount", "Amount"],
        ["payment_status", "Payment status"],
        ["paid_at", "Paid at"],
      ];
    }

    if (planTab === "plans") {
      return [
        ["id", "ID"],
        ["name", "Plan"],
        ["amount", "Amount"],
        ["duration_months", "Months"],
        ["is_active", "Status"],
      ];
    }

    return [
      ["id", "Subscription"],
      ["farmer_id", "Farmer ID"],
      ["plan_name", "Plan"],
      ["amount", "Amount"],
      ["status", "Status"],
      ["ends_at", "Ends at"],
    ];
  }

  function stat(title, value, icon, hint) {
    return (
      <article className="ad-stat" key={title}>
        <span className="ad-stat-icon">
          <Icon name={icon} size={29} />
        </span>

        <div>
          <p>{t(title)}</p>
          <strong>{numeric(value)}</strong>
          <small>{t(hint)}</small>
        </div>

        <span className="ad-stat-leaf" aria-hidden="true">
          ❧
        </span>
      </article>
    );
  }

  if (!account) {
    return (
      <main className="admin-dashboard ad-auth">
        <img
          src="/images/logo.png"
          alt="Millet Plus"
        />

        <p role={authError ? "alert" : "status"}>
          {authError || t("Loading your dashboard…")}
        </p>

        {authError && (
          <Link to="/login" className="ad-btn">
            {t("Back to login")}
          </Link>
        )}
      </main>
    );
  }

  return (
    <div className="admin-dashboard">
      <header className="ad-header">
        <Link to="/" className="ad-brand">
          <img
            src="/images/logo.png"
            alt="Millet Plus"
          />
        </Link>

        <span className="ad-header-title">
          {t("Admin Dashboard")}
        </span>

        <div className="ad-header-actions">
          <div
            className="ad-language"
            aria-label="Language"
          >
            <button
              type="button"
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              EN
            </button>

            <span>|</span>

            <button
              type="button"
              aria-pressed={lang === "ta"}
              onClick={() => setLang("ta")}
            >
              தமிழ்
            </button>
          </div>

          <div className="ad-account">
            <span className="ad-avatar">
              {account.name?.charAt(0)?.toUpperCase() || "A"}
            </span>

            <span>{account.name}</span>
          </div>

          <button
            type="button"
            className="ad-btn ad-logout"
            disabled={busy}
            onClick={logout}
          >
            <Icon name="logout" size={17} />
            {t("Logout")}
          </button>
        </div>
      </header>

      <div className="ad-layout">
        <aside className="ad-sidebar">
          <nav aria-label="Admin navigation">
            {MENU.map(([key, title, icon]) => (
              <button
                key={key}
                type="button"
                className={`ad-nav-item ${
                  page === key ? "active" : ""
                }`}
                aria-current={
                  page === key ? "page" : undefined
                }
                disabled={busy}
                onClick={() => go(key)}
                title={t(title)}
              >
                <Icon name={icon} />
                <span>{t(title)}</span>
              </button>
            ))}
          </nav>

          <div
            className="ad-sidebar-art"
            aria-hidden="true"
          >
            <img
              src="/images/premium-millet.png"
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />

            <p>
              {t("Better crops. Stronger communities.")}
            </p>
          </div>
        </aside>

        <div className="ad-workspace">
          {page === "overview" && (
            <section className="ad-hero">
              <div className="ad-hero-content">
                <span className="ad-eyebrow">
                  MILLET PLUS · {t("ADMIN")}
                </span>

                <h1>
                  {t("Welcome")}, {account.name}
                </h1>

                <p>
                  {t(
                    "Manage millet. Support farmers. Grow together.",
                  )}
                </p>

                <span className="ad-gold-line" />
              </div>
            </section>
          )}

          <main className="ad-main">
            <div className="ad-page-heading">
              <div>
                <p className="ad-breadcrumb">
                  Millet Plus / {t(TITLES[page])}
                </p>

                <h1>{t(TITLES[page])}</h1>

                <p className="ad-muted">
                  {t(
                    page === "users"
                      ? "Farmer and buyer accounts, organised in one place."
                      : "Manage your platform records in one place.",
                  )}
                </p>
              </div>

              {!["stock", "orders"].includes(page) && (
                <button
                  type="button"
                  className="ad-btn ad-outline"
                  disabled={busy || result.loading}
                  onClick={refresh}
                >
                  <Icon name="refresh" size={16} />
                  {t("Refresh")}
                </button>
              )}
            </div>

            {notice && (
              <p
                className="ad-alert ad-success"
                role="status"
              >
                {notice}
              </p>
            )}

            {actionError && (
              <p
                className="ad-alert ad-error"
                role="alert"
              >
                {actionError}
              </p>
            )}

            {page === "users" && (
              <AdminUserActions
                selected={selected}
                lang={lang}
                onSaved={refresh}
              />
            )}

            {page === "payments" &&
              paymentTab === "farmer" && (
                <AdminPurchaseActions
                  selected={selected}
                  adminId={account.id}
                  lang={lang}
                  onSaved={refresh}
                />
              )}

            {page === "users" && (
              <form
                className="ad-toolbar ad-user-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(searchInput.trim());
                  setOffset(0);
                  clearSelection();
                }}
              >
                <label className="ad-search">
                  <Icon name="search" size={18} />

                  <input
                    aria-label={t("Search users")}
                    placeholder={t(
                      "Search name, email or phone",
                    )}
                    value={searchInput}
                    maxLength={100}
                    disabled={busy}
                    onChange={(event) =>
                      setSearchInput(event.target.value)
                    }
                  />
                </label>

                <select
                  aria-label={t("Role")}
                  value={role}
                  disabled={busy}
                  onChange={(event) => {
                    setRole(event.target.value);
                    setOffset(0);
                    clearSelection();
                  }}
                >
                  <option value="">
                    {t("All roles")}
                  </option>
                  <option value="farmer">
                    {t("Farmer")}
                  </option>
                  <option value="buyer">
                    {t("Buyer")}
                  </option>
                  <option value="admin">
                    {t("Admin")}
                  </option>
                </select>

                <select
                  aria-label={t("Account status")}
                  value={userStatus}
                  disabled={busy}
                  onChange={(event) => {
                    setUserStatus(event.target.value);
                    setOffset(0);
                    clearSelection();
                  }}
                >
                  <option value="">
                    {t("All statuses")}
                  </option>
                  <option value="true">
                    {t("Active")}
                  </option>
                  <option value="false">
                    {t("Inactive")}
                  </option>
                </select>

                <button
                  className="ad-btn"
                  type="submit"
                  disabled={busy}
                >
                  {t("Search")}
                </button>
              </form>
            )}

            {page === "payments" && (
              <div className="ad-tabs">
                {[
                  ["farmer", "Farmer purchases"],
                  ["buyer", "Buyer payments"],
                  ["subscription", "Subscription payments"],
                ].map(([key, title]) => (
                  <button
                    key={key}
                    type="button"
                    className={`ad-tab ${
                      paymentTab === key ? "active" : ""
                    }`}
                    disabled={busy}
                    onClick={() => switchPayment(key)}
                  >
                    {t(title)}
                  </button>
                ))}
              </div>
            )}

            {page === "plans" && (
              <div className="ad-tabs">
                {[
                  ["plans", "Plans"],
                  ["subscriptions", "Farmer subscriptions"],
                ].map(([key, title]) => (
                  <button
                    key={key}
                    type="button"
                    className={`ad-tab ${
                      planTab === key ? "active" : ""
                    }`}
                    disabled={busy}
                    onClick={() => switchPlan(key)}
                  >
                    {t(title)}
                  </button>
                ))}
              </div>
            )}

            {page === "reports" && (
              <div className="ad-toolbar">
                <label className="ad-month-label">
                  {t("Report month")}

                  <input
                    type="month"
                    value={month}
                    disabled={busy}
                    onChange={(event) =>
                      setMonth(event.target.value)
                    }
                  />
                </label>

                <button
                  type="button"
                  className="ad-btn"
                  disabled={
                    busy ||
                    result.loading ||
                    !report ||
                    !monthQuery(month)
                  }
                  onClick={downloadReport}
                >
                  {t("Download CSV")}
                </button>
              </div>
            )}

            {result.error && (
              <p
                className="ad-alert ad-error"
                role="alert"
              >
                {result.error}
              </p>
            )}

            {invalidList && (
              <p
                className="ad-alert ad-error"
                role="alert"
              >
                {t(
                  "The backend returned an unexpected list format.",
                )}
              </p>
            )}

            {result.loading && (
              <div
                className="ad-loading"
                role="status"
              >
                <span className="ad-spinner" />
                {t("Loading records…")}
              </div>
            )}

            {page === "stock" && (
              <section className="ad-panel ad-integrated">
                <AdminCropVarieties lang={lang} />
                <AdminStock lang={lang} />
              </section>
            )}

            {page === "orders" && (
              <section className="ad-panel ad-integrated">
                <OrdersPanel
                  role="admin"
                  lang={lang}
                />
              </section>
            )}

            {page === "overview" &&
              !result.loading &&
              !result.error && (
                <>
                  <section className="ad-stats">
                    {stat(
                      "Pending harvests",
                      summary.pending_harvests,
                      "leaf",
                      "Waiting for review",
                    )}

                    {stat(
                      "Crop records",
                      summary.total_crops,
                      "stock",
                      "Recorded crop cycles",
                    )}

                    {stat(
                      "Farmers",
                      summary.total_farmers,
                      "users",
                      "Registered farmers",
                    )}

                    {stat(
                      "Buyers",
                      summary.total_buyers,
                      "cart",
                      "Registered buyers",
                    )}
                  </section>

                  <div className="ad-overview-grid">
                    <section className="ad-panel">
                      <div className="ad-panel-heading">
                        <div>
                          <span className="ad-eyebrow">
                            {t("WORKSPACE")}
                          </span>

                          <h2>{t("Needs attention")}</h2>
                        </div>

                        <Icon name="leaf" size={27} />
                      </div>

                      {[
                        ["harvests", "Review harvests", "leaf"],
                        ["orders", "Manage buyer orders", "cart"],
                        [
                          "payments",
                          "Check payment records",
                          "card",
                        ],
                        ["users", "Manage user accounts", "users"],
                      ].map(([key, title, icon]) => (
                        <button
                          key={key}
                          type="button"
                          className="ad-quick-link"
                          onClick={() => go(key)}
                        >
                          <span className="ad-quick-icon">
                            <Icon name={icon} />
                          </span>

                          <span>{t(title)}</span>

                          {key === "harvests" && (
                            <span className="ad-count">
                              {summary.pending_harvests ?? "—"}
                            </span>
                          )}

                          <Icon name="arrow" size={18} />
                        </button>
                      ))}
                    </section>

                    <section className="ad-report-promo">
                      <div>
                        <span className="ad-eyebrow">
                          {t("MONTHLY REPORTS")}
                        </span>

                        <h2>
                          {t("See your platform clearly.")}
                        </h2>

                        <p>
                          {t(
                            "Review collections, farmer payments and purchases for a selected month.",
                          )}
                        </p>

                        <button
                          className="ad-btn"
                          type="button"
                          onClick={() => go("reports")}
                        >
                          {t("View reports")}
                          <Icon name="arrow" size={16} />
                        </button>
                      </div>
                    </section>
                  </div>

                  <section className="ad-welcome-strip">
                    <Icon name="check" size={24} />

                    <div>
                      <strong>
                        {t(
                          "Better crops. Stronger communities.",
                        )}
                      </strong>

                      <p>
                        {t(
                          "Keep harvests, stock, orders and accounts organised.",
                        )}
                      </p>
                    </div>
                  </section>
                </>
              )}

            {isListPage &&
              !result.loading &&
              !result.error &&
              !invalidList && (
                <section className="ad-panel">
                  <div className="ad-panel-heading">
                    <h2>{t(TITLES[page])}</h2>

                    <span className="ad-muted">
                      {Number.isFinite(totalRecords)
                        ? `${totalRecords} ${t("records")}`
                        : `${t("Page")} ${offset / LIMIT + 1}`}
                    </span>
                  </div>

                  <Table
                    rows={rows}
                    columns={columns()}
                    onView={view}
                    t={t}
                  />

                  {!(page === "plans" && planTab === "plans") && (
                    <div className="ad-pagination">
                      <button
                        type="button"
                        className="ad-btn ad-outline"
                        disabled={busy || offset === 0}
                        onClick={() => {
                          setOffset((value) =>
                            Math.max(0, value - LIMIT),
                          );
                          clearSelection();
                        }}
                      >
                        {t("Previous")}
                      </button>

                      <span>
                        {t("Page")} {offset / LIMIT + 1}
                      </span>

                      <button
                        type="button"
                        className="ad-btn ad-outline"
                        disabled={busy || !hasNext}
                        onClick={() => {
                          setOffset((value) => value + LIMIT);
                          clearSelection();
                        }}
                      >
                        {t("Next")}
                      </button>
                    </div>
                  )}
                </section>
              )}

            {page === "reports" &&
              !result.loading &&
              !result.error &&
              report && (
                <>
                  <section className="ad-report-stats">
                    {REPORT_FIELDS.map(([key, title]) => (
                      <article
                        className="ad-report-stat"
                        key={key}
                      >
                        <span>{t(title)}</span>

                        <strong>
                          {money(report.summary?.[key])}
                        </strong>
                      </article>
                    ))}
                  </section>

                  <p className="ad-report-note">
                    {report.report_basis ||
                      t(
                        "This report shows cash movement. Cash difference is not profit.",
                      )}
                  </p>

                  {[
                    ["buyer_payments", "Buyer payments"],
                    [
                      "subscription_payments",
                      "Subscription payments",
                    ],
                    ["farmer_payments", "Farmer payments"],
                    ["purchases", "Farmer purchases"],
                  ].map(([key, title]) => {
                    const records = Array.isArray(report[key])
                      ? report[key]
                      : [];

                    const keys = [
                      ...new Set(
                        records.flatMap((row) =>
                          Object.keys(row),
                        ),
                      ),
                    ];

                    return (
                      <section
                        className="ad-panel"
                        key={key}
                      >
                        <div className="ad-panel-heading">
                          <h2>{t(title)}</h2>
                          <span>{records.length}</span>
                        </div>

                        <Table
                          rows={records}
                          columns={keys.map((field) => [
                            field,
                            label(field),
                          ])}
                          t={t}
                        />
                      </section>
                    );
                  })}
                </>
              )}

            {selected && (
              <section className="ad-panel ad-selected">
                <div className="ad-selected-heading">
                  <h2>
                    {page === "users"
                      ? selected.name
                      : `${t("Record")} #${recordId(selected)}`}
                  </h2>

                  <button
                    className="ad-icon-btn"
                    type="button"
                    aria-label={t("Close details")}
                    disabled={busy}
                    onClick={clearSelection}
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>

                {detailPath && details.loading && (
                  <p role="status">
                    {t("Loading…")}
                  </p>
                )}

                {details.error && (
                  <p
                    className="ad-alert ad-error"
                    role="alert"
                  >
                    {details.error}
                  </p>
                )}

                <RecordDetails
                  record={
                    detailPath && details.data
                      ? details.data
                      : selected
                  }
                  t={t}
                />

                {page === "users" &&
                  selected.role !== "admin" &&
                  selected.id !== account.id && (
                    <form
                      key={`user-${selected.id}`}
                      className="ad-action-form"
                      onSubmit={updateUserStatus}
                    >
                      <h3>
                        {t(
                          selected.is_active
                            ? "Deactivate account"
                            : "Activate account",
                        )}
                      </h3>

                      <label>
                        {t("Reason")}

                        <textarea
                          name="reason"
                          required
                          minLength={3}
                          maxLength={1000}
                          rows={3}
                          disabled={busy}
                          placeholder={t(
                            "Enter the reason for this status change",
                          )}
                        />
                      </label>

                      <button
                        type="submit"
                        className="ad-btn"
                        disabled={busy}
                      >
                        {t(
                          busy
                            ? "Saving…"
                            : selected.is_active
                              ? "Deactivate"
                              : "Activate",
                        )}
                      </button>
                    </form>
                  )}

                {page === "users" &&
                  selected.role === "admin" && (
                    <p className="ad-report-note">
                      {t(
                        "Admin accounts cannot be changed through this endpoint.",
                      )}
                    </p>
                  )}

                {page === "harvests" &&
                  (selected.review_status ?? selected.status) === "pending" && (
                    <form
                      key={`harvest-${selected.id}`}
                      className="ad-action-form"
                      onSubmit={reviewHarvest}
                    >
                      <h3>{t("Review harvest")}</h3>

                      <label>
                        {t("Decision")}

                        <select
                          name="status"
                          disabled={busy}
                        >
                          <option value="approved">
                            {t("Approve")}
                          </option>

                          <option value="rejected">
                            {t("Reject")}
                          </option>
                        </select>
                      </label>

                      <label>
                        {t("Review note")}

                        <textarea
                          name="review_note"
                          maxLength={1000}
                          rows={3}
                          disabled={busy}
                        />
                      </label>

                      <button
                        type="submit"
                        className="ad-btn"
                        disabled={busy}
                      >
                        {t(
                          busy
                            ? "Saving…"
                            : "Save review",
                        )}
                      </button>
                    </form>
                  )}

                {page === "harvests" &&
                  (selected.review_status ?? selected.status) === "approved" && (
                    <div className="ad-action-form">
                      <h3>{t("Public visibility")}</h3>

                      <Badge
                        value={
                          selected.is_public
                            ? "Published"
                            : "Not published"
                        }
                        t={t}
                      />

                      <button
                        type="button"
                        className="ad-btn"
                        disabled={busy}
                        onClick={toggleHarvestPublication}
                      >
                        {t(
                          busy
                            ? "Saving…"
                            : selected.is_public
                              ? "Hide from public"
                              : "Publish",
                        )}
                      </button>
                    </div>
                  )}

                {page === "plans" &&
                  planTab === "plans" && (
                    <div className="ad-action-form">
                      <h3>{t("Plan availability")}</h3>

                      <p className="ad-muted">
                        {t(
                          "Change whether this plan is available for subscription requests.",
                        )}
                      </p>

                      <button
                        type="button"
                        className="ad-btn"
                        disabled={busy}
                        onClick={updatePlan}
                      >
                        {t(
                          selected.is_active
                            ? "Disable plan"
                            : "Enable plan",
                        )}
                      </button>
                    </div>
                  )}

                {historyPath && (
                  <div className="ad-history">
                    <h3>
                      {t(
                        page === "users"
                          ? "Status history"
                          : "Cash payment history",
                      )}
                    </h3>

                    {history.loading ? (
                      <p role="status">
                        {t("Loading history…")}
                      </p>
                    ) : history.error ? (
                      <p
                        className="ad-alert ad-error"
                        role="alert"
                      >
                        {history.error}
                      </p>
                    ) : (
                      <>
                        <Table
                          rows={historyRows}
                          columns={
                            page === "users"
                              ? [
                                  [
                                    "previous_active",
                                    "Previously active",
                                  ],
                                  [
                                    "new_active",
                                    "Now active",
                                  ],
                                  ["reason", "Reason"],
                                  [
                                    "changed_by_name",
                                    "Changed by",
                                  ],
                                  [
                                    "changed_at",
                                    "Changed at",
                                  ],
                                ]
                              : [
                                  [
                                    "receipt_number",
                                    "Receipt",
                                  ],
                                  ["amount", "Amount"],
                                  [
                                    "payment_method",
                                    "Method",
                                  ],
                                  ["paid_at", "Paid at"],
                                  ["note", "Note"],
                                ]
                          }
                          t={t}
                        />

                        <div className="ad-pagination">
                          <button
                            type="button"
                            className="ad-btn ad-outline"
                            disabled={
                              busy ||
                              historyOffset === 0
                            }
                            onClick={() =>
                              setHistoryOffset((value) =>
                                Math.max(0, value - LIMIT),
                              )
                            }
                          >
                            {t("Previous")}
                          </button>

                          <span>
                            {t("Page")}{" "}
                            {historyOffset / LIMIT + 1}
                          </span>

                          <button
                            type="button"
                            className="ad-btn ad-outline"
                            disabled={
                              busy ||
                              !hasHistoryNext
                            }
                            onClick={() =>
                              setHistoryOffset(
                                (value) => value + LIMIT,
                              )
                            }
                          >
                            {t("Next")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}
          </main>

          <footer className="ad-footer ad-admin-footer">
            <div className="ad-admin-footer-top">
              <div className="ad-admin-footer-brand">
                <Link
                  to="/"
                  className="ad-footer-brand"
                >
                  <img
                    src="/images/logo.png"
                    alt="Millet Plus"
                  />
                </Link>

                <p>
                  {t(
                    "Manage millet. Support farmers. Grow together.",
                  )}
                </p>

                <strong>
                  {t(
                    "Better crops. Stronger communities.",
                  )}
                </strong>
              </div>

              <div className="ad-admin-footer-links">
                <h3>{t("Admin workspace")}</h3>

                <div>
                  {[
                    ["overview", "Overview"],
                    ["harvests", "Harvests"],
                    ["stock", "Stock"],
                    ["orders", "Orders"],
                    ["users", "Users"],
                    ["payments", "Payments"],
                    ["plans", "Plans"],
                    ["reports", "Reports"],
                  ].map(([key, title]) => (
                    <button
                      key={key}
                      type="button"
                      disabled={busy}
                      onClick={() => go(key)}
                    >
                      {t(title)}
                    </button>
                  ))}
                </div>

                <div className="ad-admin-footer-languages">
                  <span>{t("Languages")}:</span>

                  <button
                    type="button"
                    aria-pressed={lang === "en"}
                    onClick={() => setLang("en")}
                  >
                    English
                  </button>

                  <span>|</span>

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

            <div className="ad-admin-footer-bottom">
              <span>
                © {new Date().getFullYear()} Millet Plus
              </span>

              <span>
                {t(
                  "Growing together, season after season.",
                )}
              </span>

              <Link to="/">
                {t("Home")}
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}