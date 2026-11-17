import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from app.config import settings


class EmailDeliveryError(Exception):
    """Raised when an email cannot be sent."""


def send_password_reset_otp(
    recipient_email: str,
    otp: str,
) -> None:
    smtp_username = settings.SMTP_USERNAME.strip()
    smtp_password = (
        settings.SMTP_PASSWORD
        .get_secret_value()
        .replace(" ", "")
    )
    sender_email = settings.SMTP_FROM_EMAIL.strip()

    if not smtp_username or not smtp_password or not sender_email:
        raise EmailDeliveryError(
            "Email service is not configured."
        )

    message = EmailMessage()

    message["Subject"] = "Millet Pulse - Password Reset OTP"

    message["From"] = formataddr(
        (
            settings.SMTP_FROM_NAME,
            sender_email,
        )
    )

    message["To"] = recipient_email

    message.set_content(
        "Hello,\n\n"
        "We received a request to reset your "
        "Millet Pulse password.\n\n"
        f"Your verification code is: {otp}\n\n"
        "This code expires in "
        f"{settings.RESET_OTP_EXPIRE_MINUTES} minutes "
        "and can only be used once.\n\n"
        "Do not share this code with anyone.\n\n"
        "If you did not request a password reset, "
        "you can ignore this email.\n\n"
        "Millet Pulse"
    )

    try:
        tls_context = ssl.create_default_context()

        with smtplib.SMTP(
            settings.SMTP_HOST,
            settings.SMTP_PORT,
            timeout=15,
        ) as smtp:
            smtp.ehlo()
            smtp.starttls(context=tls_context)
            smtp.ehlo()

            smtp.login(
                smtp_username,
                smtp_password,
            )

            smtp.send_message(message)

    except (smtplib.SMTPException, OSError) as exc:
        raise EmailDeliveryError(
            "Unable to send the verification email."
        ) from exc