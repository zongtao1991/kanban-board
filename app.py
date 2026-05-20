"""Flask 应用工厂"""
import os
from flask import Flask
from flask_socketio import SocketIO
from models import db

socketio = SocketIO()


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["SECRET_KEY"] = os.urandom(24).hex()
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///kanban.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)
    socketio.init_app(app, async_mode="eventlet", cors_allowed_origins="*")

    from routes.projects import projects_bp
    from routes.boards import boards_bp
    from routes.columns import columns_bp
    from routes.cards import cards_bp
    from routes.comments import comments_bp

    app.register_blueprint(projects_bp)
    app.register_blueprint(boards_bp)
    app.register_blueprint(columns_bp)
    app.register_blueprint(cards_bp)
    app.register_blueprint(comments_bp)

    from socket_handlers import register_handlers
    register_handlers(socketio)

    with app.app_context():
        db.create_all()

    return app
