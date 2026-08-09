"""Company machine catalog and availability helpers."""

from collections import Counter

# Actual shop floor machines at Brothers Machine Shop (seed source of truth)
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
    """Count machine type units currently occupied by IN_PROGRESS operations."""
    from app.models.operation import JobOperation, OperationStatus

    query = JobOperation.query.filter_by(status=OperationStatus.IN_PROGRESS)
    usage = Counter()
    for op in query.all():
        if exclude_operation_id and op.id == exclude_operation_id:
            continue
        if op.machine_type and op.machine_type.code:
            usage[op.machine_type.code] += 1
    return usage


def get_machine_availability(exclude_operation_id=None):
    """Return catalog/DB entries with inUse and available counts."""
    from app.models.machine import MachineType

    usage = count_machines_in_use(exclude_operation_id=exclude_operation_id)
    types = MachineType.query.order_by(MachineType.name).all()
    if types:
        result = []
        for machine in types:
            in_use = int(usage.get(machine.code, 0))
            total = int(machine.units)
            available = max(0, total - in_use)
            result.append(
                {
                    "id": machine.id,
                    "code": machine.code,
                    "name": machine.name,
                    "units": total,
                    "inUse": in_use,
                    "available": available,
                }
            )
        return result

    # Fallback before migration/seed
    result = []
    for machine in MACHINE_CATALOG:
        in_use = int(usage.get(machine["code"], 0))
        total = int(machine["units"])
        available = max(0, total - in_use)
        result.append(
            {
                "id": None,
                "code": machine["code"],
                "name": machine["name"],
                "units": total,
                "inUse": in_use,
                "available": available,
            }
        )
    return result


def assert_machine_type_available(machine_type_id, exclude_operation_id=None):
    from app.models.machine import MachineType
    from app.utils.errors import AppError

    if not machine_type_id:
        return
    mt = MachineType.query.get(machine_type_id)
    if not mt:
        raise AppError("Invalid machine type", "VALIDATION_ERROR", 400)
    availability = {m["code"]: m for m in get_machine_availability(exclude_operation_id)}
    info = availability.get(mt.code)
    if not info:
        raise AppError(f"Unknown machine type '{mt.code}'", "VALIDATION_ERROR", 400)
    if info["available"] < 1:
        raise AppError(
            f"Not enough {info['name']} available "
            f"({info['available']} free of {info['units']})",
            "CONFLICT",
            409,
        )


def assert_machines_available(machine_codes, exclude_operation_id=None):
    """Legacy helper: codes list → availability check."""
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
