/**
 * board.js — 看板拖拽排序 + WebSocket 协作
 * 
 * 改进：
 * 1. 乐观 UI 模式：先本地更新 DOM，API 失败再回滚
 * 2. 局部 DOM 更新：移除 loadBoard() 全量刷新
 * 3. 版本号乐观锁：处理并发冲突
 * 4. 更精确的拖拽排序，支持在列内任意位置插入
 */
(function () {
    const projectId = window.location.pathname.split("/").pop();
    let currentBoardId = null;
    let socket = null;
    let currentCardId = null;
    let draggedCard = null;
    let currentBoardData = null;
    let loadBoardAbortController = null;
    let pendingOperations = new Map();

    const filters = {
        search: "",
        priority: "",
        assignee: ""
    };

    // ── 状态管理 ────────────────────────────
    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function saveCardState(cardId) {
        if (!currentBoardData) return null;
        
        for (const colId of Object.keys(currentBoardData)) {
            const cards = currentBoardData[colId].cards;
            const idx = cards.findIndex(c => c.id === cardId);
            if (idx !== -1) {
                return {
                    columnId: parseInt(colId),
                    position: idx,
                    card: deepClone(cards[idx])
                };
            }
        }
        return null;
    }

    function updateLocalCardState(card) {
        if (!currentBoardData) return;
        
        for (const colId of Object.keys(currentBoardData)) {
            const cards = currentBoardData[colId].cards;
            const idx = cards.findIndex(c => c.id === card.id);
            if (idx !== -1) {
                if (cards[idx].column_id === card.column_id) {
                    cards[idx] = deepClone(card);
                } else {
                    cards.splice(idx, 1);
                    const targetCards = currentBoardData[card.column_id]?.cards;
                    if (targetCards) {
                        targetCards.splice(card.position, 0, deepClone(card));
                    }
                }
                return;
            }
        }
        
        const targetCards = currentBoardData[card.column_id]?.cards;
        if (targetCards) {
            targetCards.splice(card.position, 0, deepClone(card));
        }
    }

    function removeCardFromLocalState(cardId) {
        if (!currentBoardData) return null;
        
        for (const colId of Object.keys(currentBoardData)) {
            const cards = currentBoardData[colId].cards;
            const idx = cards.findIndex(c => c.id === cardId);
            if (idx !== -1) {
                return cards.splice(idx, 1)[0];
            }
        }
        return null;
    }

    function moveCardInLocalState(cardId, targetColumnId, targetPosition) {
        const card = removeCardFromLocalState(cardId);
        if (!card) return null;
        
        card.column_id = targetColumnId;
        card.position = targetPosition;
        
        const targetCards = currentBoardData[targetColumnId]?.cards;
        if (targetCards) {
            targetCards.splice(targetPosition, 0, card);
        }
        
        return card;
    }

    // ── DOM 操作 ────────────────────────────
    function getCardElement(cardId) {
        return document.querySelector(`.card[data-card-id="${cardId}"]`);
    }

    function getColumnCardsContainer(columnId) {
        return document.querySelector(`.column-cards[data-column-id="${columnId}"]`);
    }

    function removeCardElement(cardId) {
        const el = getCardElement(cardId);
        if (el) {
            el.remove();
        }
    }

    function insertCardElement(card, targetColumnId, targetPosition) {
        const container = getColumnCardsContainer(targetColumnId);
        if (!container) return;
        
        removeCardElement(card.id);
        
        const newEl = createCardElement(card);
        const cards = container.querySelectorAll(".card");
        
        if (targetPosition >= cards.length) {
            container.appendChild(newEl);
        } else {
            container.insertBefore(newEl, cards[targetPosition]);
        }
        
        updateColumnCount(targetColumnId);
        const originalColumn = currentBoardData ? 
            Object.keys(currentBoardData).find(colId => 
                currentBoardData[colId].cards.some(c => c.id === card.id)
            ) : null;
        if (originalColumn) {
            updateColumnCount(parseInt(originalColumn));
        }
    }

    function updateColumnCount(columnId) {
        const column = document.querySelector(`.column[data-column-id="${columnId}"]`);
        if (!column || !currentBoardData) return;
        
        const countEl = column.querySelector(".count");
        const cards = currentBoardData[columnId]?.cards || [];
        if (countEl) {
            countEl.textContent = cards.length;
        }
    }

    function updateCardElement(card) {
        const oldEl = getCardElement(card.id);
        if (!oldEl) return;
        
        const columnId = card.column_id;
        const cards = currentBoardData[columnId]?.cards || [];
        const position = cards.findIndex(c => c.id === card.id);
        
        const newEl = createCardElement(card);
        oldEl.replaceWith(newEl);
    }

    function renderAllColumns() {
        if (!currentBoardData) return;
        
        const columnsArea = document.getElementById("columnsArea");
        columnsArea.innerHTML = "";

        for (const colId of Object.keys(currentBoardData)) {
            const colData = currentBoardData[colId];
            const col = colData.column;
            const cards = colData.cards.filter(card => {
                const matchesSearch = !filters.search || card.title.toLowerCase().includes(filters.search);
                const matchesPriority = !filters.priority || card.priority === filters.priority;
                const matchesAssignee = !filters.assignee || card.assignee.toLowerCase().includes(filters.assignee);
                return matchesSearch && matchesPriority && matchesAssignee;
            });

            const colEl = createColumnElement(col, cards);
            columnsArea.appendChild(colEl);
        }
    }

    function applyFilters() {
        renderAllColumns();
    }

    // ── 初始化 ──────────────────────────────
    async function init() {
        const boards = await fetchJSON(`/api/projects/${projectId}/boards`);
        if (boards.length > 0) {
            currentBoardId = boards[0].id;
        }
        renderBoardTabs(boards);
        if (currentBoardId) {
            await loadBoard(currentBoardId);
            connectSocket(currentBoardId);
        }
        setupFilters();
    }

    function setupFilters() {
        const searchInput = document.getElementById("searchInput");
        const priorityFilter = document.getElementById("priorityFilter");
        const assigneeFilter = document.getElementById("assigneeFilter");
        const clearFiltersBtn = document.getElementById("clearFiltersBtn");

        let searchTimeout;
        searchInput.addEventListener("input", () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filters.search = searchInput.value.toLowerCase();
                applyFilters();
            }, 300);
        });

        priorityFilter.addEventListener("change", () => {
            filters.priority = priorityFilter.value;
            applyFilters();
        });

        assigneeFilter.addEventListener("input", () => {
            filters.assignee = assigneeFilter.value.toLowerCase();
            applyFilters();
        });

        clearFiltersBtn.addEventListener("click", () => {
            filters.search = "";
            filters.priority = "";
            filters.assignee = "";
            searchInput.value = "";
            priorityFilter.value = "";
            assigneeFilter.value = "";
            applyFilters();
        });
    }

    function renderBoardTabs(boards) {
        const container = document.querySelector(".board-tabs");
        container.innerHTML = "";
        boards.forEach(b => {
            const btn = document.createElement("button");
            btn.className = "tab-btn" + (b.id === currentBoardId ? " active" : "");
            btn.textContent = b.name;
            btn.onclick = () => switchBoard(b.id);
            
            const btnContainer = document.createElement("div");
            btnContainer.className = "tab-btn-container";
            btnContainer.style.display = "flex";
            btnContainer.style.alignItems = "center";
            btnContainer.style.gap = "4px";
            
            const editBtn = document.createElement("button");
            editBtn.className = "btn-icon";
            editBtn.textContent = "✏️";
            editBtn.title = "重命名看板";
            editBtn.onclick = (e) => {
                e.stopPropagation();
                const newName = prompt("看板新名称：", b.name);
                if (newName && newName.trim()) {
                    updateBoard(b.id, newName.trim());
                }
            };
            
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "btn-icon";
            deleteBtn.textContent = "🗑️";
            deleteBtn.title = "删除看板";
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm("确定要删除此看板吗？所有列和卡片都将被删除。")) {
                    deleteBoard(b.id);
                }
            };
            
            btnContainer.appendChild(btn);
            btnContainer.appendChild(editBtn);
            btnContainer.appendChild(deleteBtn);
            container.appendChild(btnContainer);
        });
        const addBtn = document.createElement("button");
        addBtn.className = "tab-btn add-board-btn";
        addBtn.textContent = "+";
        addBtn.onclick = createBoard;
        container.appendChild(addBtn);
    }

    async function updateBoard(boardId, name) {
        await fetchJSON(`/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
        const boards = await fetchJSON(`/api/projects/${projectId}/boards`);
        renderBoardTabs(boards);
    }

    async function deleteBoard(boardId) {
        try {
            const result = await fetchJSON(`/api/boards/${boardId}`, {
                method: "DELETE"
            });
            
            if (socket && result.project_id) {
                socket.emit("board_deleted", {
                    project_id: result.project_id,
                    board_id: result.board_id,
                    board_name: result.board_name
                });
            }
            
            const boards = await fetchJSON(`/api/projects/${projectId}/boards`);
            if (boards.length > 0) {
                if (boardId === currentBoardId) {
                    const oldBoardId = currentBoardId;
                    
                    if (socket && oldBoardId) {
                        socket.emit("leave_board", { board_id: oldBoardId });
                    }
                    
                    currentBoardId = boards[0].id;
                    await loadBoard(currentBoardId);
                    
                    if (socket) {
                        socket.emit("join_board", { board_id: currentBoardId });
                    }
                }
            } else {
                const oldBoardId = currentBoardId;
                
                if (socket && oldBoardId) {
                    socket.emit("leave_board", { board_id: oldBoardId });
                }
                
                currentBoardId = null;
                currentBoardData = null;
                document.getElementById("columnsArea").innerHTML = "";
            }
            renderBoardTabs(boards);
            
        } catch (e) {
            console.error("Delete board failed:", e);
            alert("删除看板失败，请重试");
        }
    }

    async function switchBoard(boardId) {
        if (boardId === currentBoardId) return;
        
        const oldBoardId = currentBoardId;
        
        if (socket && oldBoardId) {
            socket.emit("leave_board", { board_id: oldBoardId });
        }
        
        currentBoardId = boardId;
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        
        await loadBoard(boardId);
        
        if (socket) {
            socket.emit("join_board", { board_id: currentBoardId });
        }
    }

    // ── 加载看板 ────────────────────────────
    async function loadBoard(boardId) {
        if (loadBoardAbortController) {
            loadBoardAbortController.abort();
        }
        
        loadBoardAbortController = new AbortController();
        
        try {
            const data = await fetchJSON(`/api/boards/${boardId}/cards`, {
                signal: loadBoardAbortController.signal
            });
            currentBoardData = data;
            renderAllColumns();
        } catch (e) {
            if (e.name !== "AbortError") {
                console.error("Failed to load board:", e);
            }
        }
    }

    function createColumnElement(col, cards) {
        const colEl = document.createElement("div");
        colEl.className = "column";
        colEl.dataset.columnId = col.id;

        colEl.innerHTML = `
            <div class="column-header">
                <h3 contenteditable="true" class="column-title">${col.name}</h3>
                <div class="column-actions">
                    <span class="count">${cards.length}</span>
                    <button class="btn-icon add-card-btn" title="添加卡片">+</button>
                    <button class="btn-icon delete-column-btn" title="删除列">🗑️</button>
                </div>
            </div>
            <div class="column-cards" data-column-id="${col.id}"></div>
        `;

        const titleEl = colEl.querySelector(".column-title");
        titleEl.addEventListener("blur", async () => {
            const newName = titleEl.textContent.trim();
            if (newName && newName !== col.name) {
                await fetchJSON(`/api/columns/${col.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: newName })
                });
                if (socket) {
                    socket.emit("column_updated", {
                        board_id: currentBoardId,
                        column: { id: col.id, name: newName }
                    });
                }
            }
        });
        titleEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                titleEl.blur();
            }
        });

        const addCardBtn = colEl.querySelector(".add-card-btn");
        addCardBtn.onclick = () => openNewCardModal(col.id);

        const deleteColumnBtn = colEl.querySelector(".delete-column-btn");
        deleteColumnBtn.onclick = async () => {
            if (!confirm("确定要删除此列吗？所有卡片都将被删除。")) return;
            
            try {
                const result = await fetchJSON(`/api/columns/${col.id}`, {
                    method: "DELETE"
                });
                
                if (currentBoardData && currentBoardData[col.id]) {
                    delete currentBoardData[col.id];
                }
                
                const columnEl = document.querySelector(`.column[data-column-id="${col.id}"]`);
                if (columnEl) {
                    columnEl.remove();
                }
                
                if (socket && result.board_id) {
                    socket.emit("column_deleted", {
                        board_id: result.board_id,
                        column_id: result.column_id,
                        column_name: result.column_name
                    });
                }
                
            } catch (e) {
                console.error("Delete column failed:", e);
                alert("删除列失败，请重试");
            }
        };

        const cardsContainer = colEl.querySelector(".column-cards");

        cards.forEach(card => {
            cardsContainer.appendChild(createCardElement(card));
        });

        cardsContainer.addEventListener("dragover", e => {
            e.preventDefault();
            cardsContainer.classList.add("drag-over");
        });
        cardsContainer.addEventListener("dragleave", () => {
            cardsContainer.classList.remove("drag-over");
        });
        cardsContainer.addEventListener("drop", async e => {
            e.preventDefault();
            cardsContainer.classList.remove("drag-over");
            if (!draggedCard) return;
            
            const cardId = parseInt(draggedCard.dataset.cardId);
            const targetColId = parseInt(cardsContainer.dataset.columnId);
            
            const rect = cardsContainer.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const cardElements = cardsContainer.querySelectorAll(".card:not(.dragging)");
            let position = cardElements.length;
            
            for (let i = 0; i < cardElements.length; i++) {
                const cardRect = cardElements[i].getBoundingClientRect();
                const cardMiddle = cardRect.top + cardRect.height / 2 - rect.top;
                if (y < cardMiddle) {
                    position = i;
                    break;
                }
            }
            
            await moveCardOptimistic(cardId, targetColId, position);
        });

        return colEl;
    }

    function openNewCardModal(columnId) {
        document.getElementById("cardTitle").value = "";
        document.getElementById("cardDescription").value = "";
        document.getElementById("cardPriority").value = "medium";
        document.getElementById("cardAssignee").value = "";
        document.getElementById("cardDueDate").value = "";
        document.getElementById("cardColor").value = "#3498db";
        document.getElementById("commentsSection").style.display = "none";
        document.getElementById("deleteCardBtn").style.display = "none";
        
        currentCardId = null;
        document.getElementById("cardModal").dataset.columnId = columnId;
        document.getElementById("cardModal").classList.remove("hidden");
    }

    function createCardElement(card) {
        const el = document.createElement("div");
        el.className = "card";
        el.draggable = true;
        el.dataset.cardId = card.id;

        const colorBar = card.color ? `<div class="card-color-bar" style="background:${card.color}"></div>` : "";
        const priorityBadge = `<span class="badge badge-${card.priority}">${card.priority}</span>`;
        const assigneeBadge = card.assignee ? `<span class="badge">${card.assignee}</span>` : "";
        const dueDateBadge = card.due_date ? `<span class="badge">📅 ${card.due_date}</span>` : "";

        el.innerHTML = `
            ${colorBar}
            <h4>${card.title}</h4>
            <div class="card-meta">${priorityBadge}${assigneeBadge}${dueDateBadge}</div>
        `;

        el.addEventListener("dragstart", () => {
            draggedCard = el;
            el.classList.add("dragging");
        });
        el.addEventListener("dragend", () => {
            el.classList.remove("dragging");
            draggedCard = null;
        });
        el.addEventListener("click", () => openCardModal(card.id));

        return el;
    }

    // ── 乐观 UI 移动卡片 ─────────────────────
    async function moveCardOptimistic(cardId, targetColumnId, targetPosition) {
        const savedState = saveCardState(cardId);
        if (!savedState) return;
        
        if (savedState.columnId === targetColumnId && savedState.position === targetPosition) {
            return;
        }
        
        const card = moveCardInLocalState(cardId, targetColumnId, targetPosition);
        if (!card) return;
        
        insertCardElement(card, targetColumnId, targetPosition);
        
        const operationId = `move_${cardId}_${Date.now()}`;
        pendingOperations.set(operationId, {
            type: "move",
            cardId,
            savedState,
            targetColumnId,
            targetPosition
        });
        
        try {
            const result = await fetchJSON(`/api/cards/${cardId}/move`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    column_id: targetColumnId, 
                    position: targetPosition,
                    version: card.version
                }),
            });
            
            updateLocalCardState(result);
            updateCardElement(result);
            
            if (socket) {
                socket.emit("card_moved", {
                    board_id: currentBoardId,
                    card_id: cardId,
                    from_column: savedState.columnId,
                    to_column: targetColumnId,
                    position: targetPosition,
                    card: result
                });
            }
            
        } catch (e) {
            console.error("Move card failed:", e);
            
            if (e.message.includes("409")) {
                alert("卡片已被其他用户修改，正在刷新...");
                await loadBoard(currentBoardId);
            } else {
                if (savedState) {
                    removeCardFromLocalState(cardId);
                    const targetCards = currentBoardData[savedState.columnId]?.cards;
                    if (targetCards) {
                        targetCards.splice(savedState.position, 0, savedState.card);
                    }
                    insertCardElement(savedState.card, savedState.columnId, savedState.position);
                }
                alert("移动卡片失败，请重试");
            }
        } finally {
            pendingOperations.delete(operationId);
        }
    }

    // ── 卡片弹窗 ────────────────────────────
    async function openCardModal(cardId) {
        currentCardId = cardId;
        const card = await fetchJSON(`/api/cards/${cardId}`);
        document.getElementById("cardTitle").value = card.title;
        document.getElementById("cardDescription").value = card.description;
        document.getElementById("cardPriority").value = card.priority;
        document.getElementById("cardAssignee").value = card.assignee;
        document.getElementById("cardDueDate").value = card.due_date;
        document.getElementById("cardColor").value = card.color || "#3498db";
        document.getElementById("cardModal").dataset.version = card.version;
        document.getElementById("commentsSection").style.display = "block";
        document.getElementById("deleteCardBtn").style.display = "inline-block";
        await loadComments(cardId);
        document.getElementById("cardModal").classList.remove("hidden");
    }

    function closeCardModal() {
        document.getElementById("cardModal").classList.add("hidden");
        currentCardId = null;
    }
    window.closeCardModal = closeCardModal;

    async function loadComments(cardId) {
        const data = await fetchJSON(`/api/cards/${cardId}/comments`);
        const list = document.getElementById("commentsList");
        list.innerHTML = data.items.map(c => `
            <div class="comment-item">
                <span class="author">${c.author}</span>
                <span class="time">${new Date(c.created_at).toLocaleString()}</span>
                <div class="text">${c.content}</div>
            </div>
        `).join("");
    }

    document.getElementById("saveCardBtn").onclick = async () => {
        const cardData = {
            title: document.getElementById("cardTitle").value,
            description: document.getElementById("cardDescription").value,
            priority: document.getElementById("cardPriority").value,
            assignee: document.getElementById("cardAssignee").value,
            due_date: document.getElementById("cardDueDate").value,
            color: document.getElementById("cardColor").value,
        };

        if (currentCardId) {
            const version = parseInt(document.getElementById("cardModal").dataset.version || "0");
            
            let savedCard = null;
            for (const colId of Object.keys(currentBoardData)) {
                const cards = currentBoardData[colId].cards;
                const idx = cards.findIndex(c => c.id === currentCardId);
                if (idx !== -1) {
                    savedCard = deepClone(cards[idx]);
                    break;
                }
            }
            
            try {
                const result = await fetchJSON(`/api/cards/${currentCardId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...cardData, version }),
                });
                
                updateLocalCardState(result);
                updateCardElement(result);
                
                if (socket) {
                    socket.emit("card_updated", {
                        board_id: currentBoardId,
                        card: result
                    });
                }
                
            } catch (e) {
                console.error("Update card failed:", e);
                if (e.message.includes("409")) {
                    alert("卡片已被其他用户修改，正在刷新...");
                    await loadBoard(currentBoardId);
                } else {
                    alert("更新卡片失败，请重试");
                }
            }
        } else {
            const columnId = parseInt(document.getElementById("cardModal").dataset.columnId);
            
            try {
                const result = await fetchJSON(`/api/columns/${columnId}/cards`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(cardData),
                });
                
                updateLocalCardState(result);
                const cards = currentBoardData[columnId]?.cards || [];
                const position = cards.findIndex(c => c.id === result.id);
                if (position !== -1) {
                    insertCardElement(result, columnId, position);
                }
                
                if (socket) {
                    socket.emit("card_created", {
                        board_id: currentBoardId,
                        card: result
                    });
                }
                
            } catch (e) {
                console.error("Create card failed:", e);
                alert("创建卡片失败，请重试");
            }
        }
        
        closeCardModal();
    };

    document.getElementById("deleteCardBtn").onclick = async () => {
        if (!currentCardId || !confirm("确认删除此卡片？")) return;
        
        const savedState = saveCardState(currentCardId);
        
        try {
            await fetchJSON(`/api/cards/${currentCardId}`, { method: "DELETE" });
            
            removeCardFromLocalState(currentCardId);
            removeCardElement(currentCardId);
            if (savedState) {
                updateColumnCount(savedState.columnId);
            }
            
            if (socket) {
                socket.emit("card_deleted", {
                    board_id: currentBoardId,
                    card_id: currentCardId
                });
            }
            
        } catch (e) {
            console.error("Delete card failed:", e);
            if (savedState) {
                const targetCards = currentBoardData[savedState.columnId]?.cards;
                if (targetCards) {
                    targetCards.splice(savedState.position, 0, savedState.card);
                }
                insertCardElement(savedState.card, savedState.columnId, savedState.position);
            }
            alert("删除卡片失败，请重试");
        }
        
        closeCardModal();
    };

    document.getElementById("addCommentBtn").onclick = async () => {
        if (!currentCardId) return;
        const author = document.getElementById("commentAuthor").value.trim() || "匿名";
        const content = document.getElementById("commentContent").value.trim();
        if (!content) return;
        try {
            await fetchJSON(`/api/cards/${currentCardId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ author, content }),
            });
            document.getElementById("commentContent").value = "";
            await loadComments(currentCardId);
        } catch (e) {
            console.error("Add comment failed:", e);
            alert("添加评论失败，请重试");
        }
    };

    // ── 新建列 ──────────────────────────────
    document.getElementById("addColumnBtn").onclick = async () => {
        const name = prompt("列名称：");
        if (!name || !currentBoardId) return;
        try {
            const result = await fetchJSON(`/api/boards/${currentBoardId}/columns`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            
            currentBoardData[result.id] = {
                column: result,
                cards: []
            };
            
            const columnsArea = document.getElementById("columnsArea");
            const colEl = createColumnElement(result, []);
            columnsArea.appendChild(colEl);
            
            if (socket) {
                socket.emit("column_created", {
                    board_id: currentBoardId,
                    column: result
                });
            }
            
        } catch (e) {
            console.error("Create column failed:", e);
            alert("创建列失败，请重试");
        }
    };

    // ── 新建看板 ────────────────────────────
    async function createBoard() {
        const name = prompt("看板名称：");
        if (!name) return;
        try {
            await fetchJSON(`/api/projects/${projectId}/boards`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const boards = await fetchJSON(`/api/projects/${projectId}/boards`);
            renderBoardTabs(boards);
            if (boards.length > 0) {
                currentBoardId = boards[boards.length - 1].id;
                await loadBoard(currentBoardId);
                if (socket) {
                    socket.emit("join_board", { board_id: currentBoardId });
                }
            }
        } catch (e) {
            console.error("Create board failed:", e);
            alert("创建看板失败，请重试");
        }
    }

    // ── WebSocket ───────────────────────────
    function connectSocket(boardId) {
        socket = io();
        socket.on("connect", () => {
            socket.emit("join_board", { board_id: boardId });
            socket.emit("join_project", { project_id: projectId });
        });
        
        socket.on("card_moved", async (data) => {
            if (data.board_id !== currentBoardId) return;
            
            const cardId = data.card_id;
            const isPending = Array.from(pendingOperations.values()).some(
                op => op.type === "move" && op.cardId === cardId
            );
            
            if (!isPending && data.card) {
                const savedState = saveCardState(cardId);
                if (savedState) {
                    if (savedState.columnId !== data.card.column_id || 
                        savedState.card.position !== data.card.position) {
                        updateLocalCardState(data.card);
                        removeCardElement(cardId);
                        insertCardElement(data.card, data.card.column_id, data.card.position);
                    }
                } else {
                    updateLocalCardState(data.card);
                    insertCardElement(data.card, data.card.column_id, data.card.position);
                }
            }
        });
        
        socket.on("card_created", async (data) => {
            if (data.board_id !== currentBoardId || !data.card) return;
            
            const cardId = data.card.id;
            const exists = currentBoardData ? 
                Object.values(currentBoardData).some(
                    colData => colData.cards.some(c => c.id === cardId)
                ) : false;
            
            if (!exists) {
                updateLocalCardState(data.card);
                insertCardElement(data.card, data.card.column_id, data.card.position);
            }
        });
        
        socket.on("card_deleted", async (data) => {
            if (data.board_id !== currentBoardId) return;
            
            const cardId = data.card_id;
            removeCardFromLocalState(cardId);
            removeCardElement(cardId);
        });
        
        socket.on("card_updated", async (data) => {
            if (data.board_id !== currentBoardId || !data.card) return;
            
            updateLocalCardState(data.card);
            updateCardElement(data.card);
        });
        
        socket.on("column_created", async (data) => {
            if (data.board_id !== currentBoardId || !data.column) return;
            
            const colId = data.column.id;
            if (currentBoardData && !currentBoardData[colId]) {
                currentBoardData[colId] = {
                    column: data.column,
                    cards: []
                };
                
                const columnsArea = document.getElementById("columnsArea");
                const colEl = createColumnElement(data.column, []);
                columnsArea.appendChild(colEl);
            }
        });
        
        socket.on("column_updated", async (data) => {
            if (data.board_id !== currentBoardId || !data.column) return;
            
            const colId = data.column.id;
            if (currentBoardData && currentBoardData[colId]) {
                currentBoardData[colId].column = data.column;
                
                const column = document.querySelector(`.column[data-column-id="${colId}"]`);
                if (column) {
                    const titleEl = column.querySelector(".column-title");
                    if (titleEl) {
                        titleEl.textContent = data.column.name;
                    }
                }
            }
        });
        
        socket.on("column_deleted", async (data) => {
            if (data.board_id !== currentBoardId) return;
            
            const columnId = data.column_id;
            
            if (currentBoardData && currentBoardData[columnId]) {
                delete currentBoardData[columnId];
            }
            
            const columnEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
            if (columnEl) {
                columnEl.remove();
            }
        });
        
        socket.on("board_deleted", async (data) => {
            const boards = await fetchJSON(`/api/projects/${projectId}/boards`);
            renderBoardTabs(boards);
            
            const deletedBoardId = data.board_id;
            if (boards.length > 0) {
                if (deletedBoardId === currentBoardId) {
                    currentBoardId = boards[0].id;
                    await loadBoard(currentBoardId);
                }
            } else {
                currentBoardId = null;
                currentBoardData = null;
                document.getElementById("columnsArea").innerHTML = "";
            }
        });
    }

    // ── 工具函数 ────────────────────────────
    async function fetchJSON(url, opts = {}) {
        const resp = await fetch(url, opts);
        if (!resp.ok) {
            const error = new Error(`HTTP ${resp.status}`);
            error.status = resp.status;
            throw error;
        }
        return resp.json();
    }

    init();
})();
