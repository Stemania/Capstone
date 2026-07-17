from flask import jsonify


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
