"""看板 API"""
from flask import Blueprint, request, jsonify
from sqlalchemy.orm import joinedload
from models import db, Board, Column, Card, Label

boards_bp = Blueprint("boards", __name__)


def get_project_id_from_board(board_id):
    """从看板 ID 获取项目 ID"""
    board = Board.query.filter_by(id=board_id).first()
    return board.project_id if board else None


@boards_bp.route("/api/projects/<int:pid>/boards", methods=["GET"])
def list_boards(pid):
    boards = Board.query.filter_by(project_id=pid).order_by(Board.created_at).all()
    return jsonify([b.to_dict() for b in boards])


@boards_bp.route("/api/projects/<int:pid>/boards", methods=["POST"])
def create_board(pid):
    data = request.get_json()
    board = Board(project_id=pid, name=data["name"])
    db.session.add(board)
    db.session.commit()
    return jsonify(board.to_dict()), 201


@boards_bp.route("/api/boards/<int:bid>", methods=["PUT"])
def update_board(bid):
    board = Board.query.get_or_404(bid)
    data = request.get_json()
    board.name = data.get("name", board.name)
    db.session.commit()
    return jsonify(board.to_dict())


@boards_bp.route("/api/boards/<int:bid>", methods=["DELETE"])
def delete_board(bid):
    """删除看板，返回看板 ID 用于广播"""
    board = Board.query.get_or_404(bid)
    project_id = board.project_id
    board_name = board.name
    
    db.session.delete(board)
    db.session.commit()
    
    return jsonify({
        "ok": True,
        "project_id": project_id,
        "board_id": bid,
        "board_name": board_name
    })


@boards_bp.route("/api/boards/<int:bid>/cards", methods=["GET"])
def get_board_cards(bid):
    """获取整个看板所有卡片（按列分组），使用 joinedload 避免 N+1 查询"""
    columns = Column.query.filter_by(board_id=bid).order_by(Column.position).all()
    column_ids = [col.id for col in columns]
    
    if not column_ids:
        result = {}
        for col in columns:
            result[col.id] = {
                "column": col.to_dict(),
                "cards": [],
            }
        return jsonify(result)
    
    cards = (
        Card.query
        .options(joinedload(Card.labels))
        .filter(Card.column_id.in_(column_ids))
        .order_by(Card.column_id, Card.position)
        .all()
    )
    
    cards_by_column = {}
    for card in cards:
        if card.column_id not in cards_by_column:
            cards_by_column[card.column_id] = []
        cards_by_column[card.column_id].append(card)
    
    result = {}
    for col in columns:
        col_cards = cards_by_column.get(col.id, [])
        result[col.id] = {
            "column": col.to_dict(),
            "cards": [c.to_dict(include_labels=False) for c in col_cards],
        }
        
        for i, card in enumerate(col_cards):
            result[col.id]["cards"][i]["labels"] = [l.to_dict() for l in card.labels]
    
    return jsonify(result)
