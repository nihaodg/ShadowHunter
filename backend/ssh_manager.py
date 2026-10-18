"""SSH 会话管理：paramiko 交互式终端。

每个会话维护一个 SSH channel（invoke_shell），WebSocket 与 channel 之间双向转发。
会话配置（host/user/password）由前端传入，仅在内存中保留，不落盘。
已保存的连接配置存 ssh_connections.json（密码可读，仅本机，前端脱敏展示）。
"""
import threading
import time
import codecs
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import uuid

import paramiko

# 已保存连接配置文件（与 backend 同目录）
_SAVED_FILE = Path(__file__).resolve().parent / "ssh_connections.json"


@dataclass
class SSHSession:
    session_id: str
    host: str
    port: int
    username: str
    password: str
    client: Optional[paramiko.SSHClient] = None
    channel: Optional[paramiko.channel.Channel] = None
    connected: bool = False
    error: str = ""
    decoder: Optional["codecs.IncrementalDecoder"] = None  # 增量 UTF-8 解码器


# session_id -> SSHSession
_sessions: dict[str, SSHSession] = {}


# ============ 已保存连接 CRUD ============
def list_saved() -> list[dict]:
    """列出已保存连接（密码脱敏）。"""
    data = _load_saved()
    for item in data:
        item["password_masked"] = _mask(item.get("password", ""))
    return data


def save_connection(name: str, host: str, username: str, password: str, port: int = 22) -> dict:
    """保存连接（按 name 覆盖）。"""
    data = _load_saved()
    entry = {"name": name, "host": host, "port": port,
             "username": username, "password": password}
    # 按 name 去重覆盖
    data = [d for d in data if d.get("name") != name]
    data.append(entry)
    _write_saved(data)
    return entry


def delete_connection(name: str) -> bool:
    data = _load_saved()
    new_data = [d for d in data if d.get("name") != name]
    if len(new_data) == len(data):
        return False
    _write_saved(new_data)
    return True


def get_connection(name: str) -> Optional[dict]:
    for d in _load_saved():
        if d.get("name") == name:
            return d
    return None


def _load_saved() -> list[dict]:
    if not _SAVED_FILE.exists():
        return []
    try:
        return json.loads(_SAVED_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write_saved(data: list[dict]):
    _SAVED_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        import os
        os.chmod(_SAVED_FILE, 0o600)
    except Exception:
        pass


def _mask(password: str) -> str:
    if not password:
        return ""
    if len(password) <= 4:
        return "***"
    return password[:2] + "***" + password[-1:]


def create_session(host: str, username: str, password: str, port: int = 22) -> SSHSession:
    """建立 SSH 连接并打开交互式 shell。"""
    sid = uuid.uuid4().hex[:12]
    sess = SSHSession(session_id=sid, host=host, port=port,
                      username=username, password=password)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host, port=port, username=username, password=password,
            timeout=10, allow_agent=False, look_for_keys=False,
        )
        channel = client.invoke_shell(term="xterm-256color", width=160, height=40)
        # 设置 UTF-8 locale，避免中文命令输出乱码。
        # 注意：不能用 stty -echo（会关掉 PTY 回显，导致用户输入看不到）。
        try:
            channel.send('export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8\r')
            time.sleep(0.3)
            # 吃掉初始化命令的回显，让用户看到干净的 shell 提示符
            while channel.recv_ready():
                channel.recv(4096)
        except Exception:
            pass
        sess.client = client
        sess.channel = channel
        sess.connected = True
        sess.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    except Exception as e:
        sess.error = str(e)
        try:
            client.close()
        except Exception:
            pass
    _sessions[sid] = sess
    return sess


def get_session(sid: str) -> Optional[SSHSession]:
    return _sessions.get(sid)


def write(sid: str, data: str):
    sess = _sessions.get(sid)
    if sess and sess.channel and sess.connected:
        sess.channel.send(data)


def read_output(sid: str, size: int = 4096) -> str:
    """从 channel 读原始字节，用会话的增量解码器解码（解决跨 recv 拆字乱码）。"""
    sess = _sessions.get(sid)
    if not sess or not sess.channel:
        return ""
    data = sess.channel.recv(size)
    if not data:
        return ""
    if sess.decoder is None:
        sess.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    return sess.decoder.decode(data)


def resize(sid: str, cols: int, rows: int):
    sess = _sessions.get(sid)
    if sess and sess.channel and sess.connected:
        try:
            sess.channel.resize_pty(width=cols, height=rows)
        except Exception:
            pass


def close(sid: str):
    sess = _sessions.pop(sid, None)
    if not sess:
        return
    try:
        if sess.channel:
            sess.channel.close()
    except Exception:
        pass
    try:
        if sess.client:
            sess.client.close()
    except Exception:
        pass


def close_all():
    for sid in list(_sessions.keys()):
        close(sid)
