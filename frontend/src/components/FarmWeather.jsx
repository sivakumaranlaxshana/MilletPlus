import React, { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { tamilText } from "../translations";

function condition(code) {
  if (code === 0) return ["☀", "Clear"];
  if ([1, 2].includes(code)) return ["⛅", "Partly cloudy"];
  if (code === 3) return ["☁", "Overcast"];
  if ([45, 48].includes(code)) return ["☁", "Fog"];
  if ([51, 53, 55, 56, 57].includes(code)) return ["🌦", "Drizzle"];
  if ([61, 63, 65, 66, 67].includes(code)) return ["🌧", "Rain"];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ["❄", "Snow"];
  if ([80, 81, 82].includes(code)) return ["🌧", "Rain showers"];
  if ([95, 96, 99].includes(code)) return ["⛈", "Thunderstorm"];
  return ["☁", "Unknown conditions"];
}

function coordinate(value, limit) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export default function FarmWeather({ farms = [], lang = "en" }) {
  const say = (text) => lang === "ta" ? tamilText(text) : text;
  const [selected, setSelected] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);

  const farm = farms.find((item) => String(item.id) === selected) ?? farms[0];
  const latitude = coordinate(farm?.latitude, 90);
  const longitude = coordinate(farm?.longitude, 180);
  const query = latitude === null || longitude === null
    ? null : new URLSearchParams({ latitude, longitude }).toString();
  const key = query === null ? null : `${farm.id}:${query}:${refresh}`;

  useEffect(() => {
    if (key === null) return;

    const controller = new AbortController();

    apiRequest(`/weather/forecast?${query}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, error: true });
      });

    return () => controller.abort();
  }, [query, key]);

  const current = key !== null && result?.key === key ? result : null;
  const data = current?.data;
  const [icon, name] = condition(data?.weather_code);

  return (
    <section className="weather-strip">
      <div className="weather-symbol" aria-hidden="true">{icon}</div>

      <div className="weather-info">
        <h2>{say("Farm Weather")}</h2>

        {farm && (
          <label>
            {say("Farm")}{" "}
            <select
              value={String(farm.id)}
              onChange={(event) => setSelected(event.target.value)}
            >
              {farms.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!farm ? (
          <p>{say("Add a farm to see its weather.")}</p>
        ) : query === null ? (
          <p>{say("Set this farm's latitude and longitude in Farms.")}</p>
        ) : current?.error ? (
          <p role="alert">
            {say("Weather is temporarily unavailable. Please try again.")}
          </p>
        ) : !data ? (
          <p role="status">{say("Loading weather…")}</p>
        ) : (
          <>
            <p>{say(name)}</p>

            <div className="weather-values">
              <div>
                <strong>{data.temperature_c} °C</strong>
                <small>{say("Temperature")}</small>
              </div>
              <div>
                <strong>
                  {data.rain_probability_max == null
                    ? "—"
                    : `${data.rain_probability_max}%`}
                </strong>
                <small>{say("Today's peak hourly rain chance")}</small>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="weather-note">
        <button
          type="button"
          className="btn outline"
          disabled={key === null || !current}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {say("Refresh")}
        </button>

        {data && (
          <p>
            {say("Forecast time")}: {data.local_time.replace("T", " ")} (
            {say("Sri Lanka time")})
          </p>
        )}

        <p>
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            {say("Weather data: Open-Meteo")}
          </a>
        </p>
      </div>
    </section>
  );
}