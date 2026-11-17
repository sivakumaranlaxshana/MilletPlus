import csv

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import StringIO
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    Query,
    Response,
)
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.farmer_payment_reversal import (
    FarmerPaymentReversal,
)
from app.models.farmer_purchase import (
    FarmerPurchase,
    FarmerPurchasePayment,
)
from app.models.farmer_subscription import (
    FarmerSubscription,
    FarmerSubscriptionPayment,
)
from app.models.order import Order
from app.models.order_payment import OrderPayment
from app.models.subscription_cash_reversal import (
    SubscriptionCashReversal,
)
from app.models.user import User


router = APIRouter(
    prefix="/admin/reports",
    tags=["Admin Monthly Reports"],
)

DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]

Year = Annotated[int, Query(ge=2000, le=9998)]
Month = Annotated[int, Query(ge=1, le=12)]

SL_TIME = timezone(timedelta(hours=5, minutes=30))
ZERO = Decimal("0.00")


def utc_display(value):
    return value.replace(tzinfo=timezone.utc).isoformat()


def amount_sum(rows):
    return sum(
        (
            Decimal(str(row["amount"]))
            for row in rows
        ),
        ZERO,
    )


def build_report(db: Session, year: int, month: int):
    first = datetime(
        year,
        month,
        1,
        tzinfo=SL_TIME,
    )

    following = (
        datetime(year + 1, 1, 1, tzinfo=SL_TIME)
        if month == 12
        else datetime(year, month + 1, 1, tzinfo=SL_TIME)
    )

    start = first.astimezone(
        timezone.utc
    ).replace(tzinfo=None)

    end = following.astimezone(
        timezone.utc
    ).replace(tzinfo=None)

    buyer_rows = db.execute(
        select(OrderPayment, Order)
        .join(
            Order,
            Order.id == OrderPayment.order_id,
        )
        .where(
            OrderPayment.status == "paid",
            OrderPayment.requires_review.is_(False),
            OrderPayment.currency == "LKR",
            OrderPayment.paid_at >= start,
            OrderPayment.paid_at < end,
        )
        .order_by(
            OrderPayment.paid_at,
            OrderPayment.id,
        )
    ).all()

    buyers = [
        {
            "payment_id": payment.id,
            "order_id": order.id,
            "buyer_id": order.buyer_id,
            "payment_method": payment.provider,
            "amount": payment.amount,
            "paid_at": utc_display(payment.paid_at),
        }
        for payment, order in buyer_rows
    ]

    # A real cash refund does not erase the original cash receipt.
    # Recording-error receipts are excluded from original collections.
    subscription_rows = db.execute(
        select(
            FarmerSubscriptionPayment,
            FarmerSubscription,
        )
        .join(
            FarmerSubscription,
            FarmerSubscription.id
            == FarmerSubscriptionPayment.subscription_id,
        )
        .outerjoin(
            SubscriptionCashReversal,
            SubscriptionCashReversal.payment_id
            == FarmerSubscriptionPayment.id,
        )
        .where(
            or_(
                and_(
                    FarmerSubscriptionPayment.status == "paid",
                    SubscriptionCashReversal.id.is_(None),
                ),
                and_(
                    FarmerSubscriptionPayment.provider == "cash",
                    FarmerSubscriptionPayment.status == "refunded",
                    SubscriptionCashReversal.kind == "cash_refund",
                ),
            ),
            FarmerSubscriptionPayment.requires_review.is_(False),
            FarmerSubscriptionPayment.currency == "LKR",
            FarmerSubscriptionPayment.paid_at >= start,
            FarmerSubscriptionPayment.paid_at < end,
        )
        .order_by(
            FarmerSubscriptionPayment.paid_at,
            FarmerSubscriptionPayment.id,
        )
    ).all()

    subscriptions = [
        {
            "payment_id": payment.id,
            "subscription_id": subscription.id,
            "farmer_id": subscription.farmer_id,
            "plan_name": subscription.plan_name,
            "payment_method": payment.provider,
            "amount": payment.amount,
            "paid_at": utc_display(payment.paid_at),
        }
        for payment, subscription in subscription_rows
    ]

    subscription_reversal_rows = db.execute(
        select(
            SubscriptionCashReversal,
            FarmerSubscriptionPayment,
            FarmerSubscription,
        )
        .join(
            FarmerSubscriptionPayment,
            FarmerSubscriptionPayment.id
            == SubscriptionCashReversal.payment_id,
        )
        .join(
            FarmerSubscription,
            FarmerSubscription.id
            == FarmerSubscriptionPayment.subscription_id,
        )
        .where(
            SubscriptionCashReversal.effective_at >= start,
            SubscriptionCashReversal.effective_at < end,
        )
        .order_by(
            SubscriptionCashReversal.effective_at,
            SubscriptionCashReversal.id,
        )
    ).all()

    subscription_reversals = [
        {
            "reversal_id": reversal.id,
            "receipt_id": reversal.receipt_id,
            "payment_id": payment.id,
            "subscription_id": subscription.id,
            "farmer_id": subscription.farmer_id,
            "kind": reversal.kind,
            "amount": reversal.amount,
            "reason": reversal.reason,
            "refund_reference": reversal.refund_reference,
            "effective_at": utc_display(reversal.effective_at),
            "recorded_by": reversal.recorded_by,
            "recorded_at": utc_display(reversal.created_at),
        }
        for reversal, payment, subscription
        in subscription_reversal_rows
    ]

    subscription_refund_total = amount_sum([
        row
        for row in subscription_reversals
        if row["kind"] == "cash_refund"
    ])

    farmer_recording_error = select(
        FarmerPaymentReversal.id
    ).where(
        FarmerPaymentReversal.payment_id
        == FarmerPurchasePayment.id,
        FarmerPaymentReversal.kind == "recording_error",
    ).exists()

    farmer_payment_rows = db.execute(
        select(
            FarmerPurchasePayment,
            FarmerPurchase,
        )
        .join(
            FarmerPurchase,
            FarmerPurchase.id
            == FarmerPurchasePayment.purchase_id,
        )
        .where(
            ~farmer_recording_error,
            FarmerPurchasePayment.paid_at >= start,
            FarmerPurchasePayment.paid_at < end,
        )
        .order_by(
            FarmerPurchasePayment.paid_at,
            FarmerPurchasePayment.id,
        )
    ).all()

    farmer_payments = [
        {
            "payment_id": payment.id,
            "purchase_id": purchase.id,
            "farmer_id": purchase.farmer_id,
            "farmer_name": purchase.farmer_name,
            "variety_name": purchase.variety_name,
            "receipt_number": payment.receipt_number,
            "payment_method": payment.payment_method,
            "amount": payment.amount,
            "paid_at": utc_display(payment.paid_at),
        }
        for payment, purchase in farmer_payment_rows
    ]

    farmer_reversal_rows = db.execute(
        select(
            FarmerPaymentReversal,
            FarmerPurchasePayment,
            FarmerPurchase,
        )
        .join(
            FarmerPurchasePayment,
            FarmerPurchasePayment.id
            == FarmerPaymentReversal.payment_id,
        )
        .join(
            FarmerPurchase,
            FarmerPurchase.id
            == FarmerPurchasePayment.purchase_id,
        )
        .where(
            FarmerPaymentReversal.effective_at >= start,
            FarmerPaymentReversal.effective_at < end,
        )
        .order_by(
            FarmerPaymentReversal.effective_at,
            FarmerPaymentReversal.id,
        )
    ).all()

    farmer_reversals = [
        {
            "reversal_id": reversal.id,
            "payment_id": payment.id,
            "purchase_id": purchase.id,
            "farmer_id": purchase.farmer_id,
            "farmer_name": purchase.farmer_name,
            "amount": payment.amount,
            "kind": reversal.kind,
            "reason": reversal.reason,
            "return_reference": reversal.return_reference,
            "effective_at": utc_display(reversal.effective_at),
            "recorded_by": reversal.recorded_by,
            "recorded_at": utc_display(reversal.created_at),
        }
        for reversal, payment, purchase in farmer_reversal_rows
    ]

    farmer_return_total = amount_sum([
        row
        for row in farmer_reversals
        if row["kind"] == "cash_return"
    ])

    purchase_rows = db.scalars(
        select(FarmerPurchase)
        .where(
            FarmerPurchase.purchase_date >= first.date(),
            FarmerPurchase.purchase_date < following.date(),
        )
        .order_by(
            FarmerPurchase.purchase_date,
            FarmerPurchase.id,
        )
    ).all()

    purchases = [
        {
            "purchase_id": purchase.id,
            "stock_id": purchase.stock_id,
            "farmer_id": purchase.farmer_id,
            "farmer_name": purchase.farmer_name,
            "variety_name": purchase.variety_name,
            "purchase_date": purchase.purchase_date.isoformat(),
            "quantity_kg": purchase.quantity_kg,
            "unit_price": purchase.unit_price,
            "amount": purchase.total_amount,
        }
        for purchase in purchase_rows
    ]

    buyer_total = amount_sum(buyers)
    subscription_total = amount_sum(subscriptions)
    farmer_paid = amount_sum(farmer_payments)

    cash_subscription = amount_sum([
        row
        for row in subscriptions
        if row["payment_method"] == "cash"
    ])

    online_subscription = amount_sum([
        row
        for row in subscriptions
        if row["payment_method"] == "payhere"
    ])

    inflow = (
        buyer_total
        + subscription_total
        + farmer_return_total
    )

    outflow = farmer_paid + subscription_refund_total

    return {
        "year": year,
        "month": month,
        "currency": "LKR",
        "report_timezone": "Asia/Colombo",
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "summary": {
            "buyer_collections": buyer_total,
            "cash_subscription_collections": cash_subscription,
            "online_subscription_collections": online_subscription,
            "subscription_collections": subscription_total,
            "total_cash_inflow": inflow,
            "farmer_cash_outflow": farmer_paid,
            "farmer_cash_return_inflow": farmer_return_total,
            "farmer_net_cash_outflow": (
                farmer_paid - farmer_return_total
            ),
            "subscription_cash_refund_outflow": (
                subscription_refund_total
            ),
            "total_cash_outflow": outflow,
            "cash_difference": inflow - outflow,
            "purchase_amount_this_month": amount_sum(purchases),
            "purchased_quantity_kg": sum(
                (
                    row["quantity_kg"]
                    for row in purchases
                ),
                ZERO,
            ),
        },
        "buyer_payments": buyers,
        "subscription_payments": subscriptions,
        "subscription_cash_reversals": subscription_reversals,
        "farmer_payments": farmer_payments,
        "farmer_payment_reversals": farmer_reversals,
        "purchases": purchases,
        "report_basis": (
            "Cash report, not profit. Recording errors restate "
            "the original payment/collection period without "
            "creating new cash movement. Actual farmer cash "
            "returns are inflows in the return period. Actual "
            "cash subscription refunds are outflows in the "
            "refund period; their original collections remain. "
            "Purchase totals are not deducted again. Buyer and "
            "online subscription refunds, gateway fees and other "
            "expenses are not included. Test/sandbox records "
            "are included. Historical reports can change."
        ),
    }


@router.get("/monthly")
def monthly_report(
    year: Year,
    month: Month,
    db: DB,
    admin: Admin,
):
    return build_report(db, year, month)


def csv_value(value):
    if isinstance(value, str):
        if value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value

    return value


@router.get("/monthly/download")
def download_monthly_report(
    year: Year,
    month: Month,
    db: DB,
    admin: Admin,
):
    report = build_report(db, year, month)

    output = StringIO(newline="")
    writer = csv.writer(output)

    writer.writerow(["Millet Plus Monthly Cash Report"])
    writer.writerow(["Year", year, "Month", month])
    writer.writerow(["Currency", "LKR"])
    writer.writerow(["Period timezone", "Asia/Colombo"])
    writer.writerow(["Generated at", report["generated_at"]])
    writer.writerow([])

    writer.writerow(["SUMMARY"])
    writer.writerow(["Field", "Amount / Value"])

    for key, value in report["summary"].items():
        writer.writerow([key, value])

    for section in (
        "buyer_payments",
        "subscription_payments",
        "subscription_cash_reversals",
        "farmer_payments",
        "farmer_payment_reversals",
        "purchases",
    ):
        writer.writerow([])
        writer.writerow([section.upper()])

        rows = report[section]

        if not rows:
            writer.writerow(["No records"])
            continue

        columns = list(rows[0].keys())
        writer.writerow(columns)

        for row in rows:
            writer.writerow([
                csv_value(row[column])
                for column in columns
            ])

    writer.writerow([])
    writer.writerow([
        "REPORT BASIS",
        report["report_basis"],
    ])

    return Response(
        content=output.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                'attachment; filename="'
                f'millet-plus-report-{year}-{month:02d}.csv"'
            )
        },
    )