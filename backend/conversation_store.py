"""对话历史存储：SQLite 持久化。

两个表：
- sessions: id, title, mode, created_at, updated_at
- messages: id, session_id, role, content, created_at
"""
import sqlite3
import uuid
import time
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).resolve().parent / "conversations.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'qa',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)")


def _now() -> float:
    return time.time()


def _auto_title(content: str) -> str:
    """从首条用户消息生成标题。"""
    content = content.strip().replace("\n", " ")
    if len(content) > 24:
        return content[:24] + "…"
    return content or "新对话"


def create_session(mode: str = "qa", title: str = "", first_message: str = "") -> dict:
    """创建会话，返回 session 字典。"""
    sid = uuid.uuid4().hex[:16]
    if not title:
        title = _auto_title(first_message)
    now = _now()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, mode, created_at, updated_at) VALUES (?,?,?,?,?)",
            (sid, title, mode, now, now),
        )
    return {"id": sid, "title": title, "mode": mode,
            "created_at": now, "updated_at": now}


def list_sessions() -> list[dict]:
    """列出所有会话（按更新时间倒序），带消息数。"""
    with _conn() as conn:
        rows = conn.execute("""
            SELECT s.id, s.title, s.mode, s.created_at, s.updated_at,
                   COUNT(m.id) AS msg_count
            FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
            GROUP BY s.id
            ORDER BY s.updated_at DESC
        """).fetchall()
    return [dict(r) for r in rows]


def get_session(session_id: str) -> Optional[dict]:
    """获取会话 + 消息列表。"""
    with _conn() as conn:
        s = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not s:
            return None
        msgs = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        result = dict(s)
        result["messages"] = [{"role": m["role"], "content": m["content"]} for m in msgs]
        return result


def delete_session(session_id: str) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        return cur.rowcount > 0


def rename_session(session_id: str, title: str) -> bool:
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, _now(), session_id),
        )
        return cur.rowcount > 0


def append_messages(session_id: str, messages: list[dict]) -> bool:
    """追加消息。messages = [{role, content}]。自动更新会话时间与标题。"""
    if not messages:
        return False
    now = _now()
    with _conn() as conn:
        exists = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not exists:
            return False
        for m in messages:
            role = m.get("role")
            content = m.get("content", "")
            if role not in ("user", "assistant") or not content:
                continue
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)",
                (session_id, role, content, now),
            )
        # 若标题是默认的「新对话」，用第一条用户消息更新标题
        s = conn.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if s and (not s["title"] or s["title"] == "新对话"):
            first_user = next((m["content"] for m in messages if m.get("role") == "user"), "")
            if first_user:
                conn.execute(
                    "UPDATE sessions SET title = ? WHERE id = ?",
                    (_auto_title(first_user), session_id),
                )
        conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
    return True


# 初始化
init_db()
