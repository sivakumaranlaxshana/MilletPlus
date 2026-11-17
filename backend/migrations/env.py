from logging.config import fileConfig

from alembic import context

from app.database import Base, engine
from app.models.user import User
from app.models.password_reset_token import PasswordResetToken
from app.models.crop_variety import CropVariety
from app.models.farm import Farm
from app.models.crop_cycle import CropCycle
from app.models.harvest import Harvest
from app.models import stock  
from app.models.order import Order, OrderItem
from app.models.crop_advice_history import CropAdviceHistory
from app.models.crop_reminder import CropReminder
from app.models.crop_health_check import CropHealthCheck
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


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=engine.url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()