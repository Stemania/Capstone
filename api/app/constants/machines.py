"""Company machine catalog and availability helpers."""

from collections import Counter

from app.models.operation import Operation, OperationStatus

# Actual shop floor machines at Brothers Machine Shop
MACHINE_CATALOG = [
    {"code": "LATHE", "name": "Lathe", "units": 7},
    {"code": "MILLING", "name": "Milling", "units": 8},
    {"code": "SHAPER", "name": "Shaper", "units": 1},
    {"code": "GRINDING", "name": "Grinding", "units": 2},
    {"code": "DRILLING", "name": "Drilling", "units": 1},
]

VALID_MACHINE_CODES = {m["code"] for m in MACHINE_CATALOG}

PRIORITY_VALUES = ("HIGH", "MODERATE", "LOW")


def count_machines_in_use(exclude_operation_id=None):
    """Count machine units currently occupied by IN_PROGRESS operations."""
    query = Operation.query.filter_by(status=OperationStatus.IN_PROGRESS)
    usage = Counter()
    for op in query.all():
        if exclude_operation_id and op.id == exclude_operation_id:
            continue
        for code in op.machines_needed or []:
            code = str(code).upper()
            if code in VALID_MACHINE_CODES:
                usage[code] += 1
    return usage


def get_machine_availability(exclude_operation_id=None):
    """Return catalog entries with inUse and available counts."""
    usage = count_machines_in_use(exclude_operation_id=exclude_operation_id)
    result = []
    for machine in MACHINE_CATALOG:
        in_use = int(usage.get(machine["code"], 0))
        total = int(machine["units"])
        available = max(0, total - in_use)
        result.append(
            {
                "code": machine["code"],
                "name": machine["name"],
                "units": total,
                "inUse": in_use,
                "available": available,
            }
        )
    return result


def assert_machines_available(machine_codes, exclude_operation_id=None):
    """Raise AppError if starting would overbook any machine type."""
    from app.utils.errors import AppError

    if not machine_codes:
        return

    needed = Counter(str(c).upper() for c in machine_codes if c)
    availability = {m["code"]: m for m in get_machine_availability(exclude_operation_id)}

    for code, count in needed.items():
        info = availability.get(code)
        if not info:
            raise AppError(f"Unknown machine type '{code}'", "VALIDATION_ERROR", 400)
        if info["available"] < count:
            raise AppError(
                f"Not enough {info['name']} available "
                f"({info['available']} free of {info['units']}; need {count})",
                "CONFLICT",
                409,
            )
