"""配置模块：API key、模型、路径。

设计：项目只读自己的 .env 配置，不误继承系统环境里的第三方网关
（如 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 指向的网关）。
默认走 Anthropic 官方 Claude API，用户可在 .env 覆盖 base_url 和 model。
"""
import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).resolve().parent

# 知识库目录
KNOWLEDGE_DIR = BASE_DIR / "knowledge_base"

# ===== .env 加载（只读本项目 .env，key 已存在则不覆盖） =====
def _load_dotenv():
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip().strip('"').strip("'")
                if key and val and key not in os.environ:
                    os.environ[key] = val

_load_dotenv()

# ===== 配置项（显式读取，避免继承系统环境里的第三方网关） =====
# API Key：优先 IR_API_KEY，其次 .env 里的 ANTHROPIC_API_KEY，再次环境变量
API_KEY = (
    os.getenv("IR_API_KEY")
    or os.getenv("ANTHROPIC_API_KEY")
    or ""
)

# Base URL：默认 None（走官方 api.anthropic.com）；.env 里 IR_BASE_URL 可覆盖为第三方网关
BASE_URL = os.getenv("IR_BASE_URL") or None

# 模型：默认 Claude Opus 5.5；.env 里 IR_MODEL 可覆盖
MODEL = os.getenv("IR_MODEL", "claude-opus-5-5")


def has_api_key() -> bool:
    """是否已配置可用的 API key。"""
    return bool(API_KEY)
