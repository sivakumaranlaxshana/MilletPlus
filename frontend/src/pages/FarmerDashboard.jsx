import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest, dashboardPath } from "../api";
import { tamilText } from "../translations";
import { useSharedLanguage } from "../translations/language";
import { Icon } from "./LandingPage";
import FarmWeather from "../components/FarmWeather";
import { AdviceForCrop } from "../components/CropCareAdvice";
import { HealthCheckForCrop } from "../components/CropHealthCheck";
import FarmerSubscription from "../components/FarmerSubscription";
import AddCropReminder from "../components/AddCropReminder";
import FARMER_TEXT from "../translations/tamil";
import "./FarmerDashboard.css";

async function allRows(path, signal) {
  const result = [];
  const seen = new Set();
  for (let offset = 0; offset < 10000; offset += 100) {
    const batch = await apiRequest(`${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`, { signal });
    if (!Array.isArray(batch)) throw new Error("Could not read the saved records.");
    for (const row of batch) {
      if (seen.has(String(row.id))) throw new Error("Could not load all records. Please refresh.");
      seen.add(String(row.id));
      result.push(row);
    }
    if (batch.length < 100) return result;
  }
  throw new Error("Please contact support to load this many records.");
}

function message(error) {
  return error?.message || "Could not save your changes. Please try again.";
}

function photoFor(name) {
  const value = String(name).toLowerCase();
  if (value.includes("finger")) return "/images/finger-millet.png";
  if (value.includes("foxtail")) return "/images/foxtail-millet.png";
  if (value.includes("pearl")) return "/images/pearl-millet.png";
  if (value.includes("little")) return "/images/little-millet.png";
  return "/images/millet-harvest.png";
}

function Photo({ src, alt, className = "" }) {
  return <img className={`fd-photo ${className}`} src={src} alt={alt} loading="lazy"
    onError={(event) => {
      if (!event.currentTarget.dataset.fallback) {
        event.currentTarget.dataset.fallback = "1";
        event.currentTarget.src = "/images/millet-harvest.png";
      }
    }} />;
}

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function localParts(value) {
  const fields = Object.fromEntries(formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return { date: `${fields.year}-${fields.month}-${fields.day}`, time: `${fields.hour}:${fields.minute}` };
}
const SMS_TEXT = {
  disabled: "SMS off", queued: "SMS queued", sending: "Sending SMS…",
  sent: "SMS sent", failed: "SMS failed", skipped: "SMS skipped", unknown: "SMS outcome unknown",
};

function RecordEditor({ editor, farms, varieties, busy, t, onSave, onClose }) {
  const formRef = useRef(null);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const record = editor.record || {};
  const kind = editor.kind;
  const editing = Boolean(editor.record);
  const title = kind === "farm" ? (editing ? "Edit Farm" : "Add Farm")
    : kind === "crop" ? (editing ? "Edit Crop" : "Add Crop")
    : kind === "harvest" ? (editing ? "Edit Harvest" : "Add Harvest") : "My Profile";

  async function submit(event) {
    event.preventDefault();
    if (busy || locating) return;
    const form = new FormData(event.currentTarget);
    const text = (key) => String(form.get(key) ?? "").trim();
    const optionalNumber = (key) => text(key) === "" ? null : Number(text(key));
    let values;
    if (kind === "farm") {
      values = { name: text("name"), district: text("district"), location: text("location"),
        area_acres: Number(text("area_acres")), latitude: optionalNumber("latitude"), longitude: optionalNumber("longitude") };
      if ((values.latitude === null) !== (values.longitude === null)) {
        setError(t("Enter both latitude and longitude, or leave both empty."));
        return;
      }
    } else if (kind === "crop") {
      values = { variety_id: Number(text("variety_id")), planting_date: text("planting_date"),
        growth_stage: text("growth_stage"), soil_type: text("soil_type"), irrigation_method: text("irrigation_method") };
      if (!editing) values.farm_id = Number(editor.farmId);
    } else if (kind === "harvest") {
      values = { harvest_date: text("harvest_date"), total_quantity_kg: Number(text("total_quantity_kg")), notes: text("notes") || null };
      if (!editing) values.crop_cycle_id = Number(editor.cropId);
    } else {
      values = { name: text("name"), phone: text("phone"), sms_opt_in: form.has("sms_opt_in") };
    }
    setError("");
    try { await onSave(values); } catch (err) { setError(message(err)); }
  }

  function field(name, label, type = "text", options = {}) {
    return <label key={name}>{t(label)}<input name={name} type={type} defaultValue={record[name] ?? ""}
      required maxLength={100} {...options} /></label>;
  }

  function locate() {
    if (!navigator.geolocation) { setError(t("Location is unavailable. Enter coordinates manually.")); return; }
    const form = formRef.current;
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (formRef.current === form) {
        form.elements.namedItem("latitude").value = coords.latitude.toFixed(6);
        form.elements.namedItem("longitude").value = coords.longitude.toFixed(6);
        setLocating(false);
      }
    }, () => {
      if (formRef.current === form) {
        setError(t("Could not get your location. Allow permission or enter coordinates manually."));
        setLocating(false);
      }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  return <section className="fd-panel fd-editor">
    <div className="fd-section-heading"><h2>{t(title)}</h2><button className="fd-button fd-outline" type="button" disabled={busy || locating} onClick={onClose}>{t("Cancel")}</button></div>
    {kind === "crop" && <p className="fd-context">{t("Farm")}: {farms.find((f) => String(f.id) === String(editor.farmId || record.farm_id))?.name}</p>}
    {error && <p className="fd-alert fd-error" role="alert">{error}</p>}
    <form ref={formRef} onSubmit={submit}><fieldset disabled={busy || locating}>
      <div className="fd-form-grid">
        {kind === "farm" && <>
          {field("name", "Farm name")}{field("district", "District", "text", { maxLength: 50 })}
          {field("location", "Village / Location", "text", { maxLength: 255 })}
          {field("area_acres", "Area (acres)", "number", { min: 0.01, step: "any" })}
          {field("latitude", "Latitude", "number", { required: false, min: -90, max: 90, step: "any" })}
          {field("longitude", "Longitude", "number", { required: false, min: -180, max: 180, step: "any" })}
        </>}
        {kind === "crop" && <>
          <label>{t("Millet variety")}<select name="variety_id" required defaultValue={record.variety_id ?? ""}>
            <option value="">{t("Choose a variety")}</option>{varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          {field("planting_date", "Planting date", "date")}
          {field("growth_stage", "Growth stage", "text", { maxLength: 50 })}
          {field("soil_type", "Soil type", "text", { maxLength: 50 })}
          {field("irrigation_method", "Irrigation method", "text", { maxLength: 50 })}
        </>}
        {kind === "harvest" && <>
          {field("harvest_date", "Harvest date", "date")}
          {field("total_quantity_kg", "Quantity (kg)", "number", { min: 0.01, step: "any" })}
          <label className="fd-span-all">{t("Notes")}<textarea name="notes" rows={3} maxLength={2000} defaultValue={record.notes || ""} /></label>
        </>}
        {kind === "profile" && <>
          {field("name", "Full name")}{field("phone", "Mobile number", "tel", { maxLength: 30 })}
          <label className="fd-check fd-span-all"><input type="checkbox" name="sms_opt_in" defaultChecked={Boolean(record.sms_opt_in)} />{t("Allow SMS reminders to my profile number")}</label>
        </>}
      </div>
      {kind === "farm" && <div className="fd-location-help">
        <button type="button" className="fd-button fd-outline" onClick={locate}>{t(locating ? "Getting location…" : "Use my current location")}</button>
        <p>{t("Save your farm coordinates to see its weather forecast.")}</p>
      </div>}
      {kind === "crop" && !varieties.length && <p role="alert">{t("No varieties available. Ask the administrator to add one.")}</p>}
      <button className="fd-button fd-red" type="submit" disabled={busy || locating || (kind === "crop" && !varieties.length)}>
        {t(busy ? "Saving…" : kind === "farm" ? "Save Farm" : kind === "crop" ? "Save Crop" : kind === "harvest" ? "Submit Harvest" : "Save Profile")} →
      </button>
    </fieldset></form>
  </section>;
}

function ReminderList({ rows, crops, varietyName, loading, error, busy, t, onComplete, onReschedule, onRetry, emptyText }) {
  const [editing, setEditing] = useState(null);
  const [saveError, setSaveError] = useState("");
  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = `${form.get("date")}T${form.get("time")}:00+05:30`;
    if (!(Date.parse(value) > Date.now())) { setSaveError(t("Choose a future date and time.")); return; }
    setSaveError("");
    try { await onReschedule(editing, value); setEditing(null); } catch (err) { setSaveError(message(err)); }
  }
  return <>
    {loading && <p role="status">{t("Loading reminders…")}</p>}
    {error && <p role="alert">{t("Could not load reminders.")} <button className="fd-link" type="button" onClick={onRetry}>{t("Retry")}</button></p>}
    {!loading && !error && !rows.length && <div className="fd-empty"><Icon name="calendar" size={38} /><p>{t(emptyText || "No reminders yet.")}</p></div>}
    {!error && rows.length > 0 && <div className="fd-table-scroll"><table className="fd-table"><thead><tr>
      {["Task", "Crop", "Date / Time", "SMS status", "Actions"].map((h) => <th key={h}>{t(h)}</th>)}
    </tr></thead><tbody>{rows.map((row) => {
      const crop = crops.find((c) => String(c.id) === String(row.crop_cycle_id));
      const parts = localParts(row.remind_at);
      return <tr key={row.id}><td>{row.task}</td><td>{crop ? varietyName(crop.variety_id) : `#${row.crop_cycle_id}`}</td>
        <td>{parts.date}<small>{parts.time} · {t("Sri Lanka time")}</small></td>
        <td><span className={`fd-badge fd-sms-${row.sms_status}`}>{t(SMS_TEXT[row.sms_status] || "SMS status unavailable")}</span></td>
        <td>{row.status === "pending" ? <div className="fd-inline-actions">
          <button className="fd-button fd-outline fd-small" type="button" disabled={busy || editing !== null} onClick={() => { setEditing(row); setSaveError(""); }}>{t("Change time")}</button>
          <button className="fd-button fd-outline fd-small" type="button" disabled={busy || editing !== null} onClick={() => onComplete(row.id)}>{t("Mark Complete")}</button>
        </div> : t("Completed")}</td></tr>;
    })}</tbody></table></div>}
    {editing && <form className="fd-inline-editor" onSubmit={save}><h3>{editing.task}</h3><fieldset disabled={busy}>
      <div className="fd-form-grid"><label>{t("Reminder date")}<input type="date" name="date" required min={localParts(Date.now()).date} defaultValue={localParts(editing.remind_at).date} /></label>
      <label>{t("Time (Sri Lanka)")}<input type="time" name="time" required defaultValue={localParts(editing.remind_at).time} /></label></div>
      {saveError && <p role="alert" className="fd-alert fd-error">{saveError}</p>}
      <div className="fd-actions"><button className="fd-button fd-red" type="submit">{t("Save reminder")}</button><button className="fd-button fd-outline" type="button" onClick={() => setEditing(null)}>{t("Cancel")}</button></div>
    </fieldset></form>}
  </>;
}

export default function FarmerDashboard() {
  const navigate = useNavigate();
  const { lang, setLang } = useSharedLanguage();
  const t = (text) => lang === "ta" ? (FARMER_TEXT[text] || tamilText(text)) : text;
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("overview");
  const [editor, setEditor] = useState(null);
  const [farmId, setFarmId] = useState("");
  const [cropId, setCropId] = useState("");
  const [tool, setTool] = useState("advice");
  const [reminderStatus, setReminderStatus] = useState("pending");
  const [reminders, setReminders] = useState({ pending: [], completed: [], loading: true, error: false });
  const baseRequest = useRef(null);
  const reminderRequest = useRef(null);
  const mounted = useRef(true);
  const accountRef = useRef(null);

  const logout = useCallback(() => {
    sessionStorage.removeItem("millet_access_token");
    navigate("/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    apiRequest("/auth/me", { signal: controller.signal }).then((account) => {
      if (controller.signal.aborted) return;
      if (account.role !== "farmer") { navigate(dashboardPath(account.role), { replace: true }); return; }
      setUser(account);
    }).catch((err) => {
      if (controller.signal.aborted) return;
      if (err.status === 401) logout(); else { setError(message(err)); setLoading(false); }
    });
    return () => { mounted.current = false; controller.abort(); baseRequest.current?.abort(); reminderRequest.current?.abort(); };
  }, [logout, navigate]);

  const load = useCallback(async () => {
    baseRequest.current?.abort();
    const controller = new AbortController(); baseRequest.current = controller;
    setLoading(true); setError("");
    try {
      const [farms, crops, harvests, varieties] = await Promise.all([
        allRows("/farms", controller.signal), allRows("/crop-cycles", controller.signal),
        allRows("/harvests", controller.signal), allRows("/crop-varieties", controller.signal),
      ]);
      if (!controller.signal.aborted) setData({ farms, crops, harvests, varieties });
    } catch (err) {
      if (!controller.signal.aborted) { if (err.status === 401) logout(); else setError(message(err)); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [logout]);

  const loadReminders = useCallback(async () => {
    reminderRequest.current?.abort();
    const controller = new AbortController(); reminderRequest.current = controller;
    setReminders((prev) => ({ ...prev, loading: true, error: false }));
    try {
      const [pending, completed] = await Promise.all([
        allRows("/crop-reminders?status=pending", controller.signal),
        allRows("/crop-reminders?status=completed", controller.signal),
      ]);
      if (!controller.signal.aborted) setReminders({ pending, completed, loading: false, error: false });
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err.status === 401) logout();
        setReminders((prev) => ({ ...prev, loading: false, error: true }));
      }
    }
  }, [logout]);

  useEffect(() => { if (user) { load(); loadReminders(); } }, [user?.id, load, loadReminders]);

  const farms = data?.farms || [];
  const crops = data?.crops || [];
  const harvests = data?.harvests || [];
  const varieties = data?.varieties || [];
  const farm = farms.find((item) => String(item.id) === farmId) || farms[0];
  const crop = crops.find((item) => String(item.id) === cropId);
  const varietyName = (id) => varieties.find((item) => String(item.id) === String(id))?.name || `#${id}`;
  const pending = reminders.pending;
  const shownCrops = farm ? crops.filter((item) => String(item.farm_id) === String(farm.id)) : [];

  function go(next) { setPage(next); setEditor(null); setNotice(""); setError(""); accountRef.current?.removeAttribute("open"); }
  function openCrop(item) { setCropId(String(item.id)); setTool("advice"); go("crop"); }
  function openEditor(kind, record = null) {
    if (kind === "crop" && !farm) { setError(t("Add a farm before adding a crop.")); return; }
    setEditor({ kind, record, farmId: kind === "crop" ? (record?.farm_id || farm?.id) : undefined, cropId: crop?.id });
    setNotice(""); setError("");
  }

  async function saveRecord(values) {
    if (busy) return;
    setBusy(true);
    try {
      const currentEditor = editor;
      const kind = currentEditor.kind;
      const paths = { farm: "/farms", crop: "/crop-cycles", harvest: "/harvests", profile: "/auth/me" };
      const path = paths[kind] + (currentEditor.record && kind !== "profile" ? `/${currentEditor.record.id}` : "");
      const record = await apiRequest(path, { method: currentEditor.record ? "PATCH" : "POST", body: JSON.stringify(values) });
      if (!mounted.current) return;
      baseRequest.current?.abort();
      setLoading(false);
      if (kind === "profile") { setUser(record); setPage("overview"); }
      else {
        const key = { farm: "farms", crop: "crops", harvest: "harvests" }[kind];
        setData((prev) => ({ ...prev, [key]: currentEditor.record
          ? prev[key].map((item) => item.id === record.id ? record : item) : [...prev[key], record] }));
      }
      setEditor(null);
      setNotice(t(kind === "farm" ? "Farm saved. You can now add a crop." : kind === "crop" ? "Crop saved to your dashboard." : "Saved successfully."));
      if (kind === "farm") { setFarmId(String(record.id)); setPage("overview"); }
      if (kind === "crop" && !currentEditor.record) setPage("overview");
    } finally { if (mounted.current) setBusy(false); }
  }

  async function updateReminder(id, body) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/crop-reminders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (mounted.current) { setNotice(t("Reminder updated.")); await loadReminders(); }
    } catch (err) { if (mounted.current) setError(message(err)); throw err; }
    finally { if (mounted.current) setBusy(false); }
  }

  async function updatePhoto(event, remove = false) {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = "";
    if (!crop || busy || (!remove && !file)) return;
    setError("");
    if (!remove && (!file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError(t("Choose a JPG, PNG or WebP crop photo up to 5 MB.")); return;
    }
    setBusy(true);
    try {
      const options = { method: remove ? "DELETE" : "PUT" };
      if (!remove) { options.body = new FormData(); options.body.append("file", file); }
      await apiRequest(`/crop-cycles/${crop.id}/image`, options);
      if (mounted.current) { setNotice(t("Saved successfully.")); await load(); }
    } catch (err) { if (mounted.current) setError(message(err)); }
    finally { if (mounted.current) setBusy(false); }
  }

  const reminderList = (rows, emptyText) => <ReminderList rows={rows} crops={crops} varietyName={varietyName}
    loading={reminders.loading} error={reminders.error} busy={busy} t={t} onRetry={loadReminders} emptyText={emptyText}
    onComplete={(id) => updateReminder(id, { status: "completed" }).catch(() => {})}
    onReschedule={(row, value) => updateReminder(row.id, { remind_at: value })} />;

  if (!user) return <main className="fd-dashboard fd-loading"><p role={error ? "alert" : "status"}>{error || t("Loading dashboard…")}</p>
    {error && <Link to="/login">{t("Sign in")}</Link>}</main>;

  return <div className="fd-dashboard" lang={lang}>
    <header className="fd-header"><div className="fd-wrap fd-header-inner">
      <Link to="/" aria-label="Millet Plus"><img className="fd-logo" src="/images/logo.png" alt="Millet Plus" /></Link>
      <details className="fd-account" ref={accountRef}><summary aria-label={t("Account menu")}><Icon name="user" size={23} /><span>⌄</span></summary>
        <div className="fd-account-menu">
          <strong>{user.name}</strong>
          <button type="button" disabled={busy} onClick={() => go("overview")}>{t("My Dashboard")}</button>
          <button type="button" disabled={busy} onClick={() => { go("profile"); setEditor({ kind: "profile", record: user }); }}>{t("My Profile")}</button>
          <button type="button" disabled={busy} onClick={() => go("subscription")}>{t("My Subscription")}</button>
          <button type="button" onClick={() => setLang(lang === "ta" ? "en" : "ta")}>{lang === "ta" ? "English" : "தமிழ்"}</button>
          <button type="button" disabled={busy} onClick={logout}>{t("Sign out")}</button>
        </div>
      </details>
    </div></header>
    <section className="fd-hero"><div className="fd-wrap">
      <p className="fd-date">{new Intl.DateTimeFormat(lang === "ta" ? "ta-LK" : "en-GB", { dateStyle: "full", timeZone: "Asia/Colombo" }).format(new Date())}</p>
      <h1>{t("Welcome")}, {user.name}</h1>
      <p className="fd-hero-subtitle">{t(farms.length ? "Your millet farm, organised in one place." : "Your farming journey starts here.")}</p>
      <span className="fd-hero-pill"><Icon name="leaf" size={16} />{t("Grow smarter. Healthier crops. Better harvests.")}</span>
    </div></section>
    <main className="fd-wrap fd-main">
      {error && <p className="fd-alert fd-error" role="alert">{error}</p>}
      {notice && <p className="fd-alert fd-success" role="status">{notice}</p>}
      {!data ? <section className="fd-panel"><p role="status">{loading ? t("Loading dashboard…") : t("Could not load dashboard.")}</p>{!loading && <button type="button" className="fd-button fd-outline" onClick={load}>{t("Retry")}</button>}</section>
      : <>
        {(editor || page !== "overview") && <button className="fd-button fd-outline fd-back" type="button" disabled={busy} onClick={() => go("overview")}>← {t("Back to Dashboard")}</button>}
        {editor ? <RecordEditor key={`${editor.kind}-${editor.record?.id || "new"}`} editor={editor} farms={farms} varieties={varieties} busy={busy} t={t} onSave={saveRecord} onClose={() => { setEditor(null); if (page === "profile") setPage("overview"); }} />
        : page === "subscription" ? <FarmerSubscription userId={user.id} t={t} />
        : page === "farms" ? <section className="fd-panel"><div className="fd-section-heading"><h2>{t("My Farms")}</h2><button className="fd-button fd-red" onClick={() => openEditor("farm")}>+ {t("Add Farm")}</button></div>
          <div className="fd-crop-grid">{farms.map((item) => <article className="fd-farm-card" key={item.id}><h3>{item.name}</h3><p>{item.location}, {item.district}</p><p>{item.area_acres} {t("acres")}</p><button className="fd-button fd-outline" onClick={() => openEditor("farm", item)}>{t("Edit Farm")}</button></article>)}</div>
        </section>
        : page === "reminders" ? <section className="fd-panel"><h2>{t("All Reminders")}</h2><div className="fd-actions"><button className={`fd-button ${reminderStatus === "pending" ? "fd-green" : "fd-outline"}`} onClick={() => setReminderStatus("pending")}>{t("Pending")}</button><button className={`fd-button ${reminderStatus === "completed" ? "fd-green" : "fd-outline"}`} onClick={() => setReminderStatus("completed")}>{t("Completed")}</button></div>{reminderList(reminders[reminderStatus])}</section>
        : page === "crop" && crop ? <>
          <section className="fd-panel fd-crop-summary"><Photo key={`${crop.id}-${crop.image_url}`} src={crop.image_url || photoFor(varietyName(crop.variety_id))} alt={varietyName(crop.variety_id)} />
            <div><h2>{varietyName(crop.variety_id)}</h2><p>{farms.find((f) => String(f.id) === String(crop.farm_id))?.name}</p><p>{t("Planting date")}: {crop.planting_date}</p><span className="fd-stage">{crop.growth_stage}</span><p>{crop.soil_type} · {crop.irrigation_method}</p></div>
            <div className="fd-actions"><button className="fd-button fd-outline" disabled={busy} onClick={() => openEditor("crop", crop)}>{t("Edit Crop")}</button>
              <label className="fd-button fd-outline fd-upload">{t("Change crop photo")}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={updatePhoto} /></label>
              {crop.image_url && <button className="fd-link" disabled={busy} onClick={() => updatePhoto(null, true)}>{t("Remove photo")}</button>}
            </div>
          </section>
          <div className="fd-crop-tools" role="tablist" aria-label={t("Crop tools")}>{[["advice", "AI Advice"], ["health", "Health Check"], ["harvest", "Harvest"], ["reminders", "Reminders"]].map(([key, label], index) => <button id={`fd-tab-${key}`} aria-controls={`fd-panel-${key}`} role="tab" aria-selected={tool === key} key={key} disabled={busy} onClick={() => setTool(key)}>{index + 1}. {t(label)}</button>)}</div>
          <section className="fd-panel fd-tool-panel" id={`fd-panel-${tool}`} role="tabpanel" aria-labelledby={`fd-tab-${tool}`}>
            {tool === "advice" && <><h2>{t("AI Advice")}</h2><AdviceForCrop key={crop.id} cropId={crop.id} lang={lang} onChanged={loadReminders} /></>}
            {tool === "health" && <><h2>{t("Health Check")}</h2><HealthCheckForCrop key={crop.id} cropId={crop.id} lang={lang} /></>}
            {tool === "harvest" && <><div className="fd-section-heading"><h2>{t("Harvest History")}</h2><button className="fd-button fd-red" onClick={() => openEditor("harvest")}>+ {t("Add Harvest")}</button></div>
              {harvests.filter((h) => String(h.crop_cycle_id) === String(crop.id)).length ? <div className="fd-table-scroll"><table className="fd-table"><thead><tr>{["Harvest date", "Quantity (kg)", "Status", "Actions"].map((h) => <th key={h}>{t(h)}</th>)}</tr></thead><tbody>{harvests.filter((h) => String(h.crop_cycle_id) === String(crop.id)).map((h) => <tr key={h.id}><td>{h.harvest_date}</td><td>{h.total_quantity_kg}</td><td>{t(h.status === "approved" ? "Approved" : h.status === "rejected" ? "Rejected" : "Pending")}</td><td>{h.status === "pending" && <button className="fd-button fd-outline fd-small" onClick={() => openEditor("harvest", h)}>{t("Edit")}</button>}</td></tr>)}</tbody></table></div> : <div className="fd-empty"><p>{t("No harvest records for this crop yet.")}</p></div>}
            </>}
            {tool === "reminders" && <><div className="fd-section-heading"><h2>{t("Crop Reminders")}</h2><button className="fd-button fd-outline" onClick={() => setTool("advice")}>{t("Open Advice History")}</button></div><p className="fd-muted">{t("Create a reminder from saved advice that has a task and suggested date.")}</p>
              <div className="fd-actions"><button className={`fd-button ${reminderStatus === "pending" ? "fd-green" : "fd-outline"}`} onClick={() => setReminderStatus("pending")}>{t("Pending")}</button><button className={`fd-button ${reminderStatus === "completed" ? "fd-green" : "fd-outline"}`} onClick={() => setReminderStatus("completed")}>{t("Completed")}</button></div>
              <AddCropReminder
                key={crop.id}
                cropId={crop.id}
                lang={lang}
                onSaved={async () => {
                  setReminderStatus("pending");
                  await loadReminders();
                }}
                onOpenAdvice={() => setTool("advice")}
              />
              {reminderList(reminders[reminderStatus].filter((row) => String(row.crop_cycle_id) === String(crop.id)))}
            </>}
          </section>
          {tool !== "reminders" && <div className="fd-next"><button className="fd-button fd-outline" onClick={() => setTool({ advice: "health", health: "harvest", harvest: "reminders" }[tool])}>{t({ advice: "Next: Health Check", health: "Next: Harvest", harvest: "Next: Reminders" }[tool])} →</button></div>}
        </> : <>
          {farm ? <div className="fd-weather"><FarmWeather key={farm.id} farms={[farm]} lang={lang} /></div> : <section className="fd-weather fd-weather-empty"><div className="fd-weather-icon" aria-hidden="true">☀</div><div><h2>{t("Farm Weather")}</h2><p>{t("Add your farm location to see the forecast.")}</p></div></section>}
          <div className="fd-stats">{[["home", "My Farms", farms.length], ["leaf", "My Crops", crops.length], ["calendar", "Upcoming Tasks", reminders.loading || reminders.error ? "—" : pending.length]].map(([icon, label, value]) => <article className="fd-stat" key={label}><span><Icon name={icon} size={29} /></span><div><h2>{t(label)}</h2><strong>{value}</strong></div></article>)}</div>
          {!farms.length && <section className="fd-panel fd-first-farm"><Photo src="/images/millet-harvest.png" alt={t("Millet field")} /><div><h2>{t("Let’s add your first farm")}</h2><p>{t("Save your farm details. Then add crops and get guidance in one place.")}</p><button className="fd-button fd-red" onClick={() => openEditor("farm")}>+ {t("Add Farm")}</button><small>{t("Add Crop becomes available after you save a farm.")}</small></div></section>}
          <section className="fd-panel"><div className="fd-section-heading"><div className="fd-heading-icon"><Icon name="leaf" size={25} /><h2>{t("My Crops")}</h2></div>{farm && <button className="fd-button fd-red" onClick={() => openEditor("crop")}>+ {t("Add Crop")}</button>}</div>
            {farm && <div className="fd-farm-switch"><label>{t("Farm")}<select value={String(farm.id)} onChange={(event) => setFarmId(event.target.value)}>{farms.map((f) => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label><button className="fd-link" onClick={() => go("farms")}>{t("Manage farms")}</button></div>}
            {shownCrops.length ? <div className="fd-crop-grid">{shownCrops.map((item) => <article className="fd-crop-card" key={item.id}><Photo src={item.image_url || photoFor(varietyName(item.variety_id))} alt={varietyName(item.variety_id)} /><h3>{varietyName(item.variety_id)}</h3><p>{farm?.name}</p><p>{t("Planting date")}: {item.planting_date}</p><span className="fd-stage"><Icon name="leaf" size={16} />{item.growth_stage}</span><button className="fd-button fd-outline" onClick={() => openCrop(item)}>{t("View Details")} →</button></article>)}</div> : <div className="fd-empty"><Icon name="leaf" size={48} /><p>{t(farm ? "No crops yet. Add your first crop." : "No crops yet. Add a farm to get started.")}</p></div>}
          </section>
          <section className="fd-premium"><div><h2><Icon name="crown" size={23} /> {t("Farmer Premium")}</h2><strong>LKR 500 <small>/ {t("month")}</small></strong><p>{t("Explore extra AI guidance and SMS reminders.")}</p><button className="fd-button fd-outline" onClick={() => go("subscription")}>{t("View Plan")} →</button></div><img src="/images/premium-millet.png" alt="" aria-hidden="true" /></section>
          <section className="fd-panel"><div className="fd-section-heading"><div className="fd-heading-icon"><Icon name="calendar" size={24} /><h2>{t("Upcoming Tasks")}</h2></div>{crops.length > 0 && <button className="fd-link" onClick={() => go("reminders")}>{t("View all reminders")} →</button>}</div>
            {reminderList(pending.slice(0, 5))}
          </section>
        </>}
      </>}
    </main>
    <footer className="fd-footer"><div className="fd-wrap"><Link to="/"><img src="/images/logo.png" alt="Millet Plus" /></Link><strong>{t("Better crops. Stronger communities.")}</strong></div></footer>
  </div>;
}
