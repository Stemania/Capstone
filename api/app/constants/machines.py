"""Company machine catalog and job-order field helpers."""

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
