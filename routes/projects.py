"""项目 API"""
from flask import Blueprint, request, jsonify, render_template
from models import db, Project, Board, Column

projects_bp = Blueprint("projects", __name__)


@projects_bp.route("/")
def index():
    projects = Project.query.order_by(Project.created_at.desc()).all()
    return render_template("index.html", projects=projects)


@projects_bp.route("/api/projects", methods=["GET"])
def list_projects():
    projects = Project.query.order_by(Project.created_at.desc()).all()
    return jsonify([p.to_dict() for p in projects])


@projects_bp.route("/api/projects", methods=["POST"])
def create_project():
    data = request.get_json()
    project = Project(name=data["name"], description=data.get("description", ""))
    db.session.add(project)
    db.session.commit()

    default_board = Board(project_id=project.id, name="默认看板")
    db.session.add(default_board)
    db.session.commit()

    for i, col_name in enumerate(["待办", "进行中", "已完成"]):
        col = Column(board_id=default_board.id, name=col_name, position=i)
        db.session.add(col)
    db.session.commit()

    return jsonify(project.to_dict()), 201


@projects_bp.route("/api/projects/<int:pid>", methods=["PUT"])
def update_project(pid):
    project = Project.query.get_or_404(pid)
    data = request.get_json()
    project.name = data.get("name", project.name)
    project.description = data.get("description", project.description)
    db.session.commit()
    return jsonify(project.to_dict())


@projects_bp.route("/api/projects/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    project = Project.query.get_or_404(pid)
    db.session.delete(project)
    db.session.commit()
    return jsonify({"ok": True})


@projects_bp.route("/project/<int:pid>")
def project_board(pid):
    project = Project.query.get_or_404(pid)
    boards = Board.query.filter_by(project_id=pid).order_by(Board.created_at).all()
    return render_template("board.html", project=project, boards=boards)
