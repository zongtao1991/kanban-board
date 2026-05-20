"""列 API"""
from flask import Blueprint, request, jsonify
from models import db, Column, Board

columns_bp = Blueprint("columns", __name__)


def get_board_id_from_column(column_id):
    """从列 ID 获取看板 ID"""
    col = Column.query.filter_by(id=column_id).first()
    return col.board_id if col else None


@columns_bp.route("/api/boards/<int:bid>/columns", methods=["GET"])
def list_columns(bid):
    columns = Column.query.filter_by(board_id=bid).order_by(Column.position).all()
    return jsonify([c.to_dict() for c in columns])


@columns_bp.route("/api/boards/<int:bid>/columns", methods=["POST"])
def create_column(bid):
    data = request.get_json()
    max_pos = db.session.query(db.func.max(Column.position)).filter_by(board_id=bid).scalar()
    col = Column(board_id=bid, name=data["name"], position=(max_pos or 0) + 1)
    db.session.add(col)
    db.session.commit()
    return jsonify(col.to_dict()), 201


@columns_bp.route("/api/columns/<int:cid>", methods=["PUT"])
def update_column(cid):
    col = Column.query.get_or_404(cid)
    data = request.get_json()
    col.name = data.get("name", col.name)
    if "position" in data:
        col.position = data["position"]
    db.session.commit()
    return jsonify(col.to_dict())


@columns_bp.route("/api/columns/<int:cid>", methods=["DELETE"])
def delete_column(cid):
    """删除列，返回看板 ID 用于广播"""
    col = Column.query.get_or_404(cid)
    board_id = col.board_id
    column_name = col.name
    
    db.session.delete(col)
    db.session.commit()
    
    return jsonify({
        "ok": True,
        "board_id": board_id,
        "column_id": cid,
        "column_name": column_name
    })
