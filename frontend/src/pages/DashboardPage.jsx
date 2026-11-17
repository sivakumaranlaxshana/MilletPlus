import CropCareAdvice from "../components/CropCareAdvice";
import CropHealthCheck from "../components/CropHealthCheck";
import CropReminders from "../components/CropReminders";
import ReminderCalendar from "../components/ReminderCalendar";
import { MilletPageTheme } from "./LandingPage";
import BuyerShop from "../components/BuyerShop";
import OrdersPanel from "../components/OrdersPanel";
import usePublicStocks, { formatStockValue } from "../hooks/usePublicStocks";
import AdminStock from "../components/AdminStock";
import { tamilText } from "../translations";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiRequest, dashboardPath } from "../api";
import { DASHBOARD_LABELS as LABELS } from "../translations";
import { useSharedLanguage } from "../translations/language";
import FarmWeather from "../components/FarmWeather";
function errorText(error) {
  if (Array.isArray(error.detail)) {
    return error.detail.map(item => {
      const field = item.loc?.slice(1).join(".");
      return field ? `${field}: ${item.msg}` : item.msg;
    }).join(" ");
  }
  return error.message || "Request failed.";
}
function Modal({
  title,
  onClose,
  children,
  t,
  busy = false
}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="dashboard-dialog-title" onCancel={event => {
    if (busy) {
      event.preventDefault();
    } else {
      onClose();
    }
  }}>
      <div className="modal-heading">
        <h2 id="dashboard-dialog-title">{title}</h2>

        <button className="icon-button" type="button" disabled={busy} aria-label={t("close")} onClick={onClose}>
          ✕
        </button>
      </div>

      {children}
    </dialog>;
}
function Editor({ editor, t, ui, onClose, onSave, inline = false }) {
  const { lang } = useSharedLanguage();
  const formRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const say = (text) => lang === "ta" ? tamilText(text) : text;

  function fillCurrentLocation() {
    const form = formRef.current;
    if (!form || busy || locating) return;

    if (!navigator.geolocation) {
      setError(say("Location access is unavailable. Use localhost or HTTPS, or enter coordinates manually."));
      return;
    }

    const latitude = form.elements.namedItem("latitude");
    const longitude = form.elements.namedItem("longitude");
    if (!latitude || !longitude) return;

    setError("");
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (formRef.current !== form) return;
        latitude.value = coords.latitude.toFixed(6);
        longitude.value = coords.longitude.toFixed(6);
        setLocating(false);
      },
      (err) => {
        if (formRef.current !== form) return;
        setError(err.code === 1
          ? say("Location permission was denied. Allow it in your browser and try again.")
          : say("Could not get your location. Try again or enter coordinates manually.")
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || locating) return;

    const form = new FormData(event.currentTarget);
    const values = {};

    for (const field of editor.fields) {
      let value = form.get(field.name);
      if (field.type === "checkbox") {
        value = form.has(field.name);
      } else if (field.number) {
        value = value === "" ? null : Number(value);
      } else if (field.nullable && value === "") {
        value = null;
      }
      values[field.name] = value;
    }

    if (editor.kind === "farm" && (values.latitude === null) !== (values.longitude === null)) {
      setError(t("coordinates"));
      return;
    }

    if (editor.kind === "review" && values.status === "rejected" && !values.review_note?.trim()) {
      setError(t("rejectionReason"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      {error && <p className="alert error" role="alert">{error}</p>}
      <form ref={formRef} onSubmit={submit}>
        <fieldset disabled={busy || locating}>
          {editor.fields.map((field) => (
            <label key={field.name}>
              {ui(field.name)}
              {field.type === "select" ? (
                <select name={field.name} required defaultValue={editor.record?.[field.name] ?? ""}>
                  <option value="">{t("choose")}</option>
                  {field.options.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea name={field.name} maxLength={2000} defaultValue={editor.record?.[field.name] ?? ""} />
              ) : field.type === "checkbox" ? (
                <input type="checkbox" name={field.name} defaultChecked={!!editor.record?.[field.name]} />
              ) : (
                <input
                  name={field.name}
                  type={field.type || "text"}
                  required={field.required}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                  defaultValue={editor.record?.[field.name] ?? ""}
                />
              )}
            </label>
          ))}

          {editor.kind === "farm" && (
            <>
              <button type="button" className="btn outline space-top" onClick={fillCurrentLocation}>
                {locating
                  ? say("Getting location…")
                  : say("Use my current location")}
              </button>
              <p className="muted">{ui("coordinates")}</p>
            </>
          )}

          {editor.kind === "profile" && <p className="muted">{ui("smsNote")}</p>}
          <button className="btn red full space-top" type="submit">
            {ui(busy ? "saving" : "save")}
          </button>
        </fieldset>
      </form>
    </>
  );

  if (inline) {
    return (
      <section className="panel inline-editor">
        <div className="section-title">
          <span className="round-icon gold"><Icon name="grain" /></span>
          <div><h2>{editor.title}</h2></div>
          <button className="icon-button" disabled={busy} onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </div>
        {content}
      </section>
    );
  }

  return (
    <Modal title={editor.title} onClose={onClose} t={t} busy={busy}>
      {content}
    </Modal>
  );
}

function textField(name, maxLength = 50) {
  return {
    name,
    required: true,
    minLength: 2,
    maxLength
  };
}
function numberField(name, required = true, min = 0.01) {
  return {
    name,
    type: "number",
    number: true,
    required,
    min,
    step: "0.01"
  };
}
export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const {
    lang,
    setLang
  } = useSharedLanguage();
  const [user, setUser] = useState(null);
  const publicStocks = usePublicStocks({ enabled: user?.role === "buyer" });
  const [tab, setTab] = useState("Overview");
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  function t(key) {
    return LABELS[key]?.[lang === "ta" ? 1 : 0] ?? String(key).replaceAll("_", " ");
  }
  function ui(key) {
    const text = LABELS[key] || [String(key).replaceAll("_", " "), String(key).replaceAll("_", " ")];
    return <span className="dash-copy">
        {["en", "ta"].map((language, index) => <span key={language} lang={language} className={lang === language ? "visible" : ""} aria-hidden={lang !== language}>
            {text[index]}
          </span>)}
      </span>;
  }
  const pair = (en, ta) => <Dual lang={lang} en={en} ta={ta} />;
  const logout = useCallback(() => {
    sessionStorage.removeItem("millet_access_token");
    navigate("/", {
      replace: true
    });
  }, [navigate]);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("/auth/me", {
      signal: controller.signal
    }).then(account => {
      if (!controller.signal.aborted) {
        setUser(account);
      }
    }).catch(err => {
      if (err.name === "AbortError") return;
      if (err.status === 401) {
        logout();
      } else {
        setError(errorText(err));
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [logout]);
  useEffect(() => {
    if (!user) return;
    const expected = dashboardPath(user.role);
    if (location.pathname !== expected) {
      navigate(expected, {
        replace: true
      });
    }
  }, [user, location.pathname, navigate]);
  const load = useCallback(async signal => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      let result;
      if (user.role === "farmer") {
        const [summary, farms, crops, harvests, varieties] = await Promise.all([apiRequest("/dashboard/farmer", {
          signal
        }), apiRequest("/farms?limit=100", {
          signal
        }), apiRequest("/crop-cycles?limit=100", {
          signal
        }), apiRequest("/harvests?limit=100", {
          signal
        }), apiRequest("/crop-varieties?limit=100", {
          signal
        })]);
        result = {
          summary,
          farms,
          crops,
          harvests,
          varieties
        };
      } else if (user.role === "admin") {
        const [summary, harvests, varieties] = await Promise.all([apiRequest("/dashboard/admin", {
          signal
        }), apiRequest("/admin/harvests?limit=100", {
          signal
        }), apiRequest("/crop-varieties?limit=100", {
          signal
        })]);
        result = {
          summary,
          harvests,
          varieties
        };
      } else {
        result = {};
      }
      if (!signal?.aborted) {
        setData(result);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      if (err.status === 401) {
        logout();
      } else {
        setError(errorText(err));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [user, logout]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  function varietyName(id) {
    return data.varieties?.find(item => item.id === id)?.name || `#${id}`;
  }
  function cropName(id) {
    const crop = data.crops?.find(item => item.id === id);
    return crop ? `${varietyName(crop.variety_id)} · #${id}` : `#${id}`;
  }
  function varietyImage(name) {
    const value = String(name || "").toLowerCase();
    if (value.includes("finger")) {
      return "/images/finger-millet.png";
    }
    if (value.includes("foxtail")) {
      return "/images/foxtail-millet.png";
    }
    if (value.includes("pearl")) {
      return "/images/pearl-millet.png";
    }
    if (value.includes("little")) {
      return "/images/little-millet.png";
    }
    return "/images/millet-harvest.png";
  }
  function growingImage(name) {
    const value = String(name || "").toLowerCase();
    if (value.includes("foxtail")) {
      return "/images/crop-foxtail-growing.png";
    }
    if (value.includes("finger")) {
      return "/images/crop-finger-growing.png";
    }
    return varietyImage(name);
  }
  function openEditor(kind, record = null) {
    setError("");
    setNotice("");
    let fields = [];
    if (kind === "farm") {
      fields = [textField("name", 100), textField("district"), textField("location", 255), numberField("area_acres"), {
        ...numberField("latitude", false, -90),
        max: 90,
        step: "0.000001"
      }, {
        ...numberField("longitude", false, -180),
        max: 180,
        step: "0.000001"
      }];
    }
    if (kind === "crop") {
      if (!data.farms?.length || !data.varieties?.length) {
        setError(t("needsFarm"));
        return;
      }
      fields = [...(record ? [] : [{
        name: "farm_id",
        type: "select",
        number: true,
        options: data.farms.map(farm => [farm.id, farm.name])
      }]), {
        name: "variety_id",
        type: "select",
        number: true,
        options: data.varieties.map(variety => [variety.id, variety.name])
      }, {
        name: "planting_date",
        type: "date",
        required: true
      }, textField("growth_stage"), textField("soil_type"), textField("irrigation_method")];
    }
    if (kind === "harvest") {
      if (!data.crops?.length) {
        setError(t("needsCrop"));
        return;
      }
      fields = [...(record ? [] : [{
        name: "crop_cycle_id",
        type: "select",
        number: true,
        options: data.crops.map(crop => [crop.id, cropName(crop.id)])
      }]), {
        name: "harvest_date",
        type: "date",
        required: true
      }, numberField("total_quantity_kg"), {
        name: "notes",
        type: "textarea",
        nullable: true
      }];
    }
    if (kind === "variety") {
      fields = [textField("name", 100), numberField("market_price_per_kg", false, 0)];
    }
    if (kind === "profile") {
      fields = [textField("name", 100), {
        name: "phone",
        type: "tel",
        required: true,
        maxLength: 30
      }, {
        name: "sms_opt_in",
        type: "checkbox"
      }];
    }
    if (kind === "review") {
      fields = [{
        name: "status",
        type: "select",
        options: [["approved", t("approved")], ["rejected", t("rejected")]]
      }, {
        name: "review_note",
        type: "textarea",
        nullable: true
      }];
    }
    const titles = {
      farm: "Farms",
      crop: "Crops",
      harvest: "Harvests",
      variety: "Varieties",
      profile: "Profile",
      review: "Review"
    };
    setEditor({
      kind,
      fields,
      title: `${t(record ? "edit" : "add")} · ${t(titles[kind])}`,
      record: kind === "review" ? {
        ...record,
        status: "approved",
        review_note: ""
      } : record
    });
  }
  async function saveRecord(values) {
    const paths = {
      farm: "/farms",
      crop: "/crop-cycles",
      harvest: "/harvests",
      variety: "/crop-varieties"
    };
    if (editor.kind === "profile") {
      const account = await apiRequest("/auth/me", {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      setUser(account);
    } else if (editor.kind === "review") {
      await apiRequest(`/admin/harvests/${editor.record.id}/review`, {
        method: "PATCH",
        body: JSON.stringify(values)
      });
    } else {
      const path = paths[editor.kind] + (editor.record ? `/${editor.record.id}` : "");
      await apiRequest(path, {
        method: editor.record ? "PATCH" : "POST",
        body: JSON.stringify(values)
      });
    }
    setNotice("saved");
    await load();
  }
  async function updatePhoto(crop, file, remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file && file.size > 5 * 1024 * 1024) {
        throw new Error(t("photoSize"));
      }
      if (file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error(t("photoType"));
      }
      const options = {
        method: remove ? "DELETE" : "PUT"
      };
      if (!remove) {
        const form = new FormData();
        form.append("file", file);
        options.body = form;
      }
      await apiRequest(`/crop-cycles/${crop.id}/image`, options);
      setNotice(remove ? "photoRemoved" : "photoSaved");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function changePublication(harvest) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/admin/harvests/${harvest.id}/publish`, {
        method: "PATCH",
        body: JSON.stringify({
          is_public: !harvest.is_public
        })
      });
      setNotice("saved");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  function showHarvest(harvest) {
    setSelected(harvest);
  }
  function publicStockDetails(stockId) {
    const stock = publicStocks.records.find(item => item.id === stockId);
    if (!stock) return <p>{pair("Stock details are not available right now. Please refresh.", tamilText("Stock details are not available right now. Please refresh."))}</p>;
    const fields = [
      ["Millet", stock.variety_name],
      ["Available", `${formatStockValue(stock.available_quantity, lang)} kg`],
      ["Price / kg", `LKR ${formatStockValue(stock.selling_price_per_kg, lang)}`],
      ["Status", stock.in_stock ? "In stock" : "Out of Stock"],
    ];
    return <dl className="detail-list">{fields.map(([label, value]) => <div key={label}><dt>{pair(label, tamilText(label))}</dt><dd>{label === "Status" ? pair(value, tamilText(value)) : value}</dd></div>)}</dl>;
  }
  const tabIcons = {
    Overview: "home",
    Farms: "location",
    Crops: "leaf",
    Health: "heart",
    Harvests: "grain",
    Reminders: "calendar",
    Premium: "crown",
    Public: "cart",
    Cart: "cart",
    Orders: "orders",
    Review: "grain",
    Stock: "box",
    Payments: "payment",
    Users: "people",
    Plans: "crown",
    Reports: "bars",
    Varieties: "leaf",
    Profile: "user"
  };
  const extraLabels = {
    Health: ["Health Checks", tamilText("Health Checks")],
    Reminders: ["Reminders", tamilText("View reminders")],
    Premium: ["Premium", "Premium"],
    Cart: ["Cart", tamilText("Cart")],
    Orders: ["My Orders", tamilText("My Orders")],
    Stock: ["Stock", tamilText("Stock")],
    Payments: ["Payments", tamilText("Payments")],
    Users: ["Users", tamilText("Users")],
    Plans: ["Plans", tamilText("Plans")],
    Reports: ["Reports", tamilText("Reports")]
  };
  function navLabel(key) {
    if (extraLabels[key]) {
      return pair(...extraLabels[key]);
    }
    if (key === "Public") {
      return pair("Shop", tamilText("Shop"));
    }
    return ui(key);
  }
  const tabs = user?.role === "farmer" ? ["Overview", "Crops", "Health", "Harvests", "Reminders", "Premium"] : user?.role === "admin" ? ["Overview", "Review", "Stock", "Orders", "Payments", "Users", "Plans", "Reports", "Varieties"] : ["Public", "Cart", "Orders", "Profile"];
  function go(nextTab) {
    setTab(nextTab);
    setMenu(false);
    setNotice("");
    setSelected(null);
    setEditor(null);
    window.scrollTo({
      top: 0,
      behavior: "instant"
    });
  }
  function sectionTitle(icon, title, subtitle, action) {
    return <div className="section-title">
        <span className={`round-icon ${icon === "grain" ? "gold" : ""}`}>
          <Icon name={icon} />
        </span>

        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>

        {action && <div className="section-title-action">
            {action}
          </div>}
      </div>;
  }
  function coming(en = "Coming soon", ta = tamilText("Coming soon")) {
    return <span className="coming-badge">
        {pair(en, ta)}
      </span>;
  }
  function stat(icon, title, value, note) {
    return <article className="summary-card">
        <span className={`round-icon ${icon === "grain" || icon === "clock" ? "gold" : ""}`}>
          <Icon name={icon} size={27} />
        </span>

        <div>
          <h3>{title}</h3>
          <strong>{value ?? "—"}</strong>
          {note && <p>{note}</p>}
        </div>
      </article>;
  }
  function photoFor(harvest) {
    return harvest.image_url || data.crops?.find(crop => crop.id === harvest.crop_cycle_id)?.image_url || varietyImage(harvest.variety_name || cropName(harvest.crop_cycle_id));
  }
  function harvestTable(records = data.harvests || [], admin = false) {
    return <div className="table-scroll">
        <table className="harvest-table">
          <thead>
            <tr>
              <th>{pair("Crop", tamilText("Related Crop"))}</th>

              {admin && <th>
                  {pair("Farmer", tamilText("Farmer"))}
                </th>}

              <th>
                {pair("Quantity", tamilText("Quantity"))}
              </th>

              <th>{ui("harvest_date")}</th>
              <th>{ui("status")}</th>

              <th>
                {pair("Actions", tamilText("Actions"))}
              </th>
            </tr>
          </thead>

          <tbody>
            {records.length ? records.map(harvest => <tr key={harvest.id}>
                  <td>
                    <div className="table-crop">
                      <img src={photoFor(harvest)} alt="" />

                      <strong>
                        {harvest.variety_name || cropName(harvest.crop_cycle_id)}
                      </strong>
                    </div>
                  </td>

                  {admin && <td>
                      {harvest.farmer_name || "—"}
                    </td>}

                  <td>
                    {harvest.total_quantity_kg} kg
                  </td>

                  <td>
                    {harvest.harvest_date}
                  </td>

                  <td>
                    <span className={`badge ${harvest.status || "approved"}`}>
                      {ui(harvest.status || "published")}
                    </span>

                    {admin && harvest.is_public && <small className="publication-note">
                          {ui("published")}
                        </small>}
                  </td>

                  <td>
                    <div className="table-actions">
                      <button className="btn outline small" onClick={() => showHarvest(harvest)}>
                        {ui("details")}

                        <Icon name="arrow" size={12} />
                      </button>

                      {admin && harvest.status === "pending" && <button className="btn red small" onClick={() => openEditor("review", harvest)}>
                            {pair("Review", tamilText("Review"))}
                          </button>}

                      {admin && harvest.status === "approved" && <button className="text-button" disabled={busy} onClick={() => changePublication(harvest)}>
                            {ui(harvest.is_public ? "hide" : "publish")}
                          </button>}

                      {!admin && harvest.status === "pending" && <button className="text-button" onClick={() => openEditor("harvest", harvest)}>
                            {ui("edit")}
                          </button>}
                    </div>
                  </td>
                </tr>) : <tr>
                <td colSpan={admin ? 6 : 5} className="empty-table">
                  {ui("empty")}
                </td>
              </tr>}
          </tbody>
        </table>
      </div>;
  }
  function cropGrid(crops = data.crops || [], list = false) {
    if (!crops.length) {
      return <div className="empty-panel">
          <Icon name="leaf" size={45} />

          <h3>
            {pair("Your next season starts here.", tamilText("Your next season starts here."))}
          </h3>

          <p>{ui("farmerNext")}</p>

          <button className="btn red" onClick={() => openEditor("crop")}>
            <Icon name="plus" size={16} />

            {pair("Add Crop", tamilText("Add Crop"))}
          </button>
        </div>;
    }
    return <div className={list ? "crop-list" : "crop-overview-grid"}>
        {crops.map(crop => {
        const farm = data.farms?.find(item => item.id === crop.farm_id);
        return <article className={`crop-record ${list ? "list-record" : ""}`} key={crop.id}>
              <span className="badge growing">
                {pair("Growing", tamilText("Growing"))}
              </span>

              <img className="silver-photo" src={crop.image_url || growingImage(varietyName(crop.variety_id))} alt={varietyName(crop.variety_id)} loading="lazy" onError={event => {
            const image = event.currentTarget;
            if (!image.dataset.fallback) {
              image.dataset.fallback = "1";
              image.src = "/images/millet-harvest.png";
            }
          }} />

              <div className="crop-record-body">
                <h3>
                  {varietyName(crop.variety_id)}
                </h3>

                <p className="crop-farm">
                  {farm?.name}
                </p>

                {list && farm?.area_acres && <p className="icon-text">
                      <Icon name="location" size={15} />

                      {pair("Farm area", tamilText("Farm area"))}
                      : {farm.area_acres}{" "}

                      {pair("acres", tamilText("acres"))}
                    </p>}

                <p className="icon-text">
                  <Icon name="calendar" size={15} />

                  {ui("planting_date")}:{" "}
                  {crop.planting_date}
                </p>

                <p className="stage-strip">
                  <Icon name="leaf" size={18} />

                  {crop.growth_stage}
                </p>

                {list && <div className="crop-extra">
                    <span>
                      {ui("soil_type")}:{" "}
                      {crop.soil_type}
                    </span>

                    <span>
                      {ui("irrigation_method")}
                      :{" "}
                      {crop.irrigation_method}
                    </span>
                  </div>}

                <div className="crop-actions">
                  <button className="btn outline small" onClick={() => setSelected({
                ...crop,
                variety_name: varietyName(crop.variety_id)
              })}>
                    {ui("details")}

                    <Icon name="arrow" size={13} />
                  </button>

                  <button className="btn red small" onClick={() => openEditor("crop", crop)}>
                    <Icon name="edit" size={13} />

                    {ui("edit")}
                  </button>

                  <label className={`text-button photo-upload ${busy ? "disabled" : ""}`}>
                    <Icon name="upload" size={14} />

                    {ui(crop.image_url ? "change" : "upload")}

                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    updatePhoto(crop, file);
                  }
                }} />
                  </label>

                  {crop.image_url && <button className="text-button" disabled={busy} onClick={() => updatePhoto(crop, null, true)}>
                      {ui("remove")}
                    </button>}
                </div>
              </div>
            </article>;
      })}
      </div>;
  }
  function premiumBanner() {
    return <section className="premium-banner">
        <div>
          <p className="premium-label">
            <Icon name="crown" size={22} />

            {pair("Farmer Premium", tamilText("Farmer Premium"))}
          </p>

          <h2>
            {pair(<>
                One subscription.
                <br />
                All your crops.
              </>, <>{tamilText("One subscription.")}<br />{tamilText("All your crops.")}</>)}
          </h2>

          <ul>
            <li>
              <Icon name="leaf" size={16} />

              {pair("Additional AI guidance", tamilText("Additional AI guidance"))}
            </li>

            <li>
              <Icon name="calendar" size={16} />

              {pair("SMS care reminders", tamilText("SMS crop-care reminders"))}
            </li>

            <li>
              <Icon name="shield" size={16} />

              {pair("Priority support", tamilText("Priority support"))}
            </li>
          </ul>

          <button className="btn red" onClick={() => go("Premium")}>
            {pair("View plan", tamilText("View plan"))}

            <Icon name="arrow" size={16} />
          </button>

          {coming("Planned feature", tamilText("Planned feature"))}
        </div>

        <img src="/images/premium-millet.png" alt="" aria-hidden="true" />
      </section>;
  }
  function reminderPanel() {
    const preview = viewTab !== "Reminders";
    return <section className="panel botanical-panel">
      {sectionTitle(
        "calendar",
        pair("Upcoming Tasks", tamilText("Upcoming Tasks")),
        pair("Keep your farm on track with care tasks.", tamilText("Keep your farm on track with care tasks.")),
        preview ? <button type="button" className="text-button" onClick={() => go("Reminders")}>
          {pair("View reminders", tamilText("View reminders"))} →
        </button> : null,
      )}
      <CropReminders crops={data.crops} varietyName={varietyName} lang={lang} preview={preview} onChanged={() => setCalendarRevision((value) => value + 1)} />
    </section>;
  }
  function adminOverview() {
    return <>
        <div className="summary-grid admin-summary">
          {stat("grain", ui("pending_harvests"), data.summary?.pending_harvests)}

          {stat("leaf", ui("total_crops"), data.summary?.total_crops)}

          {stat("people", ui("total_farmers"), data.summary?.total_farmers)}

          {stat("cart", ui("total_buyers"), data.summary?.total_buyers)}
        </div>

        <section className="panel sales-panel">
          {sectionTitle("bars", pair("Sales Overview", tamilText("Sales Overview")), pair("Sales reporting", tamilText("Sales reporting")), coming())}

          <div className="chart-placeholder">
            <Icon name="bars" size={42} />

            <p>
              {pair("Sales and payment reporting will appear after orders and payments are connected.", tamilText("Sales and payment reporting will appear after orders and payments are connected."))}
            </p>
          </div>
        </section>

        <section className="panel">
          {sectionTitle("grain", pair("Harvest Verification", tamilText("Harvest Verification")), pair("Review farmer harvest submissions.", tamilText("Review farmer harvest submissions.")), <button className="text-button" onClick={() => go("Review")}>
              {pair("View all", tamilText("All Millets"))}{" "}
              →
            </button>)}

          {harvestTable((data.harvests || []).slice(0, 5), true)}
        </section>

        <AdminStock lang={lang} compact onOpen={() => go("Stock")} />

        <section className="panel">
          {sectionTitle("payment", pair("Farmer Settlements", tamilText("Farmer Settlements")), pair("Payment records for accepted harvests.", tamilText("Payment records for accepted harvests.")), coming())}

          <p className="future-message">
            {pair("Farmer payment tracking is planned.", tamilText("Farmer payment tracking is planned."))}
          </p>
        </section>
      </>;
  }
  function buyerShop() {
    return <BuyerShop key={user.id} user={user} lang={lang} view="shop"
      onCart={() => go("Cart")} onOrders={() => go("Orders")} />;
  }
  const banners = {
    Crops: ["My Crops", tamilText("My Crops"), "Manage your crops and track their progress.", tamilText("Manage your crops and track their progress.")],
    Harvests: ["Track your harvests.", tamilText("Review status and details for all your millet harvests."), "Review status and details for all your millet harvests.", tamilText("Review status and details for all your millet harvests.")],
    Health: ["Crop Health Checks", tamilText("Photo-assisted guidance for your crops."), "Photo-assisted guidance for your crops.", tamilText("Photo-assisted guidance for your crops.")],
    Reminders: ["My Reminders", tamilText("Your crop care, planned by date."), "Your crop care, planned by date.", tamilText("Your crop care, planned by date.")],
    Premium: ["A little more support. Every growing season.", tamilText("Additional guidance and reminders for your farm."), "Additional guidance and reminders for your farm.", tamilText("Additional guidance and reminders for your farm.")],
    Cart: ["Your next good choice.", tamilText("Quality millets for a healthier tomorrow."), "Quality millets for a healthier tomorrow.", tamilText("Quality millets for a healthier tomorrow.")],
    Orders: ["From our farm community to your table.", tamilText("Your millet orders, together in one place."), "Your millet orders, together in one place.", tamilText("Your millet orders, together in one place.")]
  };
  if (!user) {
    return <main className="wrap section">
        <p role={error ? "alert" : "status"}>
          {loading ? t("loading") : error}
        </p>

        <Link className="btn green space-top" to="/login">
          {pair("Sign in", tamilText("Sign in"))}
        </Link>
      </main>;
  }
  const isBuyer = user.role === "buyer";
  const isAdmin = user.role === "admin";
  const viewTab = isBuyer && tab === "Overview" ? "Public" : tab;
  const banner = banners[viewTab];
  return <div className={`site dashboard pdf-dashboard mp-wine-theme dash-${user.role}`} lang={lang}>
      <MilletPageTheme />
      <header className="site-header">
        <div className="wrap header-row">
          <Link className="brand" to="/">
            <img src="/images/logo.png" alt="Millet Plus" />
          </Link>

          {isAdmin && <strong className="admin-header-label">
              {pair("Admin Dashboard", tamilText("Admin Dashboard"))}
            </strong>}

          <button className="menu-button" aria-label="Menu" aria-expanded={menu} aria-controls="dash-nav" onClick={() => setMenu(!menu)}>
            <Icon name={menu ? "close" : "menu"} />
          </button>

          <nav id="dash-nav" className={`nav dashboard-nav ${menu ? "open" : ""}`}>
            {tabs.map(key => <button key={key} className={`nav-tab ${viewTab === key ? "active" : ""}`} onClick={() => go(key)} aria-current={viewTab === key ? "page" : undefined}>
                <Icon name={tabIcons[key]} size={15} />

                {navLabel(key)}
              </button>)}
          </nav>

          <div className="dash-account-actions">
            <button className="logout-button" onClick={() => setLang(lang === "en" ? "ta" : "en")}>{tamilText("EN | Tamil")}</button>

            <button className="dash-avatar" aria-label={lang === "ta" ? tamilText("Profile") : "Profile"} onClick={() => go("Profile")}>
              {user.name.slice(0, 1)}
            </button>

            <button className="logout-button" onClick={logout}>
              <Icon name="logout" size={14} />

              {ui("logout")}
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main" data-section={viewTab}>
        <DashboardBanner role={user.role} tab={viewTab} name={user.name} lang={lang} title={banner ? pair(banner[0], banner[1]) : undefined} description={banner ? pair(banner[2], banner[3]) : undefined} />

        <div className="dashboard-content">
          {error && <p className="alert error" role="alert">
              {error}
            </p>}

          {notice && <p className="alert success" role="status">
              {ui(notice)}
            </p>}

          {loading ? <p className="state" role="status">
              {ui("loading")}
            </p> : <>
              {viewTab === "Overview" && (isAdmin ? adminOverview() : <>
                    {user.role === "farmer" && <FarmWeather farms={data.farms} lang={lang} />}

                    <div className="summary-grid">
                      {stat("leaf", ui("Crops"), data.summary?.total_crops, pair("Crop records", tamilText("Crop records")))}

                      {stat("grain", ui("Harvests"), data.summary?.total_harvests, pair("Harvest records", tamilText("Harvest records")))}

                      {stat("calendar", pair("Upcoming Tasks", tamilText("Upcoming Tasks")), "—", pair("Coming soon", tamilText("Coming soon")))}
                    </div>

                    <section className="panel">
                      {sectionTitle("leaf", ui("Crops"), pair("Your millet crops and their current status.", tamilText("Your millet crops and their current status.")), <button className="btn red small" onClick={() => {
                go("Crops");
                openEditor("crop");
              }}>
                          <Icon name="plus" size={14} />

                          {pair("Add Crop", tamilText("Add Crop"))}
                        </button>)}

                      {cropGrid(data.crops?.slice(0, 2))}
                    </section>

                    {premiumBanner()}
                    {reminderPanel()}
                  </>)}

              {viewTab === "Crops" && <>
                  <div className="page-actions">
                    <button className="btn red" onClick={() => openEditor("crop")}>
                      <Icon name="plus" size={16} />

                      {pair("Add Crop", tamilText("Add Crop"))}
                    </button>

                    <button className="btn outline" onClick={() => go("Farms")}>
                      <Icon name="location" size={16} />

                      {ui("Farms")}
                    </button>

                    <button className="text-button" onClick={() => load()}>
                      {ui("refresh")}
                    </button>
                  </div>

                  <CropCareAdvice crops={data.crops} varietyName={varietyName} lang={lang}
                    onChanged={() => setCalendarRevision((value) => value + 1)} />
                  {cropGrid(data.crops, true)}

                  {!data.crops?.length && <p className="caption">
                      {ui("needsFarm")}
                    </p>}

                  {editor?.kind === "crop" && !editor.record && <Editor editor={editor} t={t} ui={ui} inline onClose={() => setEditor(null)} onSave={saveRecord} />}
                </>}

              {viewTab === "Farms" && <>
                  <div className="page-actions">
                    <button className="btn red" onClick={() => openEditor("farm")}>
                      <Icon name="plus" size={16} />

                      {ui("Farms")}
                    </button>

                    <button className="btn outline" onClick={() => go("Crops")}>
                      {ui("Crops")}
                    </button>
                  </div>

                  <div className="farm-grid">
                    {data.farms?.map(farm => <article className="panel botanical-panel" key={farm.id}>
                          {sectionTitle("location", farm.name)}

                          <p>
                            {farm.location}
                            ,{" "}
                            {farm.district}
                          </p>

                          <p>
                            {ui("area_acres")}
                            :{" "}
                            {farm.area_acres}
                          </p>

                          <button className="btn outline space-top" onClick={() => openEditor("farm", farm)}>
                            <Icon name="edit" size={15} />

                            {ui("edit")}
                          </button>
                        </article>)}
                  </div>

                  {!data.farms?.length && <p className="state">
                      {ui("empty")}
                    </p>}
                </>}

              {viewTab === "Harvests" && <>
                  <div className="summary-grid">
                    {stat("grain", pair("Total harvested", tamilText("Total harvested")), `${(data.harvests || []).reduce((sum, harvest) => sum + Number(harvest.total_quantity_kg || 0), 0).toLocaleString("en-LK", {
                maximumFractionDigits: 2
              })} kg`, pair("In loaded harvest records", tamilText("In loaded harvest records")))}

                    {stat("clock", ui("pending_harvests"), data.summary?.pending_harvests)}

                    {stat("check", pair("Approved", tamilText("Approved")), (data.harvests || []).filter(harvest => harvest.status === "approved").length, pair("In loaded records", tamilText("In loaded records")))}
                  </div>

                  <div className="center-action">
                    <button className="btn red" onClick={() => openEditor("harvest")}>
                      <Icon name="plus" size={16} />

                      {pair("Add Harvest", tamilText("Add Harvest"))}
                    </button>
                  </div>

                  <section className="panel">
                    {sectionTitle("grain", pair("Your Harvests", tamilText("Your Harvests")), ui("pendingNote"))}

                    {harvestTable()}
                  </section>

                  {selected && <section className="panel harvest-expanded">
                      <button className="detail-close" aria-label={t("close")} onClick={() => setSelected(null)}>
                        ×
                      </button>

                      <img className="silver-photo" src={photoFor(selected)} alt="" />

                      <div>
                        <h2>
                          {selected.variety_name || cropName(selected.crop_cycle_id)}
                        </h2>

                        <p>
                          {selected.harvest_date}
                        </p>

                        <div className="harvest-detail-values">
                          <strong>
                            {selected.total_quantity_kg}{" "}
                            kg
                          </strong>

                          <span className={`badge ${selected.status}`}>
                            {ui(selected.status)}
                          </span>
                        </div>

                        {selected.notes && <p>
                            {selected.notes}
                          </p>}

                        {selected.review_note && <p className="review-note">
                            {selected.review_note}
                          </p>}

                        <div className="status-timeline">
                          <span className="timeline-dot" />

                          {pair("Harvest submitted", tamilText("Harvest submitted"))}

                          <span className={`timeline-dot ${selected.status === "approved" ? "done" : ""}`} />

                          {ui(selected.status)}
                        </div>
                      </div>
                    </section>}
                </>}

              {viewTab === "Review" && <section className="panel">
                  {sectionTitle("grain", ui("Review"), pair("Review details before publishing a harvest.", tamilText("Review details before publishing a harvest.")), <button className="btn outline small" onClick={() => load()}>
                      {ui("refresh")}
                    </button>)}

                  {harvestTable(data.harvests, true)}
                </section>}

              {viewTab === "Public" && buyerShop()}

              {isBuyer && viewTab === "Cart" && <BuyerShop
                key={user.id} user={user} lang={lang} view="cart"
                onOrders={() => go("Orders")} />}

              {viewTab === "Orders" && (isBuyer || isAdmin) &&
                <OrdersPanel key={user.id} role={user.role} lang={lang} />}

              {viewTab === "Premium" && <section className="premium-page">
                  <div>
                    <h2>
                      {pair("One subscription. All your crops.", tamilText("One subscription. All your crops."))}
                    </h2>

                    <p>
                      {pair("More support for every growing season.", tamilText("More support for every growing season."))}
                    </p>

                    {[["leaf", "Additional AI guidance", tamilText("Additional AI guidance")], ["calendar", "SMS crop-care reminders", tamilText("SMS crop-care reminders")], ["shield", "Priority support", tamilText("Priority support")]].map(([icon, en, ta]) => <div className="premium-benefit" key={icon}>
                          <span className="round-icon">
                            <Icon name={icon} />
                          </span>

                          <h3>
                            {pair(en, ta)}
                          </h3>
                        </div>)}
                  </div>

                  <aside className="premium-plan-card">
                    <Icon name="crown" size={35} />

                    <h2>
                      {pair("Farmer Premium", tamilText("Farmer Premium"))}
                    </h2>

                    <p>
                      {pair("Plan details will be announced.", tamilText("Plan details will be announced."))}
                    </p>

                    {coming()}

                    <button className="btn red full" disabled>
                      {pair("Subscription opens soon", tamilText("Subscription opens soon"))}
                    </button>
                  </aside>
                </section>}

              {viewTab === "Reminders" && <>
                <ReminderCalendar revision={calendarRevision} lang={lang} />
                {reminderPanel()}
              </>}

              {viewTab === "Health" && <section className="panel botanical-panel">
                {sectionTitle("heart", pair("New Health Check", tamilText("New Health Check")), pair("Upload a crop photo and describe symptoms.", tamilText("Upload a crop photo and describe symptoms.")))}
                <CropHealthCheck crops={data.crops} varietyName={varietyName} lang={lang} />
              </section>}

              {viewTab === "Varieties" && <>
                  <div className="page-actions">
                    <button className="btn red" onClick={() => openEditor("variety")}>
                      <Icon name="plus" size={16} />

                      {ui("Varieties")}
                    </button>
                  </div>

                  <div className="farm-grid">
                    {data.varieties?.map(variety => <article className="panel botanical-panel" key={variety.id}>
                          <img className="silver-photo small-photo" src={varietyImage(variety.name)} alt="" />

                          <h3>
                            {variety.name}
                          </h3>

                          <p>
                            {variety.market_price_per_kg == null ? t("referenceMissing") : `LKR ${variety.market_price_per_kg} / kg`}
                          </p>

                          <button className="btn outline space-top" onClick={() => openEditor("variety", variety)}>
                            {ui("edit")}
                          </button>
                        </article>)}
                  </div>
                </>}

              {viewTab === "Profile" && <section className="panel profile-panel">
                  <span className="avatar">
                    {user.name.slice(0, 1)}
                  </span>

                  <h2>{user.name}</h2>

                  <dl className="detail-list">
                    {["email", "phone", "role", "is_active", "sms_opt_in"].map(key => <div key={key}>
                          <dt>
                            {ui(key)}
                          </dt>

                          <dd>
                            {key === "role" ? t(user[key]) : typeof user[key] === "boolean" ? t(user[key] ? "yes" : "no") : user[key] || "—"}
                          </dd>
                        </div>)}
                  </dl>

                  <p className="muted">
                    {ui("smsNote")}
                  </p>

                  <button className="btn red space-top" onClick={() => openEditor("profile", user)}>
                    {ui("edit")}
                  </button>
                </section>}

              {isAdmin && viewTab === "Stock" && <AdminStock lang={lang} />}

              {["Payments", "Users", "Plans", "Reports"].includes(viewTab) && <section className="panel botanical-panel">
                  {sectionTitle(tabIcons[viewTab], navLabel(viewTab), pair("Millet Plus management", tamilText("Millet Pulse management")), coming())}

                  <div className="empty-panel">
                    <Icon name={tabIcons[viewTab]} size={55} />

                    <h3>
                      {pair("This feature is planned for the next phase.", tamilText("This feature is planned for the next phase."))}
                    </h3>


                  </div>
                </section>}
            </>}
        </div>
      </main>

      <footer className="mp-footer">
        <div className="mp-container">
          <div className="mp-footer-grid">
            <div>
              <Link className="mp-footer-logo" to="/">
                <img src="/images/logo.png" alt="Millet Plus" />
              </Link>

              <p>
                {pair("Helping millet farmers care for crops and share harvest information.", tamilText("Helping millet farmers care for crops and share harvest information."))}
              </p>

              <strong>
                {ui("footer")}
              </strong>
            </div>

            <div>
              <h2>
                EXPLORE MILLET PLUS
              </h2>

              <Link to="/">
                {pair("Home", tamilText("Home"))}
              </Link>

              <Link to="/#about">
                {pair("About", tamilText("About"))}
              </Link>

              <Link to="/#harvests">
                {pair("Harvests", tamilText("Harvests"))}
              </Link>

              <p>{tamilText("English / Tamil")}</p>
            </div>
          </div>

          <div className="mp-footer-bottom">
            <span>
              ©{" "}
              {new Date().getFullYear()}{" "}
              Millet Plus
            </span>

            <span>
              {pair("Growing together, season after season.", tamilText("Growing together, season after season."))}
            </span>
          </div>
        </div>
      </footer>

      {editor && !(viewTab === "Crops" && editor.kind === "crop" && !editor.record) && <Editor key={`${editor.kind}-${editor.record?.id || "new"}`} editor={editor} t={t} ui={ui} onClose={() => setEditor(null)} onSave={saveRecord} />}

      {selected && viewTab !== "Harvests" && <Modal title={ui("details")} t={t} onClose={() => setSelected(null)}>
            {isBuyer ? publicStockDetails(selected.id) : <dl className="detail-list">
              {Object.entries(selected).filter(([key]) => !key.includes("public_id") && key !== "image_url").map(([key, value]) => <div key={key}>
                      <dt>
                        {ui(key)}
                      </dt>

                      <dd>
                        {value == null ? "—" : typeof value === "boolean" ? t(value ? "yes" : "no") : key === "status" ? t(value) : String(value)}
                      </dd>
                    </div>)}
            </dl>}
          </Modal>}
    </div>;
}
function DashboardBanner({
  role = "farmer",
  tab = "Overview",
  name = "",
  lang = "en",
  title,
  description
}) {
  const say = (en, ta) => lang === "ta" ? ta : en;
  const farmerBanners = { Crops: "crops", Harvests: "harvests", Health: "health", Reminders: "reminders" };
  const kind = role === "buyer" ? "buyer" : role === "admin" ? "admin" : farmerBanners[tab] || "farmer";
  const date = new Intl.DateTimeFormat(lang === "ta" ? "ta-LK" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date());
  const images = {
    farmer: "/images/banner-farmer.png",
    crops: "/images/banner-crops.png",
    harvests: "/images/banner-harvests.png",
    admin: "/images/banner-admin.png",
    health: "/images/crop-finger-growing.png",
    reminders: "/images/banner-crops.png"
  };
  const copy = {
    health: [title, description],
    reminders: [title, description],
    farmer: [say(`Welcome, ${name}`, tamilText("Welcome, {value0}", [name])), say("Your millet farm, organised in one place.", tamilText("Your millet farm, organised in one place."))],
    admin: [say(`Welcome, ${name}!`, tamilText("Welcome, {value0}!", [name])), say("Manage millets. Support farmers. Build a healthier tomorrow.", tamilText("Manage millets. Support farmers. Build a healthier tomorrow."))],
    buyer: [<>
        {say("Good grains.", tamilText("Good grains."))}

        <br />

        {say("Better choices.", tamilText("Better choices."))}
      </>, say("Explore current stock and selling prices from Millet Plus.", tamilText("Explore current stock and selling prices from Millet Pulse."))],
    crops: [say("My Crops", tamilText("My Crops")), say("Manage your crops and track their progress.", tamilText("Manage your crops and track their progress."))],
    harvests: [<>
        {say("Track your", tamilText("Track your"))}

        <br />

        {say("harvests.", tamilText("harvests."))}
      </>, say("Review status and details for all your millet harvests.", tamilText("Review status and details for all your millet harvests."))]
  };
  const otherTab = !["Overview", "Public", "Crops", "Harvests"].includes(tab);
  return <section className={`dashboard-banner unique-banner unique-banner-${kind}`} style={kind !== "buyer" ? {
    "--unique-banner-image": `url("${images[kind]}")`
  } : undefined}>
      <div className="unique-banner-inner">
        <div className="unique-banner-copy">
          {kind === "farmer" && <p className="unique-banner-date">
              {date}
            </p>}

          {kind === "harvests" && <p className="unique-banner-eyebrow">
              {say("MY HARVESTS", tamilText("MY HARVESTS"))}
            </p>}

          <h1>
            {otherTab && title ? title : copy[kind][0]}
          </h1>

          <p className="unique-banner-description">
            {otherTab && description ? description : copy[kind][1]}
          </p>

          {kind === "farmer" && !otherTab && <span className="unique-banner-pill">
                <span aria-hidden="true">
                  ❧
                </span>

                {say("Grow smarter. Healthier crops. Better harvests.", tamilText("Grow smarter. Healthier crops. Better harvests."))}
              </span>}

          {kind === "crops" && <div className="unique-banner-meta">
              <span>
                <span aria-hidden="true">
                  ▦
                </span>

                {date}
              </span>

              <span>
                {say("Keep track, plan better, harvest smarter.", tamilText("Keep track, plan better, harvest smarter."))}
              </span>
            </div>}

          {kind === "admin" && !otherTab && <div className="unique-banner-values">
                {[["❧", "Support farmers", tamilText("Support farmers")], ["✓", "Review harvests", tamilText("Review harvests")], ["♧", "Grow communities", tamilText("Grow communities")]].map(([symbol, en, ta]) => <span key={en}>
                      <i aria-hidden="true">
                        {symbol}
                      </i>

                      {say(en, ta)}
                    </span>)}
              </div>}
        </div>

        {kind === "admin" && <span className="unique-banner-date-chip">
            ▦ {date}
          </span>}

        {kind === "crops" && <p className="unique-banner-quote">
            Healthy
            <br />
            Crops
            <br />
            Brighter
            <br />
            Tomorrows
          </p>}

        {kind === "admin" && <p className="unique-banner-admin-quote">
            Good food.
            <br />
            Brighter futures.
          </p>}

        {kind === "buyer" && <>
            <img className="unique-banner-art" src="/images/banner-buyer-grain-red.png" alt="" aria-hidden="true" />

            <p className="unique-banner-buyer-quote">
              Nourishing
              <br />
              People
              <br />
              Nurturing
              <br />
              Tomorrows
            </p>

            <span className="unique-banner-botanical" aria-hidden="true">
              ❧
            </span>
          </>}
      </div>
    </section>;
}
function Dual({
  lang,
  en,
  ta
}) {
  return <span className="mp-copy-stack">
      <span className={`mp-copy-layer ${lang === "en" ? "is-visible" : ""}`} aria-hidden={lang !== "en"} lang="en">
        {en}
      </span>

      <span className={`mp-copy-layer ${lang === "ta" ? "is-visible" : ""}`} aria-hidden={lang !== "ta"} lang="ta">
        {ta}
      </span>
    </span>;
}
const ICON_PATHS = {
  leaf: <path d="M12 22V12M12 15C4 16 2 10 3 4c7-1 10 3 9 10M12 17c0-8 4-12 10-12 1 7-3 11-10 12" />,
  grain: <path d="M12 23V5M12 8C7 8 5 5 6 2c4 0 6 3 6 6m0 5c-5 0-8-3-7-6 4 0 7 2 7 6m0 5c-6 0-8-3-7-6 4 0 7 2 7 6m0-10c5 0 7-3 6-6-4 0-6 3-6 6m0 5c5 0 8-3 7-6-4 0-7 2-7 6m0 5c6 0 8-3 7-6-4 0-7 2-7 6" />,
  people: <>
      <circle cx="12" cy="7" r="3" />

      <circle cx="4" cy="9" r="2" />

      <circle cx="20" cy="9" r="2" />

      <path d="M7 22v-6a5 5 0 0 1 10 0v6M1 21v-5a3 3 0 0 1 4-3m18 8v-5a3 3 0 0 0-4-3" />
    </>,
  bars: <path d="M4 22V13h4v9M10 22V8h4v14M16 22V2h4v20" />,
  cart: <>
      <path d="M2 3h3l3 13h11l3-9H6" />

      <circle cx="9" cy="20" r="1" />

      <circle cx="18" cy="20" r="1" />
    </>,
  home: <path d="m2 11 10-9 10 9M5 9v13h14V9M10 22v-8h4v8" />,
  calendar: <>
      <rect x="3" y="5" width="18" height="17" rx="2" />

      <path d="M7 2v6m10-6v6M3 11h18m-13 4h1m3 0h1m3 0h1m-9 4h1m3 0h1" />
    </>,
  heart: <>
      <path d="M20 13 12 22 4 13C-3 5 7-1 12 6c5-7 15-1 8 7" />

      <path d="M2 12h6l2-4 3 8 2-4h7" />
    </>,
  crown: <path d="m2 5 5 5 5-8 5 8 5-5-3 14H5zM5 23h14" />,
  user: <>
      <circle cx="12" cy="7" r="4" />

      <path d="M3 23v-3a9 9 0 0 1 18 0v3" />
    </>,
  box: <path d="m12 2 10 5v12l-10 5-10-5V7zM2 7l10 5 10-5M12 12v12M7 4l10 5" />,
  orders: <>
      <rect x="4" y="3" width="16" height="20" rx="2" />

      <path d="M8 8h8m-8 5h8m-8 5h5" />
    </>,
  payment: <>
      <rect x="2" y="5" width="20" height="15" rx="2" />

      <path d="M2 10h20M6 16h4" />
    </>,
  shield: <path d="m12 2 9 4v7c0 5-5 8-9 11-4-3-9-6-9-11V6zM7 13l3 3 7-8" />,
  check: <path d="m4 12 5 5L21 5" />,
  clock: <>
      <circle cx="12" cy="12" r="10" />

      <path d="M12 5v8l5 3" />
    </>,
  location: <>
      <path d="M20 10c0 6-8 13-8 13S4 16 4 10a8 8 0 0 1 16 0Z" />

      <circle cx="12" cy="10" r="3" />
    </>,
  plus: <path d="M12 3v18M3 12h18" />,
  arrow: <path d="M2 12h19m-6-6 6 6-6 6" />,
  edit: <path d="m3 16 13-13 5 5L8 21l-6 1zM14 5l5 5" />,
  upload: <path d="M12 17V2M6 8l6-6 6 6M3 16v7h18v-7" />,
  search: <>
      <circle cx="10" cy="10" r="7" />

      <path d="m15 15 7 7" />
    </>,
  logout: <path d="M9 3H3v18h6M9 12h13m-5-5 5 5-5 5" />,
  cloud: <>
      <path d="M6 19a5 5 0 1 1 1-10 7 7 0 0 1 13 2 4 4 0 1 1 0 8Z" />

      <path d="m8 22-1 2m7-2-1 2m7-2-1 2" />
    </>,
  sun: <>
      <circle cx="12" cy="12" r="5" />

      <path d="M12 0v3m0 18v3M0 12h3m18 0h3M3 3l2 2m14 14 2 2M3 21l2-2M19 5l2-2" />
    </>,
  menu: <path d="M3 5h18M3 12h18M3 19h18" />,
  close: <path d="m5 5 14 14M5 19 19 5" />
};
function Icon({
  name = "leaf",
  size = 22,
  className = ""
}) {
  return <svg className={`mp-icon ${className}`} width={size} height={size} viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name] || ICON_PATHS.leaf}
    </svg>;
}
