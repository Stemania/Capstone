"""JWT decode is pinned to HS256 (M-02)."""

import base64
import json

from app import create_app
from app.config import Config


class JwtConfig(Config):
    TESTING = True
    RATELIMIT_ENABLED = False


def _b64url(obj: dict) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def test_config_pins_hs256_only():
    app = create_app(JwtConfig)
    assert app.config["JWT_ALGORITHM"] == "HS256"
    assert app.config["JWT_DECODE_ALGORITHMS"] == ["HS256"]


def test_none_algorithm_token_is_rejected(client):
    header = {"alg": "none", "typ": "JWT"}
    payload = {"sub": "anyone", "role": "ADMIN"}
    bad = f"{_b64url(header)}.{_b64url(payload)}."
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {bad}"})
    assert res.status_code in (401, 422)
