import redis as redis_lib
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager
from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()
jwt = JWTManager()
bcrypt = Bcrypt()


class RedisClient:
    def __init__(self):
        self._client = None

    def init_app(self, app):
        url = app.config.get("REDIS_URL")
        if url:
            self._client = redis_lib.from_url(url, decode_responses=True)

    @property
    def client(self):
        return self._client

    def get(self, key):
        if self._client:
            return self._client.get(key)
        return None

    def set(self, key, value, ex=None):
        if self._client:
            return self._client.set(key, value, ex=ex)
        return None

    def delete(self, key):
        if self._client:
            return self._client.delete(key)
        return None


redis_client = RedisClient()
