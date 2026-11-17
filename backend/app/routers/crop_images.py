import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.image_service import (
    MAX_IMAGE_BYTES,
    ImageServiceError,
    InvalidImageError,
    delete_crop_image,
    upload_crop_image,
)
from app.models.crop_cycle import CropCycle
from app.models.farm import Farm
from app.models.user import User
from app.schemas.crop_cycle import CropCycleResponse


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/crop-cycles",
    tags=["Crop Images"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]


def get_owned_crop_for_update(
    db: Session,
    crop_id: int,
    farmer_id: int,
) -> CropCycle:
    statement = (
        select(CropCycle)
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .where(
            CropCycle.id == crop_id,
            Farm.farmer_id == farmer_id,
        )
        .with_for_update()
    )

    crop = db.scalar(statement)

    if crop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Crop not found.",
        )

    return crop


def remove_old_image(
    public_id: str | None,
) -> None:
    if public_id and not delete_crop_image(public_id):
        logger.warning(
            "Cloudinary image cleanup failed; "
            "manual cleanup may be required."
        )


# Upload a photo or replace the existing crop photo.

@router.put(
    "/{crop_id}/image",
    response_model=CropCycleResponse,
)
def upload_my_crop_image(
    crop_id: int,
    db: DatabaseSession,
    current_user: FarmerUser,
    file: Annotated[
        UploadFile,
        File(description="JPEG, PNG or WebP; maximum 5 MB."),
    ],
):
    try:
        crop = get_owned_crop_for_update(
            db=db,
            crop_id=crop_id,
            farmer_id=current_user.id,
        )

        # Read only enough to enforce the size limit.
        content = file.file.read(
            MAX_IMAGE_BYTES + 1
        )

        if len(content) > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Image size must not exceed 5 MB.",
            )

        try:
            uploaded = upload_crop_image(
                content=content,
                crop_id=crop.id,
            )

        except InvalidImageError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from None

        except ImageServiceError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Image service is unavailable. "
                    "Please try again."
                ),
            ) from None

        old_public_id = crop.image_public_id

        crop.image_url = uploaded.url
        crop.image_public_id = uploaded.public_id

        try:
            db.commit()

        except SQLAlchemyError:
            db.rollback()

            # Keep the newly uploaded asset because a
            # connection failure can leave commit status
            # uncertain. Avoid deleting a referenced image.
            logger.warning(
                "Crop image database save failed; "
                "Cloudinary reconciliation may be required."
            )

            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Could not confirm the image save. "
                    "Reload the crop before retrying."
                ),
            ) from None

        # Delete the old image only after the new reference
        # has been committed successfully.
        remove_old_image(old_public_id)

        db.refresh(crop)

        return crop

    finally:
        file.file.close()


# Remove the photo reference, then clean up Cloudinary.

@router.delete(
    "/{crop_id}/image",
    response_model=CropCycleResponse,
)
def delete_my_crop_image(
    crop_id: int,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    crop = get_owned_crop_for_update(
        db=db,
        crop_id=crop_id,
        farmer_id=current_user.id,
    )

    old_public_id = crop.image_public_id

    crop.image_url = None
    crop.image_public_id = None

    try:
        db.commit()

    except SQLAlchemyError:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not confirm the image removal. "
                "Reload the crop before retrying."
            ),
        ) from None

    remove_old_image(old_public_id)

    db.refresh(crop)

    return crop