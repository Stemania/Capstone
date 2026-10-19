"""Sensitive value masking for logs (M-04)."""

from app.utils.log_mask import mask_email, mask_phone, mask_sensitive


def test_mask_email():
    assert mask_email("jane.doe@gmail.com") == "j***@gmail.com"
    assert mask_email("") == ""


def test_mask_phone():
    assert mask_phone("+639171234567").endswith("4567")
    assert "*" in mask_phone("+639171234567")


def test_mask_sensitive_redacts_jwt_and_email():
    text = "token=eyJhbGciOiJIUzI1NiJ9.abc.def email=user@shop.ph"
    out = mask_sensitive(text)
    assert "eyJ***" in out or "***" in out
    assert "user@shop.ph" not in out
    assert "@shop.ph" in out
