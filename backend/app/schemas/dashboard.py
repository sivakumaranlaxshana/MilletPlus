from pydantic import BaseModel, Field


class FarmerDashboardResponse(BaseModel):
    total_farms: int = Field(ge=0)
    total_crops: int = Field(ge=0)
    total_harvests: int = Field(ge=0)
    pending_harvests: int = Field(ge=0)


class AdminDashboardResponse(BaseModel):
    total_farmers: int = Field(ge=0)
    total_buyers: int = Field(ge=0)
    total_farms: int = Field(ge=0)
    total_crops: int = Field(ge=0)
    total_harvests: int = Field(ge=0)
    pending_harvests: int = Field(ge=0)