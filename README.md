# 看板项目管理 — PRD

**技术栈:** Python

---


### 概述
基于 Flask 的全栈看板项目管理应用，支持多项目、多看板、卡片拖拽排序、实时协作。

### 技术栈
- Python 3.11+ / Flask / Flask-SocketIO
- SQLAlchemy + SQLite
- Jinja2 模板 + 原生 JavaScript（拖拽排序）
- eventlet 异步模式

### 端口
7952

### 核心功能

### 1. 项目管理
- 创建/编辑/删除项目
- 项目列表页，显示项目名称、描述、卡片数量
- 删除项目时级联删除所有看板、卡片、评论

### 2. 看板管理
- 每个项目可创建多个看板
- 看板包含多个列（如：待办、进行中、已完成）
- 列可拖拽排序、重命名

### 3. 卡片管理
- 卡片归属列，支持拖拽移动到其他列
- 卡片字段：标题、描述、优先级（低/中/高/紧急）、截止日期、负责人
- 卡片在同一列内可上下拖拽排序
- 卡片详情弹窗：编辑所有字段、查看/添加评论
- 卡片可设置颜色标签

### 4. 实时协作
- 多人同时打开同一看板，拖拽操作实时同步
- 卡片移动、新建、删除通过 WebSocket 广播
- 用户在线状态显示

### 5. 筛选与搜索
- 按优先级、负责人、标签筛选卡片
- 按标题模糊搜索

### 数据模型

```python
# 项目
class Project:
    id, name, description, created_at

# 看板
class Board:
    id, project_id(FK), name, created_at

# 列
class Column:
    id, board_id(FK), name, position, created_at

# 卡片
class Card:
    id, column_id(FK), title, description, priority,
    assignee, due_date, color, position, created_at, updated_at

# 评论
class Comment:
    id, card_id(FK), author, content, created_at

# 标签
class Label:
    id, card_id(FK), name, color
```

### API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 项目列表页 |
| `/project/<id>` | GET | 项目看板页 |
| `/api/projects` | GET/POST | 项目 CRUD |
| `/api/projects/<id>` | PUT/DELETE | 项目更新/删除 |
| `/api/projects/<pid>/boards` | GET/POST | 看板 CRUD |
| `/api/boards/<bid>` | PUT/DELETE | 看板更新/删除 |
| `/api/boards/<bid>/columns` | GET/POST | 列 CRUD |
| `/api/columns/<cid>` | PUT/DELETE | 列更新/删除 |
| `/api/columns/<cid>/cards` | GET/POST | 卡片 CRUD |
| `/api/cards/<cid>` | GET/PUT/DELETE | 卡片详情/更新/删除 |
| `/api/cards/<cid>/move` | POST | 移动卡片到目标列+位置 |
| `/api/cards/<cid>/comments` | GET/POST | 评论 CRUD |
| `/api/boards/<bid>/cards` | GET | 获取整个看板所有卡片 |

### WebSocket 事件

| 事件 | 方向 | 数据 |
|------|------|------|
| `join_board` | C→S | `{board_id}` |
| `card_moved` | S↔C | `{card_id, from_column, to_column, position}` |
| `card_created` | S↔C | `{card}` |
| `card_updated` | S↔C | `{card}` |
| `card_deleted` | S↔C | `{card_id}` |
| `column_created` | S↔C | `{column}` |
| `column_updated` | S↔C | `{column}` |

### 文件结构
```
kanban-board/
├── app.py                  # Flask 应用工厂 + 路由注册
├── models.py               # SQLAlchemy 模型定义
├── routes/
│   ├── __init__.py
│   ├── projects.py         # 项目 API
│   ├── boards.py           # 看板 API
│   ├── columns.py          # 列 API
│   ├── cards.py            # 卡片 API + 移动
│   └── comments.py         # 评论 API
├── socket_handlers.py      # WebSocket 事件处理
├── templates/
│   ├── base.html           # 基础布局
│   ├── index.html          # 项目列表
│   └── board.html          # 看板页（含拖拽）
├── static/
│   ├── css/style.css
│   └── js/board.js         # 拖拽排序 + WebSocket
├── requirements.txt
└── run.py                  # 入口
```

### 启动方式
```bash
pip install -r requirements.txt
python run.py
# 浏览器打开 http://localhost:7952
```

