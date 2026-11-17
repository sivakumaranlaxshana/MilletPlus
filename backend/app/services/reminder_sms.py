from __future__ import annotations

import argparse
import os
import re
import time
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError


NOTIFY_URL = "https://app.notify.lk/api/v1/send"

POLL_SECONDS = 5
ERROR_WAIT_SECONDS = 10
STALE_AFTER_MINUTES = 2

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def normalize_phone(value: str | None) -> str | None:
    phone = re.sub(
        r"[\s()-]",
        "",
        value or "",
    ).removeprefix("+")

    if re.fullmatch(r"07[0-9]{8}", phone):
        phone = "94" + phone[1:]

    if re.fullmatch(r"947[0-9]{8}", phone):
        return phone

    return None


def sms_message(task: str) -> str:
    clean_task = " ".join(str(task).split())
    message = f"Millet Plus: {clean_task}"

    encoded = message.encode("utf-16-le")

    if len(encoded) <= 268 * 2:
        return message

    shortened = encoded[: 267 * 2].decode(
        "utf-16-le",
        errors="ignore",
    )

    return shortened.rstrip() + "…"


def notify(
    client: httpx.Client,
    credentials: dict[str, str],
    phone: str,
    task: str,
) -> str:
    try:
        response = client.post(
            NOTIFY_URL,
            data={
                **credentials,
                "to": phone,
                "message": sms_message(task),
                "type": "unicode",
            },
        )
    except httpx.RequestError:
        # The provider may have received the request.
        # Do not automatically retry an uncertain send.
        return "unknown"

    if (
        400 <= response.status_code < 500
        and response.status_code != 408
    ):
        return "failed"

    if not response.is_success:
        return "unknown"

    try:
        payload = response.json()
    except ValueError:
        return "unknown"

    if not isinstance(payload, dict):
        return "unknown"

    provider_status = payload.get("status")

    if provider_status == "success":
        return "sent"

    if provider_status in ("error", "failed", "failure"):
        return "failed"

    return "unknown"


def process(
    db,
    client: httpx.Client,
    credentials: dict[str, str],
    test_phone: str | None,
    reminder_id: int | None,
):
    from app.models.crop_cycle import CropCycle
    from app.models.crop_reminder import CropReminder, utc_now
    from app.models.farm import Farm
    from app.models.user import User
    from app.services.crop_feature_access import (
        ensure_free_cycle_record,
        has_paid_subscription,
    )

    now = utc_now()

    # A previous worker may have stopped after contacting Notify.
    # Mark stale attempts unknown instead of sending them again.
    expired = (
        update(CropReminder)
        .where(
            CropReminder.sms_status == "sending",
            CropReminder.sms_attempted_at
            < now - timedelta(minutes=STALE_AFTER_MINUTES),
        )
        .values(sms_status="unknown")
        .execution_options(synchronize_session=False)
    )

    if reminder_id is not None:
        expired = expired.where(
            CropReminder.id == reminder_id,
        )

    db.execute(expired)
    db.commit()

    due = select(
        CropReminder.id,
        CropReminder.farmer_id,
    ).where(
        CropReminder.status == "pending",
        CropReminder.sms_status == "queued",
        CropReminder.remind_at <= now,
    )

    if reminder_id is not None:
        due = due.where(
            CropReminder.id == reminder_id,
        )

    candidate = db.execute(
        due.order_by(
            CropReminder.remind_at,
            CropReminder.id,
        ).limit(1)
    ).first()

    if candidate is None:
        db.rollback()
        return None

    item_id = candidate.id
    farmer_id = candidate.farmer_id

    # Check the test destination before changing the reminder.
    if test_phone is not None:
        owner_phone = db.scalar(
            select(User.phone).where(
                User.id == farmer_id,
            )
        )

        if normalize_phone(owner_phone) != test_phone:
            db.rollback()
            raise SystemExit(
                "This reminder does not belong to "
                "NOTIFY_TEST_PHONE. No SMS was sent."
            )

    # Persist the claim before contacting the SMS provider.
    # Only one worker can successfully claim this reminder.
    claimed = db.execute(
        update(CropReminder)
        .where(
            CropReminder.id == item_id,
            CropReminder.farmer_id == farmer_id,
            CropReminder.status == "pending",
            CropReminder.sms_status == "queued",
            CropReminder.remind_at <= now,
        )
        .values(
            sms_status="sending",
            sms_attempted_at=now,
        )
        .execution_options(synchronize_session=False)
    )

    claimed_count = claimed.rowcount
    db.commit()

    if claimed_count != 1:
        return None

    # Match the API's lock order: User first, Reminder second.
    farmer = db.scalar(
        select(User)
        .where(User.id == farmer_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    reminder = db.scalar(
        select(CropReminder)
        .where(
            CropReminder.id == item_id,
            CropReminder.farmer_id == farmer_id,
            CropReminder.sms_status == "sending",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if reminder is None:
        db.rollback()
        return None

    phone = normalize_phone(
        farmer.phone if farmer is not None else None,
    )

    can_send = bool(
        reminder.status == "pending"
        and reminder.remind_at <= utc_now()
        and farmer is not None
        and farmer.is_active
        and farmer.role == "farmer"
        and farmer.sms_opt_in
        and phone is not None
        and (
            test_phone is None
            or phone == test_phone
        )
    )

    # Confirm that the crop still belongs to this farmer.
    if can_send:
        owned_crop_id = db.scalar(
            select(CropCycle.id)
            .join(
                Farm,
                Farm.id == CropCycle.farm_id,
            )
            .where(
                CropCycle.id == reminder.crop_cycle_id,
                Farm.farmer_id == farmer_id,
            )
        )

        can_send = owned_crop_id is not None

    # Recheck access now: a subscription may have expired
    # after the reminder was created.
    if can_send:
        access = ensure_free_cycle_record(
            db,
            farmer_id,
        )

        is_free_cycle = (
            access is not None
            and access.free_crop_cycle_id
            == reminder.crop_cycle_id
        )

        can_send = (
            is_free_cycle
            or has_paid_subscription(db, farmer_id)
        )

        if (
            can_send
            and is_free_cycle
            and access.free_feature_used_at is None
        ):
            access.free_feature_used_at = utc_now()

    if not can_send:
        reminder.sms_status = "skipped"
    else:
        # Flush database changes before the external request.
        # The persisted "sending" claim protects uncertain outcomes.
        db.flush()

        reminder.sms_status = notify(
            client,
            credentials,
            phone,
            reminder.task,
        )

        if reminder.sms_status == "sent":
            reminder.sms_sent_at = utc_now()

    status = reminder.sms_status
    db.commit()

    print(
        f"Reminder #{item_id}: {status}",
        flush=True,
    )

    return status


def main():
    parser = argparse.ArgumentParser(
        description="Send due Millet Plus SMS reminders.",
    )

    parser.add_argument(
        "--reminder-id",
        type=int,
    )

    parser.add_argument(
        "--once",
        action="store_true",
    )

    args = parser.parse_args()

    if (
        args.reminder_id is not None
        and args.reminder_id < 1
    ):
        parser.error("--reminder-id must be positive.")

    load_dotenv(BACKEND_ROOT / ".env")

    enabled = (
        os.getenv("NOTIFY_REMINDER_ENABLED", "")
        .strip()
        .lower()
        == "true"
    )

    if not enabled:
        raise SystemExit(
            "Set NOTIFY_REMINDER_ENABLED=true "
            "to start the worker."
        )

    credentials = {
        "user_id": os.getenv(
            "NOTIFY_USER_ID", ""
        ).strip(),
        "api_key": os.getenv(
            "NOTIFY_API_KEY", ""
        ).strip(),
        "sender_id": os.getenv(
            "NOTIFY_SENDER_ID", ""
        ).strip(),
    }

    if not all(credentials.values()):
        raise SystemExit(
            "Set NOTIFY_USER_ID, NOTIFY_API_KEY "
            "and NOTIFY_SENDER_ID."
        )

    raw_test_phone = os.getenv(
        "NOTIFY_TEST_PHONE", ""
    ).strip()

    test_phone = normalize_phone(raw_test_phone)

    if raw_test_phone and not test_phone:
        raise SystemExit(
            "NOTIFY_TEST_PHONE must be a valid "
            "Sri Lankan mobile number."
        )

    if test_phone and args.reminder_id is None:
        raise SystemExit(
            "Test mode requires --reminder-id. "
            "Choose one reminder belonging to your number."
        )

    if (
        credentials["sender_id"].casefold() == "notifydemo"
        and (
            not test_phone
            or args.reminder_id is None
        )
    ):
        raise SystemExit(
            "NotifyDEMO requires NOTIFY_TEST_PHONE "
            "and --reminder-id."
        )

    # Register the same SQLAlchemy models as the API.
    import app.main  # noqa: F401
    from app.database import get_db

    database_session = contextmanager(get_db)

    print(
        "Millet Plus SMS worker started. "
        "Only due queued reminders with valid crop access "
        "will be sent.",
        flush=True,
    )

    try:
        with httpx.Client(timeout=15.0) as client:
            while True:
                try:
                    with database_session() as db:
                        try:
                            status = process(
                                db,
                                client,
                                credentials,
                                test_phone,
                                args.reminder_id,
                            )
                        except BaseException:
                            db.rollback()
                            raise

                except SQLAlchemyError:
                    print(
                        "Database operation failed. "
                        "SMS outcomes may be uncertain. "
                        "Uncertain sends will not be "
                        "automatically retried.",
                        flush=True,
                    )

                    if args.once or args.reminder_id is not None:
                        raise SystemExit(1) from None

                    time.sleep(ERROR_WAIT_SECONDS)
                    continue

                if args.once:
                    if status is None:
                        print(
                            "No queued SMS is due yet.",
                            flush=True,
                        )
                    return

                if (
                    args.reminder_id is not None
                    and status is not None
                ):
                    return

                if status is None:
                    time.sleep(POLL_SECONDS)

    except KeyboardInterrupt:
        print(
            "\nSMS worker stopped.",
            flush=True,
        )


if __name__ == "__main__":
    main()