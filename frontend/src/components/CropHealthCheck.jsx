import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";
import { tamilText } from "../translations";

const PAGE_SIZE = 10;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function HealthResult({ row, t, lang }) {
  const steps = Array.isArray(row.care_steps)
    ? row.care_steps.filter(
        (step) => typeof step === "string" && step.trim(),
      )
    : [];

  const date = new Date(row.created_at);
  const checkedAt = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(
        lang === "ta" ? "ta-LK" : "en-GB",
        { timeZone: "Asia/Colombo" },
      );

  return (
    <article className="panel space-top">
      <p className="caption">
        #{row.id}
        {checkedAt && ` · ${checkedAt}`}
      </p>

      <h4>{t("Reported symptoms")}</h4>
      <p style={{ whiteSpace: "pre-wrap" }}>{row.symptoms}</p>

      <h4>{t("Observed signs")}</h4>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {row.observed_signs}
      </p>

      <h4>{t("Possible problem")}</h4>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {row.possible_problem}
      </p>

      <h4>{t("Basic care steps")}</h4>
      <ul>
        {steps.map((step, index) => (
          <li key={`${index}-${step}`}>{t(step)}</li>
        ))}
      </ul>

      <p className="caption">
        {t(
          "AI guidance is preliminary. Ask an agricultural expert to confirm the cause.",
        )}
      </p>
    </article>
  );
}

export function HealthCheckForCrop({ cropId, lang = "en" }) {
  const t = (text) => (lang === "ta" ? tamilText(text) : text);

  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);

  const [history, setHistory] = useState({
    rows: [],
    loading: true,
    error: "",
  });

  const pending = useRef(null);

  useEffect(() => {
    return () => pending.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const query = new URLSearchParams({
      limit: String(PAGE_SIZE + 1),
      offset: String(offset),
    });

    setHistory({
      rows: [],
      loading: true,
      error: "",
    });

    apiRequest(`/crop-cycles/${cropId}/health-checks?${query}`, {
      signal: controller.signal,
    })
      .then((rows) => {
        if (controller.signal.aborted) return;

        if (!Array.isArray(rows)) {
          throw new Error("Invalid history response.");
        }

        setHistory({
          rows,
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        setHistory({
          rows: [],
          loading: false,
          error:
            err.status === 401
              ? "Please sign in again."
              : "Could not load health check history.",
        });
      });

    return () => controller.abort();
  }, [cropId, offset, revision]);

  async function submit(event) {
    event.preventDefault();

    if (pending.current) return;

    const form = new FormData(event.currentTarget);
    const image = form.get("image");
    const symptoms = String(form.get("symptoms") ?? "").trim();

    if (!symptoms) {
      setError(
        lang === "ta"
          ? "பயிரில் தெரியும் அறிகுறிகளை எழுதுங்கள்."
          : "Describe the symptoms.",
      );
      return;
    }

    const hasImage =
      image instanceof File && image.name !== "";

    if (
      hasImage &&
      (image.size === 0 ||
        image.size > MAX_IMAGE_BYTES ||
        !IMAGE_TYPES.includes(image.type))
    ) {
      setError(
        lang === "ta"
          ? "3 MB-க்குள் உள்ள JPG, PNG அல்லது WebP படத்தைத் தேர்வு செய்யுங்கள்."
          : "Choose a non-empty JPG, PNG or WebP photo up to 3 MB.",
      );
      return;
    }

    if (!hasImage) {
      form.delete("image");
    }

    form.set("crop_cycle_id", String(cropId));
    form.set("symptoms", symptoms);
    form.set("language", lang === "ta" ? "ta" : "en");

    const controller = new AbortController();
    pending.current = controller;

    setChecking(true);
    setError("");
    setResult(null);

    try {
      const row = await apiRequest("/ai/health-check", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setResult(row);
      setOffset(0);
      setRevision((value) => value + 1);
    } catch (err) {
      if (controller.signal.aborted) return;

      if (err.status === 401) {
        setError(
          lang === "ta"
            ? "மீண்டும் Login செய்யுங்கள்."
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
              ? "Health Check செய்ய முடியவில்லை. மீண்டும் முயற்சிக்கவும்."
              : "Could not complete the health check."),
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
      }

      if (!controller.signal.aborted) {
        setChecking(false);
      }
    }
  }

  return (
    <>
      <form className="space-top" onSubmit={submit}>
        <fieldset disabled={checking}>
          <label>
            {lang === "ta"
              ? "இலைப் படம் — விருப்பமானது"
              : "Leaf photo — optional"}

            <input
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
          </label>

          <p className="caption">
            {lang === "ta"
              ? "படம் இல்லாமலும் அறிகுறிகளை மட்டும் கொடுக்கலாம். படம் இருந்தால் மேலும் உதவியாக இருக்கும்."
              : "You can submit symptoms without a photo. A clear photo can provide additional information."}
          </p>

          <label>
            {t("Describe the symptoms")}
            <textarea
              name="symptoms"
              rows={4}
              minLength={1}
              maxLength={1000}
              required
              placeholder={
                lang === "ta"
                  ? "எந்த மாற்றம் தெரிகிறது? எத்தனை நாட்களாக உள்ளது? எவ்வளவு பரவியுள்ளது?"
                  : "What changes do you notice? When did they start? How widely have they spread?"
              }
            />
          </label>

          <button
            type="submit"
            className="btn red space-top"
            disabled={checking}
          >
            {t(checking ? "Checking crop…" : "Check crop")}
          </button>
        </fieldset>
      </form>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="space-top" aria-live="polite">
          <h3>{t("Latest health check")}</h3>
          <HealthResult row={result} t={t} lang={lang} />
        </section>
      )}

      <section className="space-top">
        <div className="page-actions">
          <h3>{t("Health Check History")}</h3>

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
          <p role="status">{t("Loading history…")}</p>
        )}

        {history.error && (
          <p className="alert error" role="alert">
            {t(history.error)}
          </p>
        )}

        {!history.loading &&
          !history.error &&
          history.rows.length === 0 && (
            <p>{t("No health checks on this page.")}</p>
          )}

        {history.rows.slice(0, PAGE_SIZE).map((row) => (
          <HealthResult
            key={row.id}
            row={row}
            t={t}
            lang={lang}
          />
        ))}

        {(offset > 0 || history.rows.length > PAGE_SIZE) && (
          <div className="page-actions space-top">
            <button
              type="button"
              className="btn outline"
              disabled={history.loading || offset === 0}
              onClick={() =>
                setOffset((value) => Math.max(0, value - PAGE_SIZE))
              }
            >
              {t("Previous")}
            </button>

            <button
              type="button"
              className="btn outline"
              disabled={
                history.loading || history.rows.length <= PAGE_SIZE
              }
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
            >
              {t("Next")}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

export default function CropHealthCheck({
  crops = [],
  varietyName,
  lang = "en",
}) {
  const t = (text) => (lang === "ta" ? tamilText(text) : text);
  const [selectedId, setSelectedId] = useState("");

  const crop = crops.find((item) => String(item.id) === selectedId);

  if (!crops.length) {
    return <p>{t("Add a crop in My Crops first.")}</p>;
  }

  return (
    <>
      <label>
        {t("Select a crop")}
        <select
          value={crop ? selectedId : ""}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">{t("Select a crop")}</option>

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
        <HealthCheckForCrop
          key={crop.id}
          cropId={crop.id}
          lang={lang}
        />
      )}
    </>
  );
}