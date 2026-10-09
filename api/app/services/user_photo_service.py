"""User photos: resized on upload to a 128x128 JPEG and kept in the database."""

from __future__ import annotations

import io
from datetime import datetime, timezone

from PIL import Image, ImageOps, UnidentifiedImageError

from app.extensions import db
from app.models.user import User, UserPhoto, UserRole
from app.utils.errors import AppError

MAX_PHOTO_BYTES = 2 * 1024 * 1024
PHOTO_SIZE = 128
ACCEPTED_FORMATS = {"JPEG", "PNG"}


def resize_photo(raw: bytes) -> bytes:
    """A square 128x128 JPEG from JPEG or PNG bytes up to 2 MB."""
    if len(raw) > MAX_PHOTO_BYTES:
        raise AppError("The photo must be 2 MB or smaller", "PHOTO_TOO_LARGE", 413)
    try:
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise AppError("Upload a JPEG or PNG photo", "PHOTO_INVALID", 400)
    if fmt not in ACCEPTED_FORMATS:
        raise AppError("Upload a JPEG or PNG photo", "PHOTO_INVALID", 400)

    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        img = flat
    else:
        img = img.convert("RGB")
    img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


def _get_user(user_id) -> User:
    user = db.session.get(User, user_id)
    if not user:
        raise AppError("User not found", "NOT_FOUND", 404)
    return user


def save_photo(user_id, raw: bytes) -> User:
    user = _get_user(user_id)
    data = resize_photo(raw)
    now = datetime.now(timezone.utc)
    row = db.session.get(UserPhoto, user.id)
    if row is None:
        db.session.add(UserPhoto(user_id=user.id, data=data, updated_at=now))
    else:
        row.data = data
        row.updated_at = now
    user.photo_updated_at = now
    db.session.commit()
    return user


def delete_photo(user_id) -> User:
    user = _get_user(user_id)
    row = db.session.get(UserPhoto, user.id)
    if row is not None:
        db.session.delete(row)
    user.photo_updated_at = None
    db.session.commit()
    return user


def _shares_a_job(viewer_id, target_id) -> bool:
    from app.models.job_order import JobOrder, PRODUCTION_VISIBLE_STATUSES
    from app.models.operation import JobOperation

    mine = (
        db.session.query(JobOperation.job_order_id)
        .join(JobOrder, JobOrder.id == JobOperation.job_order_id)
        .filter(
            JobOperation.crew_includes(viewer_id),
            JobOrder.status.in_(tuple(PRODUCTION_VISIBLE_STATUSES)),
        )
    )
    return (
        db.session.query(JobOperation.id)
        .filter(
            JobOperation.crew_includes(target_id),
            JobOperation.job_order_id.in_(mine),
        )
        .first()
        is not None
    )


def can_view_photo(viewer_id, viewer_role, target_id) -> bool:
    """Admin and Office Staff see every photo. A production worker sees their
    own, and the photos of people assigned to the jobs they work on."""
    if viewer_role != UserRole.PRODUCTION_WORKER.value or viewer_id == target_id:
        return True
    return _shares_a_job(viewer_id, target_id)


def get_photo(viewer_id, viewer_role, target_id) -> UserPhoto:
    """The photo row, or 404 (also when the viewer may not see it)."""
    if not can_view_photo(viewer_id, viewer_role, target_id):
        raise AppError("Photo not found", "NOT_FOUND", 404)
    row = db.session.get(UserPhoto, target_id)
    if row is None:
        raise AppError("Photo not found", "NOT_FOUND", 404)
    return row
