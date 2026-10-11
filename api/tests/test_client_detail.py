"""Client detail lists each job's client PO date (used for "Client since" / "Last order")."""

from datetime import date, timedelta

from app.extensions import db
from tests.test_material_delay import _headers, _job, _local, shop  # noqa: F401


def test_client_detail_jobs_include_po_date(client, shop):
    tomorrow = shop["today"] + timedelta(days=1)
    with_po, _ = _job(shop, _local(tomorrow, 9))
    without_po, _ = _job(shop, _local(tomorrow, 9))
    with_po.po_date = date(2025, 3, 14)
    db.session.commit()

    res = client.get(f"/api/v1/clients/{shop['client'].id}", headers=_headers(shop["office"]))
    assert res.status_code == 200, res.get_json()
    by_id = {j["id"]: j for j in res.get_json()["jobs"]}
    assert by_id[with_po.id]["poDate"] == "2025-03-14"
    assert by_id[without_po.id]["poDate"] is None
