from __future__ import annotations

import hashlib
import hmac
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlsplit

from fastapi import HTTPException


SANDBOX_CHECKOUT_URL = "https://sandbox.payhere.lk/pay/checkout"
REFERENCE_PATTERN = re.compile(r"MP-PAY-([1-9][0-9]*)-([a-f0-9]{32})")


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def md5_upper(value: str) -> str:
    # MD5 is mandated by the PayHere wire protocol, not used for passwords.
    return hashlib.md5(value.encode("utf-8"), usedforsecurity=False).hexdigest().upper()


def checkout_hash(merchant_id: str, reference: str, amount: Decimal, currency: str, secret: str) -> str:
    return md5_upper(merchant_id + reference + format(amount, ".2f") + currency + md5_upper(secret))


def valid_notification_signature(values: dict[str, str], merchant_id: str, secret: str) -> bool:
    if not hmac.compare_digest(values["merchant_id"], merchant_id):
        return False
    signature = values["md5sig"]
    if not re.fullmatch(r"[A-Fa-f0-9]{32}", signature):
        return False
    expected = md5_upper(
        values["merchant_id"] + values["order_id"] + values["payhere_amount"]
        + values["payhere_currency"] + values["status_code"] + md5_upper(secret)
    )
    return hmac.compare_digest(expected, signature.upper())


def notification_amount(value: str) -> Decimal:
    if not re.fullmatch(r"[0-9]{1,24}\.[0-9]{2}", value):
        raise HTTPException(400, "Invalid payment amount.")
    amount = Decimal(value)
    if amount <= 0:
        raise HTTPException(400, "Invalid payment amount.")
    return amount


def configured_url(name: str, default: str = "", public: bool = False) -> str:
    value = os.getenv(name, default).strip().rstrip("/")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme not in ("http", "https") or not host
        or parsed.username or parsed.password or parsed.query or parsed.fragment
        or parsed.path not in ("", "/")
        or "your_" in value.lower() or "your-" in value.lower()
    ):
        raise HTTPException(503, f"Configure {name} with a valid base URL.")
    if public and (
        parsed.scheme != "https" or host == "localhost" or host.endswith(".localhost")
        or host.startswith("127.") or host in ("0.0.0.0", "::1")
    ):
        raise HTTPException(503, f"{name} must be a public HTTPS backend URL.")
    return value


@dataclass(frozen=True)
class Settings:
    merchant_id: str
    secret: str = field(repr=False)

    @classmethod
    def load(cls) -> Settings:
        if os.getenv("PAYHERE_SANDBOX", "").strip().lower() != "true":
            raise HTTPException(503, "This integration is configured for Sandbox only.")
        merchant_id = os.getenv("PAYHERE_MERCHANT_ID", "").strip()
        secret = os.getenv("PAYHERE_MERCHANT_SECRET", "").strip()
        if not re.fullmatch(r"[0-9]+", merchant_id) or not secret or secret.startswith("YOUR_"):
            raise HTTPException(503, "Configure PayHere Sandbox credentials in backend .env.")
        return cls(merchant_id=merchant_id, secret=secret)


def apply_notification(payment, order, code: str, provider_id: str, other_paid: list) -> None:
    """Caller holds the order and payment locks; never marks an order fulfilled."""
    now = utc_now()

    if payment.provider_payment_id and payment.provider_payment_id != provider_id:
        payment.requires_review = True
        return

    # An out-of-order pending event must not undo a terminal result.
    if code == "0":
        if payment.status == "pending":
            payment.provider_payment_id = provider_id
            payment.gateway_status_code = code
        return

    if code == "-3":
        payment.provider_payment_id = provider_id
        payment.gateway_status_code = code
        payment.status = "failed"
        payment.closed_at = payment.closed_at or now
        payment.requires_review = True
        # Keep paid_at if money had previously been received.
        return

    if code == "2":
        # A replayed success must not reverse a chargeback or an actual refund.
        if payment.gateway_status_code == "-3" or payment.status == "refunded":
            payment.requires_review = True
            return
        if payment.status in ("failed", "cancelled") or order.status == "cancelled" or other_paid:
            payment.requires_review = True
            for other in other_paid:
                other.requires_review = True
        payment.provider_payment_id = provider_id
        payment.gateway_status_code = code
        payment.status = "paid"
        payment.paid_at = payment.paid_at or now
        payment.closed_at = payment.closed_at or now
        return

    # Delayed failure/cancel notifications cannot reverse a verified success.
    if payment.status == "pending":
        payment.provider_payment_id = provider_id
        payment.gateway_status_code = code
        payment.status = "cancelled" if code == "-1" else "failed"
        payment.closed_at = now
