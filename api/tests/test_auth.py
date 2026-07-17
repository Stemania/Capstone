from app.extensions import bcrypt, db
from app.models.user import User, UserRole


def test_login_success(client, app):
    with app.app_context():
        user = User(
            email="test@bmsc.local",
            password_hash=bcrypt.generate_password_hash("Test123!").decode("utf-8"),
            full_name="Test User",
            role=UserRole.ADMIN,
            active=True,
        )
        db.session.add(user)
        db.session.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test@bmsc.local", "password": "Test123!"},
    )
    assert response.status_code == 200
    data = response.get_json()
    assert "accessToken" in data
    assert data["user"]["email"] == "test@bmsc.local"


def test_login_invalid_credentials(client, app):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "wrong@bmsc.local", "password": "wrong"},
    )
    assert response.status_code == 401
