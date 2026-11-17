import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { apiRequest } from "../api";

const INITIAL = {
  records: [],
  loading: false,
  refreshing: false,
  error: "",
};

export function formatStockValue(value, lang = "en") {
  return Number(value).toLocaleString(
    lang === "ta" ? "ta-LK" : "en-LK",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

export async function fetchPublicStocks({
  signal,
  limit,
} = {}) {
  const records = [];
  const seen = new Set();

  for (let offset = 0; ; ) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const size =
      limit === undefined
        ? 100
        : Math.min(100, limit - records.length);

    const batch = await apiRequest(
      `/public/stocks?offset=${offset}&limit=${size}`,
      {
        auth: false,
        signal,
        cache: "no-store",
      }
    );

    if (!Array.isArray(batch)) {
      throw new Error("Unexpected stock response.");
    }

    for (const row of batch) {
      if (
        !Number.isInteger(row.id) ||
        row.id <= 0 ||
        seen.has(row.id) ||
        !Number.isInteger(row.variety_id) ||
        typeof row.variety_name !== "string" ||
        typeof row.in_stock !== "boolean" ||
        row.available_quantity === null ||
        row.available_quantity === "" ||
        row.selling_price_per_kg === null ||
        row.selling_price_per_kg === "" ||
        !Number.isFinite(Number(row.available_quantity)) ||
        Number(row.available_quantity) < 0 ||
        !Number.isFinite(Number(row.selling_price_per_kg)) ||
        Number(row.selling_price_per_kg) <= 0
      ) {
        throw new Error("Unexpected stock response.");
      }

      seen.add(row.id);

      records.push({
        id: row.id,
        variety_id: row.variety_id,
        variety_name: row.variety_name,

        available_quantity: String(
          row.available_quantity
        ),

        selling_price_per_kg: String(
          row.selling_price_per_kg
        ),

        in_stock:
          row.in_stock &&
          Number(row.available_quantity) > 0,
      });
    }

    if (
      batch.length < size ||
      (limit !== undefined && records.length >= limit)
    ) {
      return records;
    }

    offset += batch.length;
  }
}

export default function usePublicStocks({
  enabled = true,
  limit,
  refreshMs = 30000,
} = {}) {
  const [state, setState] = useState({
    ...INITIAL,
    loading: enabled,
  });

  const current = useRef(null);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!enabled) {
        return;
      }

      current.current?.abort();

      const controller = new AbortController();
      current.current = controller;

      setState((previous) => ({
        ...previous,
        loading: !quiet && !previous.records.length,
        refreshing: true,
      }));

      try {
        const records = await fetchPublicStocks({
          signal: controller.signal,
          limit,
        });

        if (!controller.signal.aborted) {
          setState({
            records,
            loading: false,
            refreshing: false,
            error: "",
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({
            records: [],
            loading: false,
            refreshing: false,
            error:
              "Stock could not be loaded. Please try again.",
          });
        }
      }
    },
    [enabled, limit]
  );

  useEffect(() => {
    if (!enabled) {
      current.current?.abort();
      setState(INITIAL);
      return;
    }

    refresh();

    const update = () => {
      if (document.visibilityState !== "hidden") {
        refresh(true);
      }
    };

    window.addEventListener("focus", update);

    const timer =
      refreshMs > 0
        ? window.setInterval(update, refreshMs)
        : null;

    return () => {
      current.current?.abort();

      window.removeEventListener("focus", update);

      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [enabled, refresh, refreshMs]);

  return {
    ...state,
    refresh,
  };
}