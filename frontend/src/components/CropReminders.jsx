import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";
import { tamilText } from "../translations";

const SMS_LABELS = new Map([
  ["disabled", "SMS off"],
  ["queued", "SMS queued"],
  ["sending", "Sending SMS…"],
  ["sent", "SMS sent"],
  ["failed", "SMS failed"],
  ["skipped", "SMS skipped"],
  ["unknown", "SMS outcome unknown"],
]);

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(value) {
  if (value == null || value === "") return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .map(({ type, value: part }) => [type, part]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function errorText(error, t) {
  if (error?.status === 401) {
    return t("Please sign in again.");
  }

  const detail =
    typeof error?.detail === "string"
      ? error.detail
      : error?.message;

  const known = [
    "Enable SMS in your profile first.",
    "SMS is being processed. Try again shortly.",
    "A reminder already exists for this advice.",
    "A completed reminder cannot be rescheduled.",
  ];

  return t(
    known.includes(detail)
      ? detail
      : "Could not save the reminder.",
  );
}

// A dashboard refresh failure must not make a saved reminder
// appear to have failed.
function notifyChanged(callback) {
  if (typeof callback !== "function") return;

  Promise.resolve()
    .then(() => callback())
    .catch((error) => {
      console.error("Could not refresh reminder view.", error);
    });
}

function TimeForm({
  date,
  time,
  allowSms = false,
  lang = "en",
  onSave,
  onCancel,
}) {
  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  const today = localParts(Date.now())?.date ?? "";

  async function submit(event) {
    event.preventDefault();

    if (submitting.current) return;

    const form = new FormData(event.currentTarget);
    const selectedDate = String(form.get("date") ?? "");
    const selectedTime = String(form.get("time") ?? "");

    const remindAt =
      `${selectedDate}T${selectedTime}:00+05:30`;

    if (!(Date.parse(remindAt) > Date.now())) {
      setError(t("Choose a future date and time."));
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");

    try {
      await onSave(remindAt, form.has("send_sms"));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="space-top" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>
          {t("Reminder date")}

          <input
            name="date"
            type="date"
            required
            defaultValue={date || today}
            min={today}
          />
        </label>

        <label>
          {t("Time (Sri Lanka)")}

          <input
            name="time"
            type="time"
            required
            step={60}
            defaultValue={time || "07:00"}
          />
        </label>

        {allowSms && (
          <label>
            <input name="send_sms" type="checkbox" />
            {" "}
            {t("Send SMS to my profile number")}
          </label>
        )}

        <div className="page-actions space-top">
          <button type="submit" className="btn red">
            {t(busy ? "Saving…" : "Save reminder")}
          </button>

          <button
            type="button"
            className="btn outline"
            onClick={onCancel}
          >
            {t("Cancel")}
          </button>
        </div>
      </fieldset>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function AdviceReminder({
  advice,
  lang = "en",
  onChanged,
}) {
  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  if (
    !advice?.id ||
    advice.is_demo ||
    !advice.task ||
    !advice.suggested_date
  ) {
    return null;
  }

  async function save(remindAt, sendSms) {
    await apiRequest("/crop-reminders", {
      method: "POST",
      body: JSON.stringify({
        advice_id: advice.id,
        remind_at: remindAt,
        send_sms: sendSms,
      }),
    });

    setSaved(true);
    setOpen(false);
    notifyChanged(onChanged);
  }

  return (
    <div className="space-top">
      {saved && (
        <p role="status">
          {t("Reminder saved. Open Reminders to view it.")}
        </p>
      )}

      {!saved && !open && (
        <button
          type="button"
          className="btn outline"
          onClick={() => setOpen(true)}
        >
          {t("Add Reminder")}
        </button>
      )}

      {!saved && open && (
        <TimeForm
          date={advice.suggested_date}
          time="07:00"
          allowSms
          lang={lang}
          onSave={save}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function CropReminders({
  crops = [],
  varietyName,
  lang = "en",
  preview = false,
  onChanged,
}) {
  const t = (text) =>
    lang === "ta" ? tamilText(text) : text;

  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);

  const [state, setState] = useState({
    rows: [],
    loading: true,
    failed: false,
  });

  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const completing = useRef(false);
  const limit = preview ? 5 : 20;

  useEffect(() => {
    const controller = new AbortController();

    setState({
      rows: [],
      loading: true,
      failed: false,
    });

    const query = new URLSearchParams({
      status: preview ? "pending" : status,
      limit: String(limit + 1),
      offset: String(preview ? 0 : offset),
    });

    apiRequest(`/crop-reminders?${query}`, {
      signal: controller.signal,
    })
      .then((rows) => {
        if (controller.signal.aborted) return;

        if (!Array.isArray(rows)) {
          throw new Error("Invalid reminder response.");
        }

        setState({
          rows,
          loading: false,
          failed: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;

        setState({
          rows: [],
          loading: false,
          failed: true,
        });
      });

    return () => controller.abort();
  }, [status, offset, limit, preview, revision]);

  function refresh() {
    setActionError("");
    setRevision((value) => value + 1);
  }

  async function update(id, body) {
    await apiRequest(`/crop-reminders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    setEditing(null);
    setOffset(0);
    refresh();
    notifyChanged(onChanged);
  }

  async function complete(id) {
    if (completing.current) return;

    completing.current = true;
    setBusy(true);
    setActionError("");

    try {
      await update(id, { status: "completed" });
    } catch (error) {
      setActionError(errorText(error, t));
    } finally {
      completing.current = false;
      setBusy(false);
    }
  }

  const locked = busy || editing !== null;

  return (
    <div className="space-top">
      {!preview && (
        <div className="page-actions">
          <label>
            {t("Status")}

            <select
              value={status}
              disabled={locked}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
                setActionError("");
              }}
            >
              <option value="pending">
                {t("Pending")}
              </option>

              <option value="completed">
                {t("Completed")}
              </option>
            </select>
          </label>

          <button
            type="button"
            className="btn outline"
            disabled={locked || state.loading}
            onClick={refresh}
          >
            {t("Refresh")}
          </button>
        </div>
      )}

      {state.loading && (
        <p role="status">
          {t("Loading reminders…")}
        </p>
      )}

      {state.failed && (
        <div>
          <p role="alert">
            {t("Could not load reminders.")}
          </p>

          <button
            type="button"
            className="btn outline"
            disabled={locked}
            onClick={refresh}
          >
            {t("Try again")}
          </button>
        </div>
      )}

      {actionError && (
        <p className="alert error" role="alert">
          {actionError}
        </p>
      )}

      {!state.loading &&
        !state.failed &&
        state.rows.length === 0 && (
          <p>{t("No reminders in this list.")}</p>
        )}

      {state.rows.slice(0, limit).map((row) => {
        const crop = crops.find(
          (item) =>
            String(item.id) === String(row.crop_cycle_id),
        );

        const scheduled = localParts(row.remind_at);
        const sent = localParts(row.sms_sent_at);

        const cropName =
          crop && typeof varietyName === "function"
            ? varietyName(crop.variety_id)
            : `#${row.crop_cycle_id}`;

        return (
          <article
            className="panel space-top"
            key={row.id}
          >
            <h3>{row.task}</h3>

            <p>{cropName}</p>

            <p>
              {scheduled
                ? `${scheduled.date} · ${scheduled.time}`
                : "—"}
              {" · "}
              {t("Time (Sri Lanka)")}
            </p>

            <p className="caption">
              <strong>
                {t(
                  SMS_LABELS.get(row.sms_status) ??
                    "SMS status unavailable",
                )}
              </strong>

              {sent && (
                <>
                  {" · "}
                  {sent.date} {sent.time}
                </>
              )}
            </p>

            {!preview &&
              row.status === "pending" &&
              editing !== row.id && (
                <div className="page-actions">
                  <button
                    type="button"
                    className="btn outline"
                    disabled={locked || state.loading}
                    onClick={() => {
                      setActionError("");
                      setEditing(row.id);
                    }}
                  >
                    {t("Change time")}
                  </button>

                  <button
                    type="button"
                    className="btn red"
                    disabled={locked || state.loading}
                    onClick={() => complete(row.id)}
                  >
                    {t("Mark Complete")}
                  </button>
                </div>
              )}

            {!preview && editing === row.id && (
              <TimeForm
                key={row.id}
                date={scheduled?.date}
                time={scheduled?.time}
                lang={lang}
                onCancel={() => setEditing(null)}
                onSave={(remindAt) =>
                  update(row.id, {
                    remind_at: remindAt,
                  })
                }
              />
            )}
          </article>
        );
      })}

      {!preview &&
        (offset > 0 || state.rows.length > limit) && (
          <div className="page-actions space-top">
            <button
              type="button"
              className="btn outline"
              disabled={
                offset === 0 || locked || state.loading
              }
              onClick={() =>
                setOffset((value) =>
                  Math.max(0, value - limit),
                )
              }
            >
              {t("Previous")}
            </button>

            <button
              type="button"
              className="btn outline"
              disabled={
                state.rows.length <= limit ||
                locked ||
                state.loading
              }
              onClick={() =>
                setOffset((value) => value + limit)
              }
            >
              {t("Next")}
            </button>
          </div>
        )}
    </div>
  );
}