import json
import logging
import time
from math import isfinite
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies import require_roles


router = APIRouter(prefix="/weather", tags=["Weather"])
logger = logging.getLogger("uvicorn.error")

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT_SECONDS = 10
MAX_ATTEMPTS = 2
RETRYABLE_HTTP_CODES = {500, 502, 503, 504}


class FarmWeather(BaseModel):
    temperature_c: float
    weather_code: int
    rain_probability_max: int | None
    local_time: str
    timezone: str


def request_open_meteo(url: str) -> dict:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return json.load(response)

        except HTTPError as exc:
            retryable = exc.code in RETRYABLE_HTTP_CODES

            if not retryable or attempt == MAX_ATTEMPTS:
                raise

            logger.warning(
                "Open-Meteo returned HTTP %s. Retrying once.", exc.code
            )

        except (URLError, TimeoutError) as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc

            if not isinstance(reason, TimeoutError) or attempt == MAX_ATTEMPTS:
                raise

            logger.warning("Open-Meteo request timed out. Retrying once.")

        time.sleep(0.5)

    raise RuntimeError("Open-Meteo request finished without a result.")


def fetch_forecast(latitude: float, longitude: float) -> FarmWeather:
    query = urlencode(
        {
            "latitude": latitude,
            "longitude": longitude,
            "current": "temperature_2m,weather_code",
            "daily": "precipitation_probability_max",
            "temperature_unit": "celsius",
            "timezone": "Asia/Colombo",
            "forecast_days": 1,
        }
    )

    data = request_open_meteo(f"{FORECAST_URL}?{query}")

    current = data["current"]
    temperature = float(current["temperature_2m"])
    if not isfinite(temperature):
        raise ValueError("Invalid temperature.")

    probabilities = data.get("daily", {}).get(
        "precipitation_probability_max"
    ) or []
    rain = probabilities[0] if probabilities else None

    if rain is not None and (type(rain) is not int or not 0 <= rain <= 100):
        raise ValueError("Invalid rain probability.")

    return FarmWeather(
        temperature_c=temperature,
        weather_code=current["weather_code"],
        rain_probability_max=rain,
        local_time=current["time"],
        timezone=data["timezone"],
    )


@router.get(
    "/forecast",
    response_model=FarmWeather,
    dependencies=[Depends(require_roles("farmer"))],
)
def get_forecast(
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
) -> FarmWeather:
    try:
        return fetch_forecast(latitude, longitude)

    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        logger.warning(
            "Open-Meteo forecast failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail="Weather is temporarily unavailable. Please try again.",
        ) from exc