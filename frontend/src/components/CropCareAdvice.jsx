import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";
import { tamilText } from "../translations";
import { AdviceReminder } from "./CropReminders";

const PAGE_SIZE = 10;

const booleanChoice = (value) =>
  value === "yes" ? true : value === "no" ? false : null;

export function AdviceForCrop({
  cropId,
  lang = "en",
  onChanged,
}) {
  const t = (key) => (lang === "ta" ? tamilText(key) : key);

  const [direct, setDirect] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);

  const [history, setHistory] = useState({
    rows: [],
    loading: true,
    failed: false,
  });

  const pending = useRef(null);

  useEffect(() => {
    return () => pending.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setHistory({
      rows: [],
      loading: true,
      failed: false,
    });

    apiRequest(
      `/crop-cycles/${cropId}/advice-history?limit=${
        PAGE_SIZE + 1
      }&offset=${offset}`,
      {
        signal: controller.signal,
      },
    )
      .then((rows) => {
        if (controller.signal.aborted) return;

        if (!Array.isArray(rows)) {
          throw new Error("Invalid advice history response.");
        }

        setHistory({
          rows,
          loading: false,
          failed: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;

        setHistory({
          rows: [],
          loading: false,
          failed: true,
        });
      });

    return () => controller.abort();
  }, [cropId, offset, revision]);

  async function submit(event) {
    event.preventDefault();

    if (pending.current) return;

    const form = new FormData(event.currentTarget);
    const question = String(form.get("question") ?? "").trim();

    if (question.length < 3) {
      setError(
        lang === "ta"
          ? "குறைந்தது 3 எழுத்துகள் கொண்ட கேள்வியை எழுதுங்கள்."
          : "Please enter a question with at least 3 characters.",
      );
      return;
    }

    const controller = new AbortController();
    pending.current = controller;

    setBusy(true);
    setError("");
    setResult(null);

    try {
      const response = await apiRequest("/ai/crop-care", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          crop_cycle_id: Number(cropId),
          question,
          direct_sown: booleanChoice(direct),
          used_pre_emergence_herbicide:
            direct === "yes"
              ? booleanChoice(form.get("herbicide"))
              : null,
        }),
      });

      if (controller.signal.aborted) return;

      setResult(response);

      // Refresh the history after a saved answer.
      if (!response.is_demo) {
        setOffset(0);
        setRevision((value) => value + 1);
      }
    } catch (err) {
      if (controller.signal.aborted) return;

      if (err.status === 401) {
        setError(
          lang === "ta"
            ? "உங்கள் Login காலாவதியாகிவிட்டது. மீண்டும் Login செய்யுங்கள்."
            : "Please sign in again.",
        );
      } else if (err.status === 429) {
        setError(
          lang === "ta"
            ? "AI பயன்பாட்டு வரம்பு எட்டப்பட்டுள்ளது. சிறிது நேரம் கழித்து முயற்சிக்கவும்."
            : "AI usage limit reached. Please try again later.",
        );
      } else if (err.status === 504) {
        setError(
          lang === "ta"
            ? "AI பதிலளிக்க அதிக நேரம் எடுத்துக்கொண்டது. மீண்டும் முயற்சிக்கவும்."
            : "The AI request timed out. Please try again.",
        );
      } else {
        setError(
          err.message ||
            (lang === "ta"
              ? "பயிர் பராமரிப்பு ஆலோசனையைப் பெற முடியவில்லை."
              : "Could not get crop care advice."),
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
      }

      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }

  const choices = (
    <>
      <option value="">{t("Not sure")}</option>
      <option value="yes">{t("Yes")}</option>
      <option value="no">{t("No")}</option>
    </>
  );

  function details(row) {
    return (
      <>
        <p
          style={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            lineHeight: 1.7,
          }}
        >
          {row.answer}
        </p>

        {row.planting_date && (
          <p>
            {t("Planting date")} · {row.planting_date}
          </p>
        )}

        {row.task && (
          <p>
            <strong>{row.task}</strong>
          </p>
        )}

        {row.suggested_date && (
          <p>
            {t("Suggested date")} · {row.suggested_date}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            {t("Your crop care question")}

            <textarea
              name="question"
              rows={4}
              minLength={3}
              maxLength={500}
              required
              placeholder={
                lang === "ta"
                  ? "என் பயிரை எப்படிப் பராமரிக்க வேண்டும்? தண்ணீர் தேவைப்படுவதை எப்படி அறியலாம்?"
                  : "How should I care for my crop? How can I tell when it needs water?"
              }
            />
          </label>

          <label>
            {t("Was this crop sown directly?")}

            <select
              value={direct}
              onChange={(event) => setDirect(event.target.value)}
            >
              {choices}
            </select>
          </label>

          {direct === "yes" && (
            <label>
              {t("Did you use a weedkiller before the seeds sprouted?")}

              <select name="herbicide" defaultValue="">
                {choices}
              </select>
            </label>
          )}

          <button
            type="submit"
            className="btn red space-top"
            disabled={busy}
          >
            {t(busy ? "Getting advice…" : "Get Guidance")}
          </button>
        </fieldset>
      </form>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="panel space-top" aria-live="polite">
          <h3>{t("Latest advice")}</h3>

          {result.is_demo && (
            <p className="caption">
              {t("Demo advice is not saved.")}
            </p>
          )}

          {details(result)}
        </section>
      )}

      <section className="space-top">
        <div className="page-actions">
          <h3>{t("Advice History")}</h3>

          <button
            type="button"
            className="btn outline"
            disabled={history.loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("Refresh")}
          </button>
        </div>

        {history.loading && (
          <p role="status">
            {t("Loading advice history…")}
          </p>
        )}

        {history.failed && (
          <p role="alert">
            {t("Could not load advice history.")}
          </p>
        )}

        {!history.loading &&
          !history.failed &&
          history.rows.length === 0 && (
            <p>{t("No saved advice on this page.")}</p>
          )}

        {history.rows.slice(0, PAGE_SIZE).map((row) => (
          <article className="panel space-top" key={row.id}>
            <h4>{row.question}</h4>

            {details(row)}

            {row.task && row.suggested_date && (
              <AdviceReminder
                advice={row}
                lang={lang}
                onChanged={onChanged}
              />
            )}
          </article>
        ))}

        {(offset > 0 || history.rows.length > PAGE_SIZE) && (
          <div className="page-actions space-top">
            <button
              type="button"
              className="btn outline"
              disabled={offset === 0 || history.loading}
              onClick={() =>
                setOffset((value) =>
                  Math.max(0, value - PAGE_SIZE),
                )
              }
            >
              {t("Previous")}
            </button>

            <button
              type="button"
              className="btn outline"
              disabled={
                history.rows.length <= PAGE_SIZE ||
                history.loading
              }
              onClick={() =>
                setOffset((value) => value + PAGE_SIZE)
              }
            >
              {t("Next")}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

export default function CropCareAdvice({
  crops = [],
  varietyName,
  lang = "en",
  onChanged,
}) {
  const t = (key) => (lang === "ta" ? tamilText(key) : key);

  const [selected, setSelected] = useState("");

  const crop = crops.find(
    (item) => String(item.id) === selected,
  );

  if (!crops.length) return null;

  return (
    <section className="panel botanical-panel space-top">
      <h2>{t("Crop Care Guidance")}</h2>

      <label>
        {t("Select a crop for guidance")}

        <select
          value={crop ? selected : ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">
            {t("Select crop")}
          </option>

          {crops.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {typeof varietyName === "function"
                ? varietyName(item.variety_id)
                : `#${item.variety_id}`}
              {" · "}
              {item.planting_date}
              {" · #"}
              {item.id}
            </option>
          ))}
        </select>
      </label>

      {crop && (
        <AdviceForCrop
          key={crop.id}
          cropId={crop.id}
          lang={lang}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}