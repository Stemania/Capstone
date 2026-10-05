"""Production workers never receive money: job amounts, purchase costs, invoice totals.

Walks every GET endpoint as a worker and scans each JSON response for money
keys and for the exact money values seeded below.
"""

import re
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.material_purchase import MaterialPurchase
from app.models.operation import JobOperation, OperationStatus
from app.models.sales_invoice import SalesInvoice, format_invoice_number
from app.models.supplier import Supplier
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile

PASSWORD = "Passw0rd!"

MONEY_KEYS = {
    "amount",
    "unitCost",
    "lineTotal",
    "subtotal",
    "vatRate",
    "vatAmount",
    "totalAmount",
    "totalSpend",
    "totalValue",
    "averageJobValue",
    "salesInvoice",
    "salesForecast",
    "materialsBySpend",
    "spendBySupplier",
}
# Distinctive values so a renamed money key still gets caught.
JOB_AMOUNT = 48213.57
UNIT_COST = 731.29
LINE_TOTAL = 1462.58
INVOICE_SUBTOTAL = 39871.43
INVOICE_TOTAL = 44655.6
MONEY_VALUES = {JOB_AMOUNT, UNIT_COST, LINE_TOTAL, INVOICE_SUBTOTAL, INVOICE_TOTAL}


def _user(email, role, name):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash(PASSWORD).decode("utf-8"),
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
    return user


@pytest.fixture
def seeded(app):
    with app.app_context():
        office = _user("office@money.test", UserRole.OFFICE_STAFF, "Office Person")
        worker = _user("worker@money.test", UserRole.PRODUCTION_WORKER, "Wes Worker")
        cust = Client(name="Money Client")
        supplier = Supplier(name="Money Supplier")
        db.session.add_all([cust, supplier])
        db.session.flush()
        job = JobOrder(
            client_id=cust.id,
            title="Money job",
            due_date=date.today() + timedelta(days=20),
            status=JobOrderStatus.IN_PROGRESS,
            job_type=JobType.FABRICATION,
            part_condition=PartCondition.RAW_MATERIAL,
            material_status=MaterialStatus.RECEIVED,
            raw_materials=[{"id": "m1", "name": "Plate", "quantity": 2, "unit": "pcs"}],
            amount=Decimal(str(JOB_AMOUNT)),
            supplier_id=supplier.id,
            created_by_id=office.id,
        )
        db.session.add(job)
        db.session.flush()
        op = JobOperation(
            job_order_id=job.id,
            sequence_no=1,
            operation_name="Cutting",
            assigned_worker_id=worker.id,
            estimated_hours=Decimal("2"),
            status=OperationStatus.PENDING,
        )
        db.session.add(op)
        db.session.add(
            MaterialPurchase(
                job_order_id=job.id,
                planned_material_id="m1",
                material_name="Plate",
                quantity=Decimal("2"),
                unit="pcs",
                unit_cost=Decimal(str(UNIT_COST)),
                supplier_id=supplier.id,
                date_ordered=date.today() - timedelta(days=5),
                date_received=date.today() - timedelta(days=1),
            )
        )
        db.session.add(
            SalesInvoice(
                invoice_seq=1,
                invoice_number=format_invoice_number(1),
                invoice_date=date.today(),
                job_order_id=job.id,
                client_id=cust.id,
                description="Money job",
                subtotal=Decimal(str(INVOICE_SUBTOTAL)),
                vat_rate=Decimal("12"),
                vat_amount=Decimal("4784.17"),
                total=Decimal(str(INVOICE_TOTAL)),
                prepared_by_id=office.id,
            )
        )
        db.session.commit()
        ids = {"job": job.id, "op": op.id, "worker": worker.id, "supplier": supplier.id}
        db.session.expunge_all()
        return ids


def _headers(client, email):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.get_json()
    return {"Authorization": f"Bearer {res.get_json()['accessToken']}"}


def _leaks(value, path="$"):
    found = []
    if isinstance(value, dict):
        for k, v in value.items():
            if k in MONEY_KEYS:
                found.append(f"{path}.{k}")
            found.extend(_leaks(v, f"{path}.{k}"))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            found.extend(_leaks(v, f"{path}[{i}]"))
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if round(float(value), 2) in MONEY_VALUES:
            found.append(f"{path}={value}")
    elif isinstance(value, str):
        for m in MONEY_VALUES:
            if re.search(rf"(?<![\d.]){re.escape(f'{m:.2f}')}(?!\d)", value.replace(",", "")):
                found.append(f"{path} contains {m}")
    return found


def _worker_get_urls(app, ids):
    urls = set()
    for rule in app.url_map.iter_rules():
        if "GET" not in rule.methods or not rule.rule.startswith("/api/"):
            continue
        url = rule.rule
        for arg in rule.arguments:
            if arg.endswith("_id") or arg == "id":
                if "/operations/" in url:
                    sub = ids["op"]
                elif "/workers/" in url or "/users/" in url:
                    sub = ids["worker"]
                elif "/suppliers/" in url:
                    sub = ids["supplier"]
                else:
                    sub = ids["job"]
            else:
                sub = "x"
            url = re.sub(rf"<(?:[^:>]+:)?{arg}>", sub, url)
        urls.add(url)
    today = date.today()
    urls.add(
        f"/api/v1/schedule/board?from={today - timedelta(days=7)}&to={today + timedelta(days=30)}"
    )
    return sorted(urls)


def test_worker_sees_the_job_but_no_money(client, seeded):
    worker = _headers(client, "worker@money.test")
    res = client.get(f"/api/v1/job-orders/{seeded['job']}", headers=worker)
    assert res.status_code == 200
    body = res.get_json()
    assert body["title"] == "Money job"
    assert _leaks(body) == []


def test_office_staff_do_see_the_money(client, seeded):
    office = _headers(client, "office@money.test")
    body = client.get(f"/api/v1/job-orders/{seeded['job']}", headers=office).get_json()
    assert body["amount"] == JOB_AMOUNT
    assert body["salesInvoice"]["total"] == INVOICE_TOTAL
    assert _leaks(body)


def test_no_worker_readable_endpoint_returns_money(app, client, seeded):
    worker = _headers(client, "worker@money.test")
    readable = []
    leaks = {}
    for url in _worker_get_urls(app, seeded):
        res = client.get(url, headers=worker)
        if res.status_code != 200 or not res.is_json:
            continue
        readable.append(url)
        found = _leaks(res.get_json())
        if found:
            leaks[url] = found[:5]
    assert f"/api/v1/job-orders/{seeded['job']}" in readable
    assert "/api/v1/operations/mine" in readable
    assert any(u.startswith("/api/v1/schedule/board?") for u in readable)
    assert leaks == {}
