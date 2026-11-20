from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv


# Load backend/.env before importing database and API modules.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")


from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import engine


# Database models

from app.models.user import User
from app.models.farm import Farm
from app.models.crop_variety import CropVariety
from app.models.crop_cycle import CropCycle
from app.models.password_reset_token import PasswordResetToken
from app.models.harvest import Harvest
from app.models import stock

from app.models.order import Order, OrderItem
from app.models.order_payment import OrderPayment

from app.models.farmer_subscription import (
    FarmerSubscriptionPlan,
    FarmerSubscription,
    FarmerSubscriptionPayment,
)

from app.models.farmer_crop_access import FarmerCropAccess

from app.models.subscription_cash_receipt import (
    SubscriptionCashReceipt,
)
from app.models.farmer_purchase import (
    FarmerPurchase,
    FarmerPurchasePayment,
)

from app.models.user_status_history import UserStatusHistory

from app.models.farmer_payment_reversal import (
    FarmerPaymentReversal,
)

from app.models.subscription_cash_reversal import (
    SubscriptionCashReversal,
)

# API routers

from app.routers.auth import router as auth_router

from app.routers.password_reset import (
    router as password_reset_router,
)

from app.routers.crop_varieties import (
    router as crop_varieties_router,
)

from app.routers.farms import router as farms_router

from app.routers.crop_cycle import (
    router as crop_cycles_router,
)

from app.routers.harvests import (
    router as harvests_router,
)

from app.routers.admin_harvests import (
    router as admin_harvests_router,
)

from app.routers.public_harvests import (
    router as public_harvests_router,
)

from app.routers.public_stocks import (
    router as public_stocks_router,
)

from app.routers.dashboard import (
    router as dashboard_router,
)

from app.routers.crop_images import (
    router as crop_images_router,
)

from app.routers import admin_stock

from app.routers.orders import router as orders_router

from app.routers.weather import router as weather_router

from app.routers.crop_care_ai import (
    router as crop_care_ai_router,
)

from app.routers.crop_reminders import (
    router as crop_reminders_router,
)

from app.routers.crop_health_ai import (
    router as crop_health_router,
)

from app.routers import order_payments
from app.routers import farmer_subscriptions


# PayHere routers

from app.routers.payhere_checkout import (
    router as payhere_checkout_router,
)

from app.routers.subscription_payhere import (
    router as subscription_payhere_router,
)


# Cash subscription router

from app.routers.admin_cash_subscriptions import (
    router as admin_cash_subscriptions_router,
)


# First free crop cycle / subscription access

from app.services.crop_feature_access import (
    require_ai_crop_access,
)

from app.routers.admin_farmer_purchases import (
    router as admin_farmer_purchases_router,
)

from app.routers.admin_finance import (
    router as admin_finance_router,
)

from app.routers.admin_reports import (
    router as admin_reports_router,
)

from app.routers.admin_users import router as admin_users_router

from app.routers.farmer_payments import (
    router as farmer_payments_router,
)

from app.routers.admin_subscription_reversals import (
    router as admin_subscription_reversals_router,
)

from app.routers.admin_user_editor import (
    router as admin_user_editor_router,
)

# Application startup and shutdown

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        print("MySQL connection successful.")

        yield

    finally:
        engine.dispose()


app = FastAPI(
    title="Millet Plus API",
    lifespan=lifespan,
)


# Frontend CORS

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://millet-plus.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Register API routers

app.include_router(auth_router)
app.include_router(password_reset_router)

app.include_router(crop_varieties_router)
app.include_router(farms_router)
app.include_router(crop_cycles_router)

app.include_router(harvests_router)
app.include_router(admin_harvests_router)
app.include_router(public_harvests_router)
app.include_router(public_stocks_router)

app.include_router(dashboard_router)
app.include_router(crop_images_router)
app.include_router(admin_stock.router)

app.include_router(orders_router)
app.include_router(order_payments.router)

app.include_router(weather_router)
app.include_router(admin_farmer_purchases_router)

app.include_router(admin_finance_router)
app.include_router(admin_reports_router)
app.include_router(admin_users_router)

app.include_router(farmer_payments_router)
app.include_router(admin_subscription_reversals_router)
app.include_router(admin_user_editor_router)

# Access check for POST /ai/crop-care.
# Saved advice history remains readable.
app.include_router(
    crop_care_ai_router,
    dependencies=[
        Depends(require_ai_crop_access),
    ],
)

# Health Check and SMS access checks are inside their routers.
app.include_router(crop_health_router)
app.include_router(crop_reminders_router)

app.include_router(farmer_subscriptions.router)

app.include_router(payhere_checkout_router)
app.include_router(subscription_payhere_router)

app.include_router(admin_cash_subscriptions_router)


# Home endpoint

@app.get("/")
def home():
    return {
        "message": "Millet Plus backend is running"
    }