"""评论 API"""
from flask import Blueprint, request, jsonify
from models import db, Comment

comments_bp = Blueprint("comments", __name__)


@comments_bp.route("/api/cards/<int:card_id>/comments", methods=["GET"])
def list_comments(card_id):
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    comments = Comment.query.filter_by(card_id=card_id).order_by(
        Comment.created_at.desc()
    ).paginate(page=page, per_page=per_page)
    return jsonify({
        "items": [c.to_dict() for c in comments.items],
        "total": comments.total,
        "page": page,
        "pages": comments.pages,
    })


@comments_bp.route("/api/cards/<int:card_id>/comments", methods=["POST"])
def create_comment(card_id):
    data = request.get_json()
    comment = Comment(
        card_id=card_id,
        author=data.get("author", "匿名"),
        content=data["content"],
    )
    db.session.add(comment)
    db.session.commit()
    return jsonify(comment.to_dict()), 201
