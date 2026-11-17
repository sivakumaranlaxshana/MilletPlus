from decimal import Decimal

from pydantic import BaseModel, Field


class PublicStockResponse(BaseModel):
    id: int

    variety_id: int
    variety_name: str

    available_quantity: Decimal = Field(
        ge=0,
    )

    selling_price_per_kg: Decimal = Field(
        gt=0,
    )

    in_stock: bool