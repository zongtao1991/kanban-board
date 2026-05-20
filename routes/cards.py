"""卡片 API — 含移动逻辑"""
from flask import Blueprint, request, jsonify
from sqlalchemy import text
from sqlalchemy.orm import joinedload
from models import db, Card, Label, Column

cards_bp = Blueprint("cards", __name__)


def get_board_id_from_column(column_id):
    """从列 ID 获取看板 ID"""
    col = Column.query.filter_by(id=column_id).first()
    return col.board_id if col else None


@cards_bp.route("/api/columns/<int:cid>/cards", methods=["GET"])
def list_cards(cid):
    """获取列的所有卡片，使用 joinedload 预加载标签避免 N+1 查询"""
    cards = (
        Card.query
        .options(joinedload(Card.labels))
        .filter_by(column_id=cid)
        .order_by(Card.position)
        .all()
    )
    
    result = []
    for card in cards:
        card_dict = card.to_dict(include_labels=False)
        card_dict["labels"] = [l.to_dict() for l in card.labels]
        result.append(card_dict)
    
    return jsonify(result)


@cards_bp.route("/api/columns/<int:cid>/cards", methods=["POST"])
def create_card(cid):
    data = request.get_json()
    
    try:
        db.session.begin_nested()
        
        max_pos = db.session.query(db.func.max(Card.position)).filter_by(
            column_id=cid
        ).scalar()
        
        card = Card(
            column_id=cid,
            title=data["title"],
            description=data.get("description", ""),
            priority=data.get("priority", "medium"),
            assignee=data.get("assignee", ""),
            due_date=data.get("due_date", ""),
            color=data.get("color", ""),
            position=(max_pos or 0) + 1,
            version=0,
        )
        db.session.add(card)
        db.session.flush()
        
        for label_data in data.get("labels", []):
            label = Label(card_id=card.id, name=label_data["name"], color=label_data.get("color", "#3498db"))
            db.session.add(label)
        
        db.session.commit()
        
        card_dict = card.to_dict(include_labels=False)
        card_dict["labels"] = [l.to_dict() for l in card.labels]
        
        return jsonify(card_dict), 201
        
    except Exception as e:
        db.session.rollback()
        raise e


@cards_bp.route("/api/cards/<int:card_id>", methods=["GET"])
def get_card(card_id):
    """获取单个卡片，使用 joinedload 预加载标签"""
    card = (
        Card.query
        .options(joinedload(Card.labels))
        .filter_by(id=card_id)
        .first_or_404()
    )
    
    card_dict = card.to_dict(include_labels=False)
    card_dict["labels"] = [l.to_dict() for l in card.labels]
    
    return jsonify(card_dict)


@cards_bp.route("/api/cards/<int:card_id>", methods=["PUT"])
def update_card(card_id):
    """更新卡片，使用原子级 SQL + 版本号检查实现乐观锁
    
    API 协议强制约束：必须传入 version 字段，否则返回 400
    """
    data = request.get_json()
    client_version = data.get("version")
    
    if client_version is None:
        return jsonify({
            "error": "缺少参数",
            "message": "必须传入 version 字段进行乐观锁检查"
        }), 400
    
    result = db.session.execute(
        text("""
            UPDATE cards 
            SET title = :title,
                description = :description,
                priority = :priority,
                assignee = :assignee,
                due_date = :due_date,
                color = :color,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :card_id 
            AND version = :client_version
            RETURNING id, column_id, title, description, priority, assignee, due_date, color, position, version, created_at, updated_at
        """),
        {
            "card_id": card_id,
            "client_version": client_version,
            "title": data.get("title", ""),
            "description": data.get("description", ""),
            "priority": data.get("priority", "medium"),
            "assignee": data.get("assignee", ""),
            "due_date": data.get("due_date", ""),
            "color": data.get("color", ""),
        }
    )
    
    row = result.fetchone()
    db.session.commit()
    
    if row is None:
        card = Card.query.get_or_404(card_id)
        card_dict = card.to_dict(include_labels=False)
        card_dict["labels"] = [l.to_dict() for l in card.labels]
        return jsonify({
            "error": "版本冲突",
            "message": "卡片已被其他用户修改",
            "card": card_dict
        }), 409
    
    card_dict = {
        "id": row[0],
        "column_id": row[1],
        "title": row[2],
        "description": row[3],
        "priority": row[4],
        "assignee": row[5],
        "due_date": row[6],
        "color": row[7],
        "position": row[8],
        "version": row[9],
        "created_at": row[10].isoformat() if row[10] else None,
        "updated_at": row[11].isoformat() if row[11] else None,
        "labels": []
    }
    
    labels = Label.query.filter_by(card_id=card_dict["id"]).all()
    card_dict["labels"] = [l.to_dict() for l in labels]
    
    return jsonify(card_dict)


@cards_bp.route("/api/cards/<int:card_id>", methods=["DELETE"])
def delete_card(card_id):
    """删除卡片，使用原子 SQL 调整位置，并返回看板 ID 用于广播"""
    card = Card.query.get_or_404(card_id)
    original_column_id = card.column_id
    original_position = card.position
    
    board_id = get_board_id_from_column(original_column_id)
    
    db.session.delete(card)
    
    db.session.execute(
        text("UPDATE cards SET position = position - 1 WHERE column_id = :cid AND position > :pos"),
        {"cid": original_column_id, "pos": original_position}
    )
    
    db.session.commit()
    
    return jsonify({
        "ok": True,
        "board_id": board_id,
        "card_id": card_id,
        "column_id": original_column_id
    })


@cards_bp.route("/api/cards/<int:card_id>/move", methods=["POST"])
def move_card(card_id):
    """
    移动卡片到目标列+位置，使用原子级 SQL UPDATE 实现乐观锁。
    
    策略：
    1. 先进行参数校验（包括 version）
    2. 再获取卡片当前状态
    3. 执行原子级位置调整 SQL
    4. 执行带版本检查的 UPDATE，通过 affected rows 判断冲突
    5. 冲突时返回 409 和最新数据
    """
    data = request.get_json()
    target_column_id = data.get("column_id")
    target_position = data.get("position")
    client_version = data.get("version")
    
    if target_column_id is None or target_position is None:
        return jsonify({"error": "缺少参数"}), 400
    
    if client_version is None:
        return jsonify({
            "error": "缺少参数",
            "message": "必须传入 version 字段进行乐观锁检查"
        }), 400
    
    card = Card.query.options(joinedload(Card.labels)).filter_by(id=card_id).first_or_404()
    original_column_id = card.column_id
    original_position = card.position
    
    board_id = get_board_id_from_column(target_column_id)
    
    if original_column_id == target_column_id and target_position == original_position:
        card_dict = card.to_dict(include_labels=False)
        card_dict["labels"] = [l.to_dict() for l in card.labels]
        return jsonify(card_dict)
    
    try:
        db.session.begin_nested()
        
        if original_column_id == target_column_id:
            if target_position > original_position:
                db.session.execute(
                    text("""
                        UPDATE cards 
                        SET position = position - 1 
                        WHERE column_id = :cid 
                        AND position > :original_pos 
                        AND position <= :target_pos
                    """),
                    {
                        "cid": target_column_id,
                        "original_pos": original_position,
                        "target_pos": target_position
                    }
                )
            else:
                db.session.execute(
                    text("""
                        UPDATE cards 
                        SET position = position + 1 
                        WHERE column_id = :cid 
                        AND position >= :target_pos 
                        AND position < :original_pos
                    """),
                    {
                        "cid": target_column_id,
                        "original_pos": original_position,
                        "target_pos": target_position
                    }
                )
        else:
            db.session.execute(
                text("""
                    UPDATE cards 
                    SET position = position - 1 
                    WHERE column_id = :cid 
                    AND position > :pos
                """),
                {"cid": original_column_id, "pos": original_position}
            )
            
            db.session.execute(
                text("""
                    UPDATE cards 
                    SET position = position + 1 
                    WHERE column_id = :cid 
                    AND position >= :pos
                """),
                {"cid": target_column_id, "pos": target_position}
            )
        
        result = db.session.execute(
            text("""
                UPDATE cards 
                SET column_id = :target_column_id,
                    position = :target_position,
                    version = version + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :card_id 
                AND version = :client_version
                RETURNING id, column_id, title, description, priority, assignee, due_date, color, position, version, created_at, updated_at
            """),
            {
                "card_id": card_id,
                "client_version": client_version,
                "target_column_id": target_column_id,
                "target_position": target_position
            }
        )
        
        row = result.fetchone()
        db.session.commit()
        
        if row is None:
            current_card = Card.query.options(joinedload(Card.labels)).filter_by(id=card_id).first_or_404()
            card_dict = current_card.to_dict(include_labels=False)
            card_dict["labels"] = [l.to_dict() for l in current_card.labels]
            return jsonify({
                "error": "版本冲突",
                "message": "卡片已被其他用户修改",
                "card": card_dict
            }), 409
        
        card_dict = {
            "id": row[0],
            "column_id": row[1],
            "title": row[2],
            "description": row[3],
            "priority": row[4],
            "assignee": row[5],
            "due_date": row[6],
            "color": row[7],
            "position": row[8],
            "version": row[9],
            "created_at": row[10].isoformat() if row[10] else None,
            "updated_at": row[11].isoformat() if row[11] else None,
            "labels": [],
            "board_id": board_id,
            "from_column": original_column_id,
            "to_column": target_column_id
        }
        
        labels = Label.query.filter_by(card_id=card_dict["id"]).all()
        card_dict["labels"] = [l.to_dict() for l in labels]
        
        return jsonify(card_dict)
        
    except Exception as e:
        db.session.rollback()
        raise e
