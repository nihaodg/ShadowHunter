"""Provider 配置的读写（存服务端 config.json）。

支持四家：anthropic / openai / gemini / custom（自定义 OpenAI 兼容网关）。
Key 存服务端文件，读取时脱敏返回。
"""
import json
import os
from pathlib import Path
from typing import Any, Optional

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config.json"

# 各 provider 的默认模型与默认 base_url
DEFAULTS: dict[str, dict[str, str]] = {
    "anthropic": {
        "name": "Anthropic Claude",
        "model": "claude-opus-5-5",
        "base_url": "",  # 空 = 官方 api.anthropic.com
    },
    "openai": {
        "name": "OpenAI",
        "model": "gpt-4o",
        "base_url": "",  # 空 = 官方 api.openai.com
    },
    "gemini": {
        "name": "Google Gemini",
        "model": "gemini-2.5-pro",
        # Gemini 官方 OpenAI 兼容端点
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
    },
    "custom": {
        "name": "自定义",
        "model": "",
        "base_url": "",
    },
}

# 支持的 provider 顺序（决定前端展示顺序）
PROVIDER_ORDER = ["anthropic", "openai", "gemini", "custom"]


def _empty_config() -> dict:
    return {
        "active_provider": "anthropic",
        "providers": {
            p: {"api_key": "", "base_url": d["base_url"], "model": d["model"]}
            for p, d in DEFAULTS.items()
        },
    }


def load_config() -> dict:
    """读取配置，缺失则用默认。"""
    cfg = _empty_config()
    if CONFIG_FILE.exists():
        try:
            saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            # 合并：只覆盖已存在的 provider 字段
            if "active_provider" in saved:
                cfg["active_provider"] = saved["active_provider"]
            for p, prov in saved.get("providers", {}).items():
                if p in cfg["providers"]:
                    if "api_key" in prov:
                        cfg["providers"][p]["api_key"] = prov["api_key"]
                    if prov.get("base_url"):
                        cfg["providers"][p]["base_url"] = prov["base_url"]
                    if prov.get("model"):
                        cfg["providers"][p]["model"] = prov["model"]
        except Exception:
            pass
    return cfg


def save_config(cfg: dict):
    """写配置到 config.json（尽量私有权限）。"""
    CONFIG_FILE.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    try:
        os.chmod(CONFIG_FILE, 0o600)  # 仅当前用户可读写
    except Exception:
        pass


def mask_key(key: str) -> str:
    """脱敏：sk-ant-abc...xyz 形式，短 key 只显示前几位。"""
    if not key:
        return ""
    if len(key) <= 8:
        return key[:3] + "***"
    return key[:6] + "***" + key[-4:]


def public_config(cfg: dict) -> dict:
    """返回脱敏后的配置（给前端用）。"""
    result = {"active_provider": cfg["active_provider"], "providers": {}}
    for p in PROVIDER_ORDER:
        prov = cfg["providers"].get(p, {})
        d = DEFAULTS.get(p, {})
        key = prov.get("api_key", "")
        result["providers"][p] = {
            "name": d.get("name", p),
            "has_key": bool(key),
            "key_masked": mask_key(key),
            "base_url": prov.get("base_url", d.get("base_url", "")),
            "model": prov.get("model", d.get("model", "")),
        }
    return result


def update_config(active_provider: Optional[str] = None,
                  updates: Optional[dict[str, dict]] = None) -> dict:
    """更新配置。updates 形如 {"openai": {"api_key": "...", "base_url": "...", "model": "..."}}。

    api_key 传空字符串或脱敏值表示不修改原 key。
    """
    cfg = load_config()
    if active_provider in cfg["providers"]:
        cfg["active_provider"] = active_provider
    for p, fields in (updates or {}).items():
        if p not in cfg["providers"]:
            continue
        prov = cfg["providers"][p]
        api_key = fields.get("api_key", "")
        # 空 或 含 "***"（脱敏占位）都视为不修改
        if api_key and "***" not in api_key:
            prov["api_key"] = api_key.strip()
        if fields.get("base_url") is not None:
            prov["base_url"] = fields["base_url"].strip()
        if fields.get("model") is not None:
            prov["model"] = fields["model"].strip()
    save_config(cfg)
    return cfg
