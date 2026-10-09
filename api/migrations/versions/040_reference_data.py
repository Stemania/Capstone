"""Reference data: supplier codes, consumable shop terms, material catalog,
and shop details for printouts.

Revision ID: 040_reference_data
Revises: 039_action_received_times
Create Date: 2026-10-09

- suppliers.code: short code (2 to 5 uppercase letters, unique) used in PO
  numbers. Existing suppliers start without one.
- tools.shop_term: the shop's own word for a consumable, searchable.
- material_catalog: common raw materials offered as suggestions on order
  lines (name, shop term, grade suggestions, default unit, category).
- shop_settings: shop name, tagline, address, telephone, mobile numbers,
  email, and the PO and job order approvers. The existing row gets the
  shop's details where blank.

No job orders, operations, supplier orders or history rows are changed.
"""

import sqlalchemy as sa
from alembic import op

revision = "040_reference_data"
down_revision = "039_action_received_times"
branch_labels = None
depends_on = None

SHOP_DETAIL_COLUMNS = [
    ("shop_name", sa.String(length=255)),
    ("tagline", sa.String(length=500)),
    ("address", sa.String(length=500)),
    ("telephone", sa.String(length=100)),
    ("mobile_numbers", sa.String(length=200)),
    ("email", sa.String(length=255)),
    ("po_approver_name", sa.String(length=255)),
    ("po_approver_title", sa.String(length=255)),
    ("jo_approver_name", sa.String(length=255)),
    ("jo_approver_title", sa.String(length=255)),
]

SHOP_DETAIL_DEFAULTS = {
    "shop_name": "BROTHERS MACHINE SHOP and SERVICES CORP.",
    "tagline": (
        "Industrial, Electrical and Engineering Works, Plastic & Metal Fabrication, "
        "General Services"
    ),
    "address": "J.P. Laurel National Highway, San Pioquinto, Malvar, Batangas",
    "telephone": "(043) 4303524",
    "mobile_numbers": "09260056680 / 09157859720",
    "email": "brothersmachining@yahoo.com",
    "po_approver_name": "GREGORIO AGAO JR.",
    "po_approver_title": "General Manager",
    "jo_approver_name": "GARY AGAO",
    "jo_approver_title": "Production Head",
}


def upgrade():
    with op.batch_alter_table("suppliers") as batch:
        batch.add_column(sa.Column("code", sa.String(length=5), nullable=True))
        batch.create_unique_constraint("uq_suppliers_code", ["code"])
        batch.create_check_constraint(
            "ck_suppliers_code_format", "code IS NULL OR code ~ '^[A-Z]{2,5}$'"
        )

    op.add_column("tools", sa.Column("shop_term", sa.String(length=100), nullable=True))

    op.create_table(
        "material_catalog",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("shop_term", sa.String(length=100), nullable=True),
        sa.Column("grades", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("default_unit", sa.String(length=32), nullable=False, server_default="pcs"),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("name", name="uq_material_catalog_name"),
    )

    for name, type_ in SHOP_DETAIL_COLUMNS:
        op.add_column("shop_settings", sa.Column(name, type_, nullable=True))

    conn = op.get_bind()
    for column, value in SHOP_DETAIL_DEFAULTS.items():
        conn.execute(
            sa.text(
                f"UPDATE shop_settings SET {column} = :value "
                f"WHERE {column} IS NULL OR {column} = ''"
            ),
            {"value": value},
        )


def downgrade():
    for name, _ in reversed(SHOP_DETAIL_COLUMNS):
        op.drop_column("shop_settings", name)
    op.drop_table("material_catalog")
    op.drop_column("tools", "shop_term")
    with op.batch_alter_table("suppliers") as batch:
        batch.drop_constraint("ck_suppliers_code_format", type_="check")
        batch.drop_constraint("uq_suppliers_code", type_="unique")
        batch.drop_column("code")
