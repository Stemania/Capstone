import io
import uuid

import qrcode

from app.extensions import db
from app.models.tool import Tool
from app.models.tool_event import ToolEvent, ToolEventType
from app.utils.errors import AppError


def get_current_custody(tool_id):
    latest = (
        ToolEvent.query.filter_by(tool_id=tool_id)
        .order_by(ToolEvent.created_at.desc())
        .first()
    )
    if latest and latest.type == ToolEventType.BORROW:
        return {
            "holderId": latest.worker_id,
            "holderName": latest.worker.full_name if latest.worker else None,
            "since": latest.created_at.isoformat() if latest.created_at else None,
        }
    return None


def create_tool(name, code=None):
    if not code:
        code = f"TOOL-{uuid.uuid4().hex[:8].upper()}"
    if Tool.query.filter_by(code=code).first():
        raise AppError("Tool code already exists", "CONFLICT", 409)

    tool = Tool(name=name, code=code)
    db.session.add(tool)
    db.session.commit()
    return tool


def generate_qr_png(tool_code):
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(tool_code)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def scan_tool(code, worker_id, job_order_id=None):
    tool = Tool.query.filter_by(code=code).first()
    if not tool:
        raise AppError("Tool not found", "NOT_FOUND", 404)

    latest = (
        ToolEvent.query.filter_by(tool_id=tool.id)
        .order_by(ToolEvent.created_at.desc())
        .first()
    )

    if latest and latest.type == ToolEventType.BORROW:
        event_type = ToolEventType.RETURN
    else:
        event_type = ToolEventType.BORROW

    try:
        event = ToolEvent(
            tool_id=tool.id,
            worker_id=worker_id,
            type=event_type,
            job_order_id=job_order_id,
        )
        db.session.add(event)
        db.session.commit()
        return event
    except Exception:
        db.session.rollback()
        raise


def list_tool_events(tool_id=None, page=1, per_page=50):
    query = ToolEvent.query.order_by(ToolEvent.created_at.desc())
    if tool_id:
        query = query.filter_by(tool_id=tool_id)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return pagination
