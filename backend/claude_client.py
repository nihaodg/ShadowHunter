"""统一多 Provider 客户端。

- anthropic: Anthropic SDK（流式）
- openai / gemini / custom: OpenAI 兼容接口（Gemini 用官方 OpenAI 兼容端点，
  custom 供任意 OpenAI 兼容网关，如 DeepSeek/GLM/通义/豆包等）

配置读取自 settings.load_config()，全部显式传参，不误继承系统环境变量。
"""
from typing import AsyncIterator, Optional

from . import settings


class UnifiedClient:
    def _active(self) -> tuple[str, dict]:
        cfg = settings.load_config()
        prov = cfg["active_provider"]
        return prov, cfg["providers"].get(prov, {})

    @property
    def has_key(self) -> bool:
        _, prov = self._active()
        return bool(prov.get("api_key"))

    @property
    def active_provider(self) -> str:
        prov, _ = self._active()
        return prov

    @property
    def active_model(self) -> str:
        _, prov = self._active()
        return prov.get("model") or ""

    async def stream_chat(
        self,
        *,
        system: str,
        messages: list[dict],
        max_tokens: int = 8000,
        model: Optional[str] = None,
    ) -> AsyncIterator[str]:
        provider, prov = self._active()
        m = model or prov.get("model") or settings.DEFAULTS.get(provider, {}).get("model", "")

        if provider == "anthropic":
            async for text in self._stream_anthropic(prov, m, system, messages, max_tokens):
                yield text
        else:
            async for text in self._stream_openai_compat(prov, m, system, messages, max_tokens):
                yield text

    # ---------- Anthropic ----------
    async def _stream_anthropic(self, prov, model, system, messages, max_tokens):
        import anthropic
        kwargs = {"api_key": prov["api_key"]}
        if prov.get("base_url"):
            kwargs["base_url"] = prov["base_url"]
        client = anthropic.AsyncAnthropic(**kwargs)
        async with client.messages.stream(
            model=model or "claude-opus-5-5",
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    # ---------- OpenAI 兼容 ----------
    async def _stream_openai_compat(self, prov, model, system, messages, max_tokens):
        from openai import AsyncOpenAI
        kwargs = {"api_key": prov["api_key"]}
        if prov.get("base_url"):
            kwargs["base_url"] = prov["base_url"]
        client = AsyncOpenAI(**kwargs)

        # system 作为 messages 首条
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.extend(messages)

        stream = await client.chat.completions.create(
            model=model,
            messages=msgs,
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


# 单例
client = UnifiedClient()
