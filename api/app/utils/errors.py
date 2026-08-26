from flask import jsonify
from flask_limiter.errors import RateLimitExceeded


class AppError(Exception):
    def __init__(self, message, code="ERROR", status_code=400):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


def register_error_handlers(app):
    @app.errorhandler(AppError)
    def handle_app_error(error):
        return (
            jsonify({"error": {"code": error.code, "message": error.message}}),
            error.status_code,
        )

    @app.errorhandler(RateLimitExceeded)
    def handle_rate_limit(error):
        message = (
            getattr(error, "description", None)
            or "Too many attempts. Please wait a minute and try again."
        )
        return (
            jsonify({"error": {"code": "RATE_LIMIT_EXCEEDED", "message": message}}),
            429,
        )

    @app.errorhandler(429)
    def handle_too_many_requests(error):
        message = (
            getattr(error, "description", None)
            or "Too many attempts. Please wait a minute and try again."
        )
        return (
            jsonify({"error": {"code": "RATE_LIMIT_EXCEEDED", "message": message}}),
            429,
        )

    @app.errorhandler(404)
    def handle_not_found(error):
        return (
            jsonify({"error": {"code": "NOT_FOUND", "message": "Resource not found"}}),
            404,
        )

    @app.errorhandler(500)
    def handle_internal(error):
        return (
            jsonify(
                {"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}}
            ),
            500,
        )
