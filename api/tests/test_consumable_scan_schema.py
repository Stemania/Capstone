"""Migration 052 columns exist on models (local DB after upgrade)."""


def test_tool_and_event_have_scan_columns(app):
    from app.models.shop_settings import ShopSettings
    from app.models.tool import Tool
    from app.models.tool_event import ToolEvent, ToolEventType

    assert hasattr(Tool, "legacy_unit")
    assert hasattr(Tool, "unit_needs_review")
    assert hasattr(Tool, "unit_cost")
    assert hasattr(ToolEvent, "stock_delta")
    assert hasattr(ToolEvent, "operation_id")
    assert hasattr(ToolEvent, "undoes_event_id")
    assert hasattr(ToolEvent, "undone_at")
    assert hasattr(ToolEvent, "client_action_id")
    assert ToolEventType.SCAN.value == "SCAN"
    assert ToolEventType.UNDO.value == "UNDO"
    assert ToolEventType.CORRECTION.value == "CORRECTION"
    assert hasattr(ShopSettings, "reorder_soon_working_days")
