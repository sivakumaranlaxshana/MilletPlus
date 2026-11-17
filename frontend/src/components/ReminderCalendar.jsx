import React, { useEffect, useState } from "react";
import { apiRequest } from "../api";

const TIME_ZONE = "Asia/Colombo";
const PAGE_SIZE = 100;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function localDate(value) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(value).map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function ReminderCalendar({ lang = "en", revision = 0 }) {
  const tamil = lang === "ta";
  const locale = tamil ? "ta-LK" : "en-GB";
  const today = localDate(new Date());

  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [result, setResult] = useState({
    rows: [],
    loading: true,
    error: false,
  });

  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;

  const monthTitle = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const weekdayTitle = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const timeTitle = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });

  const selectedTasks = result.rows.filter((row) => row.day === selected);

  useEffect(() => {
    const controller = new AbortController();
    setResult({ rows: [], loading: true, error: false });

    async function loadMonth() {
      const rows = [];

      for (let offset = 0; !controller.signal.aborted; offset += PAGE_SIZE) {
        const batch = await apiRequest(
          `/crop-reminders?status=pending&limit=${PAGE_SIZE}&offset=${offset}`,
          { signal: controller.signal }
        );

        let reachedLaterMonth = false;
        for (const row of batch) {
          const day = localDate(new Date(row.remind_at));
          if (day.startsWith(`${month}-`)) rows.push({ ...row, day });
          if (day.slice(0, 7) > month) reachedLaterMonth = true;
        }

        if (reachedLaterMonth || batch.length < PAGE_SIZE) break;
      }

      if (!controller.signal.aborted) {
        setResult({ rows, loading: false, error: false });
      }
    }

    loadMonth().catch(() => {
      if (!controller.signal.aborted) {
        setResult({ rows: [], loading: false, error: true });
      }
    });

    return () => controller.abort();
  }, [month, revision]);

  function changeMonth(amount) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
      .toISOString()
      .slice(0, 7);
    setMonth(next);
    setSelected(`${next}-01`);
  }

  function goToToday() {
    setMonth(today.slice(0, 7));
    setSelected(today);
  }

  return (
    <section className="panel botanical-panel mp-care-calendar">
      <div className="page-actions">
        <h2>{tamil ? "பராமரிப்பு நாட்காட்டி" : "Your Care Calendar"}</h2>
        <button type="button" className="btn outline" onClick={goToToday}>
          {tamil ? "இன்று" : "Today"}
        </button>
      </div>

      <div className="mp-calendar-controls">
        <button
          type="button"
          className="btn outline"
          aria-label={tamil ? "முந்தைய மாதம்" : "Previous month"}
          onClick={() => changeMonth(-1)}
        >
          ‹
        </button>
        <strong aria-live="polite">{monthTitle.format(firstDay)}</strong>
        <button
          type="button"
          className="btn outline"
          aria-label={tamil ? "அடுத்த மாதம்" : "Next month"}
          onClick={() => changeMonth(1)}
        >
          ›
        </button>
      </div>

      <div className="mp-calendar-grid">
        {Array.from({ length: 7 }, (_, index) => (
          <span className="mp-calendar-weekday" key={index}>
            {weekdayTitle.format(new Date(Date.UTC(2024, 0, index + 1)))}
          </span>
        ))}

        {Array.from({ length: mondayOffset }, (_, index) => (
          <span key={`empty-${index}`} aria-hidden="true" />
        ))}

        {Array.from({ length: dayCount }, (_, index) => {
          const day = `${month}-${String(index + 1).padStart(2, "0")}`;
          const hasTasks = result.rows.some((row) => row.day === day);

          return (
            <button
              type="button"
              key={day}
              aria-label={day}
              aria-pressed={day === selected}
              className={day === selected ? "selected" : ""}
              onClick={() => setSelected(day)}
            >
              {index + 1}
              {hasTasks && <span className="mp-calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {result.loading && (
        <p role="status">{tamil ? "ஏற்றப்படுகிறது…" : "Loading reminders…"}</p>
      )}

      {result.error && (
        <p role="alert">
          {tamil ? "நினைவூட்டல்களைப் பெற முடியவில்லை." : "Could not load reminders."}
        </p>
      )}

      {!result.loading && !result.error && (
        <div aria-live="polite">
          <h3>{selected}</h3>
          {selectedTasks.length ? (
            <ul>
              {selectedTasks.map((row) => (
                <li key={row.id}>
                  {timeTitle.format(new Date(row.remind_at))} · {row.task}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {tamil
                ? "இந்தத் தேதியில் நிலுவை நினைவூட்டல்கள் இல்லை."
                : "No pending reminders on this date."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}