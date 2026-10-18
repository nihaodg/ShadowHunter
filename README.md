# 🐺 ShadowHunter（猎影）

> 面向应急响应场景的本地 AI 助手 —— 集**智能分诊、排查辅助、报告生成、知识库沉淀**与**交互式 SSH 终端**于一体，让 AI 成为你的应急响应副驾驶。

基于 **80+ 份真实安全厂商应急响应处置报告** 蒸馏出的方法论，结合大模型（Claude / OpenAI / Gemini / 任意 OpenAI 兼容网关）驱动。

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🎯 **智能分诊** | 输入告警/异常现象，自动判断事件类型（挖矿/勒索/webshell/钓鱼/暗链…），给出三线排查步骤 |
| 💬 **知识库问答** | 聊天式提问应急响应问题，检索知识库 + 大模型回答 |
| 📄 **报告自动生成** | 粘贴排查结果，一键生成六段结构标准应急响应报告 |
| 📚 **知识库管理** | 内置 19 条蒸馏知识 + 支持自定义增删改 |
| 🧠 **AI 沉淀知识** | 对话中遇到新经验，AI 自动总结成结构化知识条目入库 |
| 📎 **文件上传分析** | 上传 docx / md / txt，AI 提炼关键信息（攻击路径、IOC、处置） |
| 🖥️ **SSH 交互终端** | mac 风格多标签终端，连接被攻陷服务器实时上机排查 |
| 🔖 **历史连接管理** | 保存常用 SSH 连接，一键快速重连 |
| ⚙️ **多模型支持** | 御三家（Claude/OpenAI/Gemini）+ 自定义 OpenAI 兼容网关 |

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install -r backend/requirements.txt
```

### 2. 启动

```bash
python run.py
```

浏览器打开 **http://127.0.0.1:8000**

### 3. 配置 AI 服务商（首次使用）

在网页 **「设置」** 面板中，填入任一家的 API Key：

- **Anthropic Claude**（默认，模型 `claude-opus-5-5`）
- **OpenAI**（模型 `gpt-4o`）
- **Google Gemini**（走官方 OpenAI 兼容端点）
- **自定义**（DeepSeek / 智谱 GLM / 通义千问 / 豆包 / Kimi 等任意 OpenAI 兼容网关）

Key 存服务端 `backend/config.json`（0600 权限，仅本机可读），前端脱敏显示。

> 也可用环境变量方式：复制 `backend/.env.example` 为 `backend/.env` 填入 key。

---

## 📁 项目结构

```
ShadowHunter/
├── run.py                    # 启动脚本
├── backend/
│   ├── main.py               # FastAPI 入口（chat/report/triage/knowledge/upload/distill/ssh）
│   ├── claude_client.py      # 统一多 Provider 客户端（流式）
│   ├── settings.py           # AI 服务商配置读写
│   ├── ssh_manager.py        # SSH 会话管理 + 历史连接存储
│   ├── file_parser.py        # docx/md/txt 文本提取
│   ├── knowledge_base_loader.py  # 知识库加载 + 检索 + CRUD
│   ├── prompts.py            # 各功能 system prompt（含安全红线）
│   ├── knowledge_base/       # 内置知识库（19 条，从应急响应报告蒸馏）
│   └── requirements.txt
└── frontend/
    ├── index.html            # 单页应用
    ├── style.css             # 简洁样式 + mac 风格终端
    └── app.js                # 交互逻辑（流式渲染 / xterm.js / WebSocket）
```

---

## 🔌 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/chat` | 通用对话（mode: `qa`/`triage`/`report`，流式） |
| GET/POST/DELETE | `/api/knowledge` | 知识库 CRUD |
| POST | `/api/upload` | 文件上传解析 |
| POST | `/api/distill` | AI 沉淀知识（流式） |
| GET/POST/DELETE | `/api/settings` | AI 服务商配置 |
| GET/POST/DELETE | `/api/ssh/connections` | SSH 历史连接管理 |
| WS | `/ws/ssh` | SSH 交互终端（WebSocket） |

---

## 🔒 安全红线（内置）

本项目在设计上遵循应急响应处置原则：

1. **取证优先、最小破坏** —— 处置前先隔离 + 证据保全
2. **不破坏现场** —— 不擅自删日志、清 history、覆盖文件
3. **最小处置** —— 只清除确认恶意的项，疑似正常业务先做误报排查
4. **不可逆操作先确认** —— 重装/删数据/断网/封 IP/改密默认给「建议+待确认」
5. **敏感信息脱敏** —— 报告不写真实人名/电话/密码，客户名用占位符

---

## ⚠️ 隐私与安全提醒

- 本项目为**本地部署**，API Key 与 SSH 连接信息存于本地文件（已加入 `.gitignore`，不会提交到版本库）
- SSH 密码默认明文存 `backend/ssh_connections.json`（仅本机 0600 权限）；如需更强安全，可改密钥登录或加密存储
- 上传文件与对话内容会发送到你配置的 AI 服务商，请勿上传敏感真实数据

---

## 📄 许可证

本项目仅供**授权范围内的应急响应、安全事件处置与安全研究**使用。请勿用于任何未授权的入侵、攻击或破坏性行为。
