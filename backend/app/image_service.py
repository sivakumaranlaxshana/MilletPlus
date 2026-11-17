from dataclasses import dataclass
from io import BytesIO
import warnings
from uuid import uuid4

import cloudinary.uploader
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings


MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000

ALLOWED_FORMATS = {
    "JPEG",
    "PNG",
    "WEBP",
}


class InvalidImageError(ValueError):
    pass


class ImageServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class UploadedImage:
    url: str
    public_id: str


def cloudinary_options() -> dict:
    cloud_name = settings.CLOUDINARY_CLOUD_NAME.strip()
    api_key = settings.CLOUDINARY_API_KEY.strip()
    api_secret = (
        settings.CLOUDINARY_API_SECRET
        .get_secret_value()
        .strip()
    )

    if not all((cloud_name, api_key, api_secret)):
        raise ImageServiceError(
            "Image service is not configured."
        )

    return {
        "cloud_name": cloud_name,
        "api_key": api_key,
        "api_secret": api_secret,
        "secure": True,
    }


def prepare_image(content: bytes) -> bytes:
    if not content:
        raise InvalidImageError(
            "Choose an image to upload."
        )

    if len(content) > MAX_IMAGE_BYTES:
        raise InvalidImageError(
            "Image size must not exceed 5 MB."
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter(
                "error",
                Image.DecompressionBombWarning,
            )

            # Inspect the real file format.
            with Image.open(BytesIO(content)) as image:
                if image.format not in ALLOWED_FORMATS:
                    raise InvalidImageError(
                        "Only JPEG, PNG and WebP images "
                        "are allowed."
                    )

                if (
                    image.width * image.height
                    > MAX_IMAGE_PIXELS
                ):
                    raise InvalidImageError(
                        "Image must not exceed 20 megapixels."
                    )

                if getattr(image, "is_animated", False):
                    raise InvalidImageError(
                        "Animated images are not supported."
                    )

                image.verify()

            # Decode and re-encode the image.
            # This also removes original metadata.
            with Image.open(BytesIO(content)) as image:
                image.load()

                corrected = ImageOps.exif_transpose(image)

                with corrected.convert("RGBA") as rgba:
                    with Image.new(
                        "RGB",
                        rgba.size,
                        "white",
                    ) as cleaned:
                        cleaned.paste(
                            rgba,
                            mask=rgba.getchannel("A"),
                        )

                        cleaned.thumbnail((2400, 2400))

                        output = BytesIO()

                        cleaned.save(
                            output,
                            format="JPEG",
                            quality=85,
                            optimize=True,
                        )

                        prepared = output.getvalue()

        if len(prepared) > MAX_IMAGE_BYTES:
            raise InvalidImageError(
                "Processed image is too large. "
                "Choose a smaller image."
            )

        return prepared

    except InvalidImageError:
        raise

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise InvalidImageError(
            "This file is not a valid supported image."
        ) from exc


def upload_crop_image(
    content: bytes,
    crop_id: int,
) -> UploadedImage:
    options = cloudinary_options()
    prepared = prepare_image(content)

    # A new ID avoids overwriting the existing image
    # before the database update succeeds.
    public_id = (
        f"millet_pulse/crops/{crop_id}/"
        f"{uuid4().hex}"
    )

    try:
        result = cloudinary.uploader.upload(
            BytesIO(prepared),
            public_id=public_id,
            resource_type="image",
            type="upload",
            overwrite=False,
            timeout=30,
            **options,
        )

    except Exception as exc:
        raise ImageServiceError(
            "Image upload failed. Please try again."
        ) from exc

    url = result.get("secure_url")
    returned_id = result.get("public_id")

    if (
        not isinstance(url, str)
        or not url.startswith("https://")
        or len(url) > 2048
        or returned_id != public_id
    ):
        delete_crop_image(public_id)

        raise ImageServiceError(
            "Image service returned an invalid response."
        )

    return UploadedImage(
        url=url,
        public_id=public_id,
    )


def delete_crop_image(public_id: str) -> bool:
    if not public_id.startswith(
        "millet_pulse/crops/"
    ):
        return False

    try:
        result = cloudinary.uploader.destroy(
            public_id,
            resource_type="image",
            type="upload",
            invalidate=True,
            timeout=30,
            **cloudinary_options(),
        )

        return result.get("result") in {
            "ok",
            "not found",
        }

    except Exception:
        return False