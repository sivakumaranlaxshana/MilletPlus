import React, { useRef, useState } from "react";
import { apiRequest } from "../api";

export default function AdminCropVarieties() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submitting = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting.current) return;

    setError("");
    setSuccess("");

    const cleanedName = name.trim();
    const cleanedPrice = price.trim();

    if (!cleanedName) {
      setError("Enter a crop variety name.");
      return;
    }

    if (
      cleanedPrice &&
      !/^\d{1,8}(\.\d{1,2})?$/.test(cleanedPrice)
    ) {
      setError(
        "Enter a valid price with at most two decimal places.",
      );
      return;
    }

    submitting.current = true;
    setBusy(true);

    try {
      const variety = await apiRequest("/crop-varieties", {
        method: "POST",
        body: JSON.stringify({
          name: cleanedName,
          ...(cleanedPrice !== ""
            ? { market_price_per_kg: cleanedPrice }
            : {}),
        }),
      });

      setSuccess(
        `${variety.name} was added successfully. Farmers can select it when adding a crop.`,
      );

      setName("");
      setPrice("");
      setOpen(false);
    } catch (err) {
      setError(
        err.status && err.message
          ? err.message
          : "Could not confirm the result. Check the variety list before retrying.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="ad-panel adcv-panel"
      aria-labelledby="adcv-heading"
    >
      <div className="ad-panel-heading adcv-heading">
        <div>
          <h2 id="adcv-heading">Crop Varieties</h2>

          <p className="adcv-help">
            Add millet varieties for farmers to select.
          </p>
        </div>

        <button
          type="button"
          className="ad-btn"
          aria-expanded={open}
          aria-controls="adcv-form"
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "+ Add Variety"}
        </button>
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
          onSubmit={handleSubmit}
          aria-busy={busy}
        >
          <div className="adcv-fields">
            <label htmlFor="adcv-name">
              Variety name *

              <input
                id="adcv-name"
                name="variety_name"
                type="text"
                placeholder="Example: Foxtail Millet"
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                maxLength={100}
                disabled={busy}
                required
              />
            </label>

            <label htmlFor="adcv-price">
              Market price / kg — LKR

              <input
                id="adcv-price"
                name="market_price_per_kg"
                type="number"
                placeholder="Optional"
                value={price}
                onChange={(event) =>
                  setPrice(event.target.value)
                }
                min="0"
                max="99999999.99"
                step="0.01"
                disabled={busy}
              />
            </label>
          </div>

          <p className="adcv-help">
            Check whether the variety already exists before
            adding it again.
          </p>

          <button
            type="submit"
            className="ad-btn"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save Variety"}
          </button>
        </form>
      )}
    </section>
  );
}