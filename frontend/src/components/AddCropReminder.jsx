import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";

const PAGE_SIZE = 10;

function todayInSriLanka() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function AddCropReminder({
  cropId,
  lang = "en",
  onSaved,
  onOpenAdvice,
}) {
  const ta = lang === "ta";
  const text = (en, tamil) => (ta ? tamil : en);

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [adviceId, setAdviceId] = useState("");
  const [date, setDate] = useState(todayInSriLanka);
  const [time, setTime] = useState("07:00");
  const [sendSms, setSendSms] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const saving = useRef(false);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    setLoading(true);
    setLoadError("");
    setRows([]);
    setAdviceId("");

    apiRequest(
      `/crop-cycles/${cropId}/advice-history?limit=${
        PAGE_SIZE + 1
      }&offset=${offset}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;

        if (!Array.isArray(data)) {
          throw new Error("Invalid advice response.");
        }

        setRows(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        setLoadError(
          err.status === 401
            ? "Please sign in again."
            : "Could not load advice.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [cropId, open, offset, revision]);

  const availableAdvice = rows
    .slice(0, PAGE_SIZE)
    .filter(
      (row) =>
        row.id &&
        !row.is_demo &&
        row.task &&
        row.suggested_date,
    );

  const selectedAdvice = availableAdvice.find(
    (row) => String(row.id) === adviceId,
  );

  async function submit(event) {
    event.preventDefault();

    if (saving.current) return;

    setError("");
    setSuccess("");

    if (!selectedAdvice) {
      setError(
        text(
          "Choose an advice task.",
          "ஒரு ஆலோசனை வேலையைத் தேர்வு செய்யுங்கள்.",
        ),
      );
      return;
    }

    const remindAt = `${date}T${time}:00+05:30`;

    if (!(Date.parse(remindAt) > Date.now())) {
      setError(
        text(
          "Choose a future date and time.",
          "இனிவரும் தேதியையும் நேரத்தையும் தேர்வு செய்யுங்கள்.",
        ),
      );
      return;
    }

    saving.current = true;
    setBusy(true);

    try {
      await apiRequest("/crop-reminders", {
        method: "POST",
        body: JSON.stringify({
          advice_id: selectedAdvice.id,
          remind_at: remindAt,
          send_sms: sendSms,
        }),
      });
    } catch (err) {
      const detail =
        typeof err.detail === "string"
          ? err.detail
          : err.message;

      if (err.status === 401) {
        setError(
          text(
            "Please sign in again.",
            "மீண்டும் உள்நுழையுங்கள்.",
          ),
        );
      } else if (
        detail === "Enable SMS in your profile first."
      ) {
        setError(
          text(
            "Enable SMS in My Profile first.",
            "முதலில் My Profile பகுதியில் SMS அனுமதியைச் சேமியுங்கள்.",
          ),
        );
      } else if (
        detail ===
        "A reminder already exists for this advice."
      ) {
        setError(
          text(
            "This advice already has a reminder. Choose another advice.",
            "இந்த ஆலோசனைக்கு ஏற்கெனவே நினைவூட்டல் உள்ளது. வேறொரு ஆலோசனையைத் தேர்வு செய்யுங்கள்.",
          ),
        );
      } else {
        setError(
          text(
            "Could not save the reminder. Check the date and try again.",
            "நினைவூட்டலைச் சேமிக்க முடியவில்லை. தேதி மற்றும் நேரத்தைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
          ),
        );
      }

      return;
    } finally {
      saving.current = false;
      setBusy(false);
    }

    setSuccess(
      text(
        "Reminder saved successfully.",
        "நினைவூட்டல் சேமிக்கப்பட்டது.",
      ),
    );

    setOpen(false);
    setAdviceId("");
    setSendSms(false);

    // Refresh the parent's list without treating a refresh
    // failure as a failed reminder save.
    if (typeof onSaved === "function") {
      try {
        await onSaved();
      } catch {
        setSuccess(
          text(
            "Reminder saved. Refresh the reminder list.",
            "நினைவூட்டல் சேமிக்கப்பட்டது. பட்டியலைப் புதுப்பியுங்கள்.",
          ),
        );
      }
    }
  }

  return (
    <section className="space-top">
      {!open && (
        <button
          type="button"
          className="fd-button fd-red"
          onClick={() => {
            setOffset(0);
            setError("");
            setSuccess("");
            setDate(todayInSriLanka());
            setOpen(true);
          }}
        >
          + {text("Add Reminder", "நினைவூட்டல் சேர்க்க")}
        </button>
      )}

      {success && (
        <p className="fd-alert fd-success" role="status">
          {success}
        </p>
      )}

      {open && (
        <div className="panel">
          <h3>
            {text("Add Crop Reminder", "பயிர் நினைவூட்டல் சேர்க்க")}
          </h3>

          {loading && (
            <p role="status">
              {text(
                "Loading advice tasks…",
                "ஆலோசனை வேலைகள் பெறப்படுகின்றன…",
              )}
            </p>
          )}

          {loadError && (
            <div>
              <p className="alert error" role="alert">
                {text(
                  loadError,
                  loadError === "Please sign in again."
                    ? "மீண்டும் உள்நுழையுங்கள்."
                    : "ஆலோசனைகளைப் பெற முடியவில்லை.",
                )}
              </p>

              <button
                type="button"
                className="fd-button fd-outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                {text("Retry", "மீண்டும் முயற்சி")}
              </button>
            </div>
          )}

          {!loading && !loadError && (
            <>
              {availableAdvice.length > 0 ? (
                <form onSubmit={submit}>
                  <fieldset disabled={busy}>
                    <label>
                      {text("Advice task", "ஆலோசனை வேலை")}

                      <select
                        required
                        value={adviceId}
                        onChange={(event) => {
                          setAdviceId(event.target.value);
                          setError("");
                        }}
                      >
                        <option value="">
                          {text(
                            "Choose a task",
                            "வேலையைத் தேர்வு செய்யுங்கள்",
                          )}
                        </option>

                        {availableAdvice.map((row) => (
                          <option key={row.id} value={String(row.id)}>
                            #{row.id} · {row.task} · {row.suggested_date}
                          </option>
                        ))}
                      </select>
                    </label>

                    {selectedAdvice && (
                      <p className="caption">
                        {text("Suggested date", "பரிந்துரைக்கப்பட்ட தேதி")}
                        : {selectedAdvice.suggested_date}
                      </p>
                    )}

                    <label>
                      {text("Reminder date", "நினைவூட்டல் தேதி")}

                      <input
                        type="date"
                        required
                        min={todayInSriLanka()}
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />
                    </label>

                    <label>
                      {text("Time (Sri Lanka)", "நேரம் (இலங்கை)")}

                      <input
                        type="time"
                        required
                        step={60}
                        value={time}
                        onChange={(event) => setTime(event.target.value)}
                      />
                    </label>

                    <label>
                      <input
                        type="checkbox"
                        checked={sendSms}
                        onChange={(event) =>
                          setSendSms(event.target.checked)
                        }
                      />
                      {text(
                        "Send SMS to my profile number",
                        "எனது சுயவிவர எண்ணுக்கு SMS அனுப்பவும்",
                      )}
                    </label>

                    <button
                      type="submit"
                      className="fd-button fd-red"
                    >
                      {busy
                        ? text("Saving…", "சேமிக்கப்படுகிறது…")
                        : text("Save Reminder", "நினைவூட்டலைச் சேமிக்க")}
                    </button>
                  </fieldset>
                </form>
              ) : (
                <p>
                  {text(
                    "No scheduled advice tasks on this page. Check another page or get advice first.",
                    "இந்தப் பக்கத்தில் தேதி கொண்ட ஆலோசனை வேலைகள் இல்லை. அடுத்த பக்கத்தைப் பாருங்கள் அல்லது முதலில் ஆலோசனை பெறுங்கள்.",
                  )}
                </p>
              )}

              {(offset > 0 || rows.length > PAGE_SIZE) && (
                <div className="fd-actions">
                  <button
                    type="button"
                    className="fd-button fd-outline"
                    disabled={busy || offset === 0}
                    onClick={() =>
                      setOffset((value) =>
                        Math.max(0, value - PAGE_SIZE),
                      )
                    }
                  >
                    {text("Previous", "முந்தையது")}
                  </button>

                  <button
                    type="button"
                    className="fd-button fd-outline"
                    disabled={busy || rows.length <= PAGE_SIZE}
                    onClick={() =>
                      setOffset((value) => value + PAGE_SIZE)
                    }
                  >
                    {text("Next", "அடுத்தது")}
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}

          <div className="fd-actions">
            {typeof onOpenAdvice === "function" && (
              <button
                type="button"
                className="fd-button fd-outline"
                disabled={busy}
                onClick={onOpenAdvice}
              >
                {text("Open Advice History", "ஆலோசனை வரலாற்றைத் திறக்க")}
              </button>
            )}

            <button
              type="button"
              className="fd-button fd-outline"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              {text("Cancel", "ரத்து செய்")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}