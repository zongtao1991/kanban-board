"""WebSocket 事件处理"""
import logging
from flask_socketio import join_room, leave_room, emit
from flask import request

logger = logging.getLogger(__name__)


def register_handlers(socketio):

    @socketio.on("join_board")
    def on_join_board(data):
        board_id = data.get("board_id")
        if board_id:
            join_room(f"board_{board_id}")
            emit("user_joined", {"board_id": board_id}, to=f"board_{board_id}")

    @socketio.on("leave_board")
    def on_leave_board(data):
        board_id = data.get("board_id")
        if board_id:
            leave_room(f"board_{board_id}")

    @socketio.on("join_project")
    def on_join_project(data):
        project_id = data.get("project_id")
        if project_id:
            join_room(f"project_{project_id}")
            emit("user_joined_project", {"project_id": project_id}, to=f"project_{project_id}")

    @socketio.on("leave_project")
    def on_leave_project(data):
        project_id = data.get("project_id")
        if project_id:
            leave_room(f"project_{project_id}")

    @socketio.on("card_moved")
    def on_card_moved(data):
        board_id = data.get("board_id")
        if board_id:
            emit("card_moved", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("card_created")
    def on_card_created(data):
        board_id = data.get("board_id")
        if board_id:
            emit("card_created", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("card_updated")
    def on_card_updated(data):
        board_id = data.get("board_id")
        if board_id:
            emit("card_updated", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("card_deleted")
    def on_card_deleted(data):
        board_id = data.get("board_id")
        if board_id:
            emit("card_deleted", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("column_created")
    def on_column_created(data):
        board_id = data.get("board_id")
        if board_id:
            emit("column_created", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("column_updated")
    def on_column_updated(data):
        board_id = data.get("board_id")
        if board_id:
            emit("column_updated", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("column_deleted")
    def on_column_deleted(data):
        board_id = data.get("board_id")
        if board_id:
            emit("column_deleted", data, to=f"board_{board_id}", include_self=False)

    @socketio.on("board_deleted")
    def on_board_deleted(data):
        project_id = data.get("project_id")
        if project_id:
            emit("board_deleted", data, to=f"project_{project_id}", include_self=False)
