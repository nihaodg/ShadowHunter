"""应急响应 AI 助手 —— FastAPI 入口。"""
import asyncio
import json
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import prompts, settings, ssh_manager, file_parser
from .claude_client import client as claude
from .knowledge_base_loader import kb

import os
import tempfile
from pathlib import Path

app = FastAPI(title="ShadowHunter 猎影 · 应急响应 AI 助手")

# 允许本地前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


# ============ 请求模型 ============
class ChatRequest(BaseModel):
    mode: str = "qa"            # triage | report | qa
    message: str
    history: list[dict] = []    # [{"role": "user"/"assistant", "content": "..."}]
    stream: bool = True


class ReportRequest(BaseModel):
    content: str                # 排查结果/证据
    stream: bool = True


class SettingsUpdateRequest(BaseModel):
    active_provider: Optional[str] = None
    providers: Optional[dict] = None   # {"openai": {"api_key": "...", "base_url": "...", "model": "..."}}


class SSHCred(BaseModel):
    host: str
    port: int = 22
    username: str
    password: str


class SSHConnectionSave(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str
    password: str


class DistillRequest(BaseModel):
    content: str                 # 待沉淀的对话内容/结论
    name: str = ""               # 可选：条目名
    history: list[dict] = []     # 对话上下文（可选）


class KnowledgeSaveRequest(BaseModel):
    name: str
    content: str
    is_user: bool = True         # 默认存用户知识库


# ============ 工具函数 ============
def _build_system(mode: str) -> str:
    if mode == "triage":
        return prompts.TRIAGE_SYSTEM
    if mode == "report":
        return prompts.REPORT_SYSTEM
    return prompts.QA_SYSTEM


def _build_messages(mode: str, message: str, history: list[dict]) -> list[dict]:
    msgs = []
    # 历史
    for h in history:
        role = h.get("role")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})

    # 知识库上下文（分诊和问答时注入；报告模式也注入格式参考）
    ctx = kb.build_context(message, top_k=6)

    if mode == "report":
        user_content = f"以下是排查结果/证据，请据此生成应急响应报告：\n\n{message}"
    else:
        user_content = message
        if ctx:
            user_content = f"{ctx}\n\n===== 用户问题 =====\n{message}"

    msgs.append({"role": "user", "content": user_content})
    return msgs


# ============ 路由 ============
@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok",
            "active_provider": claude.active_provider,
            "model": claude.active_model,
            "has_api_key": claude.has_key,
            "knowledge_docs": len(kb.list_docs()),
            "user_kb_docs": len(kb.list_user_docs())}


@app.get("/api/settings")
async def get_settings():
    """返回脱敏后的 provider 配置。"""
    cfg = settings.load_config()
    return settings.public_config(cfg)


@app.post("/api/settings")
async def update_settings(req: SettingsUpdateRequest):
    """更新 provider 配置（key/base_url/model + 切换 active）。"""
    try:
        settings.update_config(
            active_provider=req.active_provider,
            updates=req.providers,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "config": settings.public_config(settings.load_config())}


# ============ 知识库 ============
@app.get("/api/knowledge")
async def list_knowledge():
    """列出内置 + 用户知识库文档。"""
    return {
        "docs": kb.list_docs(),
        "user_docs": kb.list_user_docs(),
    }


@app.get("/api/knowledge/{name:path}")
async def get_knowledge(name: str):
    """获取单个知识条目内容（优先用户库，其次内置库）。"""
    content = kb.get_user_doc(name) or kb.get_doc(name)
    if not content:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    return {"name": name, "content": content}


@app.post("/api/knowledge")
async def create_knowledge(req: KnowledgeSaveRequest):
    """新建/保存知识条目。"""
    fname = kb.create_user_doc(req.name, req.content)
    return {"ok": True, "name": fname}


@app.delete("/api/knowledge/{name:path}")
async def delete_knowledge(name: str):
    """删除用户知识条目（仅限 user_kb，内置条目不可删）。"""
    if kb.delete_user_doc(name):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="条目不存在或为内置条目（不可删）")


# ============ 对话 ============
@app.post("/api/chat")
async def chat(req: ChatRequest):
    """通用聊天接口（流式）。"""
    if not claude.has_key:
        raise HTTPException(status_code=400, detail="未配置 API Key，请在「设置」面板填写")
    system = _build_system(req.mode)
    messages = _build_messages(req.mode, req.message, req.history)

    async def gen():
        try:
            async for text in claude.stream_chat(system=system, messages=messages):
                yield text
        except Exception as e:
            yield f"\n\n[错误] {str(e)}"

    if req.stream:
        return StreamingResponse(gen(), media_type="text/plain")
    # 非流式
    try:
        full = ""
        async for text in claude.stream_chat(system=system, messages=messages):
            full += text
        return {"reply": full}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/triage")
async def triage(req: ChatRequest):
    """智能分诊（便捷端点）。"""
    req.mode = "triage"
    return await chat(req)


@app.post("/api/report")
async def report(req: ChatRequest):
    """报告生成（便捷端点）。"""
    req.mode = "report"
    return await chat(req)


# ============ 文件上传分析 ============
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传 docx/md/txt，解析文本返回（前端拿到文本后再走 /api/chat 分析）。"""
    try:
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in (".docx", ".md", ".txt", ".log", ".text", ".markdown", ".doc"):
            raise HTTPException(status_code=400,
                                detail=f"不支持的文件格式 {suffix}，请上传 docx/md/txt")
        # 存临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        try:
            result = file_parser.parse_file(tmp_path)
        finally:
            os.unlink(tmp_path)
        return {"ok": True, **result}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ AI 沉淀知识 ============
@app.post("/api/distill")
async def distill(req: DistillRequest):
    """把对话内容/结论用 AI 总结成结构化知识条目（流式）。"""
    if not claude.has_key:
        raise HTTPException(status_code=400, detail="未配置 API Key")
    system = prompts.DISTILL_SYSTEM
    msgs = []
    for h in req.history:
        role = h.get("role")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    user_content = f"请把以下内容沉淀成一条知识库条目：\n\n{req.content}"
    if req.name:
        user_content = f"请把以下内容沉淀成知识库条目（条目名建议：{req.name}）：\n\n{req.content}"
    msgs.append({"role": "user", "content": user_content})

    async def gen():
        try:
            async for text in claude.stream_chat(system=system, messages=msgs):
                yield text
        except Exception as e:
            yield f"\n\n[错误] {str(e)}"

    return StreamingResponse(gen(), media_type="text/plain")


# ============ 已保存 SSH 连接 ============
@app.get("/api/ssh/connections")
async def list_ssh_connections():
    """列出已保存的 SSH 连接（密码脱敏）。"""
    return {"connections": ssh_manager.list_saved()}


@app.post("/api/ssh/connections")
async def save_ssh_connection(req: SSHConnectionSave):
    """保存 SSH 连接（按 name 覆盖）。"""
    ssh_manager.save_connection(
        name=req.name, host=req.host, username=req.username,
        password=req.password, port=req.port,
    )
    return {"ok": True, "connections": ssh_manager.list_saved()}


@app.delete("/api/ssh/connections/{name}")
async def delete_ssh_connection(name: str):
    """删除已保存的连接。"""
    if ssh_manager.delete_connection(name):
        return {"ok": True, "connections": ssh_manager.list_saved()}
    raise HTTPException(status_code=404, detail="连接不存在")


# ============ SSH WebSocket ============
@app.websocket("/ws/ssh")
async def ssh_ws(ws: WebSocket):
    await ws.accept()
    session_id = None
    reader_task = None

    async def read_loop():
        """从 SSH channel 读输出推给前端。"""
        sess = ssh_manager.get_session(session_id)
        if not sess or not sess.channel:
            return
        while True:
            try:
                if sess.channel.recv_ready():
                    data = ssh_manager.read_output(session_id)
                    if not data:
                        break
                    await ws.send_text(json.dumps({"type": "output", "data": data}))
                else:
                    await asyncio.sleep(0.02)
            except Exception:
                break
        await ws.send_text(json.dumps({"type": "closed"}))

    try:
        while True:
            msg = await ws.receive_text()
            data = json.loads(msg)
            t = data.get("type")

            if t == "connect":
                cred = data.get("data", {})
                sess = ssh_manager.create_session(
                    host=cred.get("host", ""),
                    port=cred.get("port", 22),
                    username=cred.get("username", ""),
                    password=cred.get("password", ""),
                )
                session_id = sess.session_id
                if sess.connected:
                    await ws.send_text(json.dumps({"type": "connected", "session_id": session_id}))
                    reader_task = asyncio.create_task(read_loop())
                else:
                    await ws.send_text(json.dumps({"type": "error", "message": sess.error}))

            elif t == "input" and session_id:
                ssh_manager.write(session_id, data.get("data", ""))

            elif t == "resize" and session_id:
                ssh_manager.resize(session_id, data.get("cols", 160), data.get("rows", 40))

            elif t == "close" and session_id:
                ssh_manager.close(session_id)
                session_id = None
                break

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if reader_task:
            reader_task.cancel()
        if session_id:
            ssh_manager.close(session_id)


# ============ 挂载静态前端 ============
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
