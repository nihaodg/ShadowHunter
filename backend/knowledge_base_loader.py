"""知识库加载与检索：从 knowledge_base/ 目录加载 markdown，做关键词检索。

支持 CRUD：内置知识库（skill 蒸馏）+ 用户知识库（user_kb/），
用户条目独立存储，可增删改，不污染内置条目。
"""
import os
import re
from pathlib import Path
from typing import Optional

from . import config

# 用户知识库目录（独立于内置知识库，支持增删改）
USER_KB_DIR = Path(config.BASE_DIR) / "user_kb"


class KnowledgeBase:
    """加载并检索应急响应知识库。"""

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = base_dir or config.KNOWLEDGE_DIR
        self.docs: dict[str, str] = {}          # 文件名 -> 内容
        self.user_docs: dict[str, str] = {}     # 用户条目（user_kb/）
        self._load()

    def _load(self):
        self.docs = self._scan_dir(self.base_dir)
        USER_KB_DIR.mkdir(parents=True, exist_ok=True)
        self.user_docs = self._scan_dir(USER_KB_DIR)

    def _scan_dir(self, dirpath: Path) -> dict[str, str]:
        result = {}
        if not dirpath.exists():
            return result
        for root, _dirs, files in os.walk(dirpath):
            for f in files:
                if not f.endswith(".md"):
                    continue
                p = Path(root) / f
                rel = str(p.relative_to(dirpath)).replace("\\", "/")
                try:
                    result[rel] = p.read_text(encoding="utf-8")
                except Exception:
                    pass
        return result

    # ---------- 查询 ----------
    def list_docs(self) -> list[str]:
        return sorted(self.docs.keys())

    def list_user_docs(self) -> list[str]:
        return sorted(self.user_docs.keys())

    def get_doc(self, name: str) -> str:
        return self.docs.get(name, "")

    def get_user_doc(self, name: str) -> str:
        return self.user_docs.get(name, "")

    def _all_docs(self) -> dict[str, str]:
        """合并内置 + 用户知识库（用户同名覆盖内置，用于检索）。"""
        merged = dict(self.docs)
        merged.update(self.user_docs)
        return merged

    # ---------- 用户知识库 CRUD ----------
    def _safe_name(self, name: str) -> str:
        """确保文件名安全（去目录穿越、非法字符）。"""
        name = name.replace("\\", "/").split("/")[-1]  # 只取最后一段
        name = name.strip().strip(".")
        if not name:
            name = "untitled"
        if not name.endswith(".md"):
            name += ".md"
        # 去掉非法字符
        name = re.sub(r'[<>:"|?*\x00-\x1f]', "_", name)
        return name

    def create_user_doc(self, name: str, content: str) -> str:
        """新建/覆盖用户知识条目，返回文件名。"""
        fname = self._safe_name(name)
        path = USER_KB_DIR / fname
        path.write_text(content, encoding="utf-8")
        self.user_docs[fname] = content
        return fname

    def delete_user_doc(self, name: str) -> bool:
        fname = self._safe_name(name)
        path = USER_KB_DIR / fname
        if path.exists():
            path.unlink()
            self.user_docs.pop(fname, None)
            return True
        return False

    def update_user_doc(self, name: str, content: str) -> bool:
        fname = self._safe_name(name)
        if (USER_KB_DIR / fname).exists():
            return bool(self.create_user_doc(fname, content))
        return False

    # ---------- 检索 ----------
    def search(self, query: str, top_k: int = 5) -> list[tuple[str, str]]:
        """基于关键词匹配的简单检索，返回 [(文件名, 摘要)]。"""
        if not query:
            return []
        tokens = self._tokenize(query)
        all_docs = self._all_docs()
        scored: list[tuple[float, str]] = []
        for name, content in all_docs.items():
            score = 0.0
            name_l = name.lower()
            content_l = content.lower()
            for t in tokens:
                if t in name_l:
                    score += 3.0
                if t in content_l:
                    score += 1.0
            if score > 0:
                scored.append((score, name))
        scored.sort(key=lambda x: -x[0])
        results = []
        for score, name in scored[:top_k]:
            content = all_docs[name]
            summary = self._summarize(content, 300)
            results.append((name, summary))
        return results

    def _tokenize(self, text: str) -> list[str]:
        tokens = []
        for m in re.findall(r"[一-龥]{2,}", text):
            tokens.append(m)
        for m in re.findall(r"[a-zA-Z0-9]+", text):
            tokens.append(m.lower())
        return tokens

    def _summarize(self, content: str, max_len: int = 300) -> str:
        lines = [l.strip() for l in content.splitlines() if l.strip()]
        picked = []
        total = 0
        for l in lines:
            if total + len(l) > max_len:
                break
            picked.append(l)
            total += len(l)
        return "\n".join(picked)

    def build_context(self, query: str, top_k: int = 6) -> str:
        """构建注入 prompt 的知识库上下文。"""
        hits = self.search(query, top_k=top_k)
        if not hits:
            return ""
        parts = ["以下是应急响应知识库中相关的条目：\n"]
        for name, summary in hits:
            parts.append(f"### 【{name}】\n{summary}\n")
        return "\n".join(parts)


# 单例
kb = KnowledgeBase()

