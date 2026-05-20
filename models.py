"""SQLAlchemy 数据模型"""
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Project(db.Model):
    __tablename__ = "projects"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    boards = db.relationship("Board", backref="project", lazy="dynamic")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "board_count": self.boards.count(),
        }


class Board(db.Model):
    __tablename__ = "boards"
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    columns = db.relationship("Column", backref="board", lazy="dynamic", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "project_id": self.project_id,
            "name": self.name,
            "created_at": self.created_at.isoformat(),
        }


class Column(db.Model):
    __tablename__ = "columns"
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    position = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    cards = db.relationship("Card", backref="column", lazy="dynamic", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "board_id": self.board_id,
            "name": self.name,
            "position": self.position,
        }


class Card(db.Model):
    __tablename__ = "cards"
    id = db.Column(db.Integer, primary_key=True)
    column_id = db.Column(db.Integer, db.ForeignKey("columns.id", ondelete="CASCADE"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    priority = db.Column(db.String(20), default="medium")
    assignee = db.Column(db.String(100), default="")
    due_date = db.Column(db.String(20), default="")
    color = db.Column(db.String(20), default="")
    position = db.Column(db.Integer, default=0)
    version = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    labels = db.relationship("Label", backref="card", lazy="select", cascade="all, delete-orphan")
    comments = db.relationship("Comment", backref="card", lazy="select", cascade="all, delete-orphan")

    def to_dict(self, include_labels=True):
        data = {
            "id": self.id,
            "column_id": self.column_id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "assignee": self.assignee,
            "due_date": self.due_date,
            "color": self.color,
            "position": self.position,
            "version": self.version,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
        if include_labels:
            data["labels"] = [l.to_dict() for l in self.labels]
        return data


class Label(db.Model):
    __tablename__ = "labels"
    id = db.Column(db.Integer, primary_key=True)
    card_id = db.Column(db.Integer, db.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    name = db.Column(db.String(50), nullable=False)
    color = db.Column(db.String(20), default="#3498db")

    def to_dict(self):
        return {"id": self.id, "name": self.name, "color": self.color}


class Comment(db.Model):
    __tablename__ = "comments"
    id = db.Column(db.Integer, primary_key=True)
    card_id = db.Column(db.Integer, db.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    author = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "card_id": self.card_id,
            "author": self.author,
            "content": self.content,
            "created_at": self.created_at.isoformat(),
        }
