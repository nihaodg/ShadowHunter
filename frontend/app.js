// 应急响应 AI 助手 - 前端交互逻辑
(function () {
  'use strict';

  // ===== 状态 =====
  let currentMode = 'qa';
  let chatHistory = [];  // 当前会话历史 [{role, content}]
  let currentSessionId = null;  // 当前会话 id（null = 未持久化的临时对话）

  // ===== DOM =====
  const $ = (sel) => document.querySelector(sel);
  const chatMessages = $('#chat-messages');
  const chatInput = $('#chat-input');
  const sendBtn = $('#send-btn');
  const chatTitle = $('#chat-title');
  const chatSubtitle = $('#chat-subtitle');
  const quickPrompts = $('#quick-prompts');
  const reportInput = $('#report-input');
  const reportContent = $('#report-content');
  const reportGenerate = $('#report-generate');
  const statusDot = $('#status-dot');
  const statusText = $('#status-text');
  const kbList = $('#kb-list');
  const settingsWrap = $('#settings-wrap');

  // provider 元信息（与后端 DEFAULTS 对应）
  const PROVIDERS = [
    { key: 'anthropic', name: 'Anthropic Claude', logo: '🅰', desc: 'Claude 系列模型（官方 API）', placeholder: 'sk-ant-...' },
    { key: 'openai', name: 'OpenAI', logo: '🤖', desc: 'GPT 系列模型', placeholder: 'sk-...' },
    { key: 'gemini', name: 'Google Gemini', logo: '🔮', desc: 'Gemini 系列（OpenAI 兼容端点）', placeholder: 'AIza...' },
    { key: 'custom', name: '自定义', logo: '🔧', desc: '任意 OpenAI 兼容网关（DeepSeek/GLM/通义/豆包…）', placeholder: '你的 key' }
  ];

  // ===== 简易 Markdown 渲染 =====
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // 代码块（先处理，避免内部被其他规则干扰）
    html = html.replace(/```([\s\S]*?)```/g, function (m, code) {
      return '<pre><code>' + code.replace(/^\n/, '') + '</code></pre>';
    });
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 标题
    html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    // 加粗
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 列表
    html = html.replace(/^[-*] (.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    // 换行
    html = html.replace(/\n\n/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== 消息渲染 =====
  function addMessage(role, content, isStreaming) {
    // 移除欢迎语
    const welcome = chatMessages.querySelector('.welcome');
    if (welcome) welcome.remove();

    const msg = document.createElement('div');
    msg.className = 'msg ' + role;
    msg.innerHTML =
      '<div class="msg-avatar">' + (role === 'assistant' ? '🛡️' : '👤') + '</div>' +
      '<div class="msg-bubble">' + (isStreaming
        ? '<span class="typing"><span></span><span></span><span></span></span>'
        : renderMarkdown(content)) + '</div>';
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg.querySelector('.msg-bubble');
  }

  function updateMessage(bubble, content) {
    bubble.innerHTML = renderMarkdown(content);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ===== 发送消息（流式） =====
  async function sendChat(message, mode) {
    if (!message.trim()) return;
    mode = mode || currentMode;

    // 首条消息时，若无会话则新建持久化会话
    if (!currentSessionId) {
      await ensureSession(message, mode);
    }

    addMessage('user', message);
    chatInput.value = '';
    autoResize();
    sendBtn.disabled = true;

    const bubble = addMessage('assistant', '', true);
    let fullText = '';

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: mode,
          message: message,
          history: chatHistory,
          stream: true
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || '请求失败');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        updateMessage(bubble, fullText);
      }

      // 记录历史
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: fullText });

      // 持久化到后端
      if (currentSessionId) {
        persistMessages([{ role: 'user', content: message }, { role: 'assistant', content: fullText }]);
      }
    } catch (e) {
      updateMessage(bubble, '⚠️ ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  }

  // ===== 会话持久化 =====
  async function ensureSession(firstMessage, mode) {
    try {
      const resp = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode, first_message: firstMessage })
      });
      const data = await resp.json();
      if (data.ok) {
        currentSessionId = data.session.id;
        loadConversationList();
      }
    } catch (e) {
      // 创建失败不阻塞对话，只是不持久化
    }
  }

  async function persistMessages(messages) {
    if (!currentSessionId) return;
    try {
      await fetch('/api/conversations/' + currentSessionId + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages })
      });
      loadConversationList();
    } catch (e) {}
  }

  async function loadConversationList() {
    const itemsEl = $('#conv-list-items');
    if (!itemsEl) return;
    try {
      const resp = await fetch('/api/conversations');
      const data = await resp.json();
      itemsEl.innerHTML = '';
      if (!data.sessions || data.sessions.length === 0) {
        itemsEl.innerHTML = '<div class="conv-empty">暂无历史对话</div>';
        return;
      }
      data.sessions.forEach((s) => {
        const item = document.createElement('div');
        item.className = 'conv-item' + (s.id === currentSessionId ? ' active' : '');
        item.innerHTML =
          '<span class="conv-item-title">' + escapeHtml(s.title) + '</span>' +
          '<button class="conv-item-del" title="删除">✕</button>';
        item.querySelector('.conv-item-del').onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('删除对话「' + s.title + '」？')) return;
          await fetch('/api/conversations/' + s.id, { method: 'DELETE' });
          if (s.id === currentSessionId) newConversation();
          loadConversationList();
        };
        item.onclick = () => loadConversation(s.id);
        itemsEl.appendChild(item);
      });
    } catch (e) {}
  }

  async function loadConversation(sessionId) {
    try {
      const resp = await fetch('/api/conversations/' + sessionId);
      if (!resp.ok) return;
      const data = await resp.json();
      currentSessionId = sessionId;
      chatHistory = data.messages || [];
      // 渲染到界面
      chatMessages.innerHTML = '';
      chatHistory.forEach((m) => {
        addMessage(m.role, m.content, false);
      });
      if (chatHistory.length === 0) {
        chatMessages.innerHTML = '<div class="welcome">' +
          '<div class="welcome-icon">🐺</div>' +
          '<h3>你好，我是 ShadowHunter 猎影</h3>' +
          '<p>可以问我：挖矿木马怎么排查？这台服务器 CPU 占用高怎么办？收到钓鱼邮件怎么处置？</p>' +
          '<div class="quick-prompts" id="quick-prompts"></div></div>';
      }
      loadConversationList();
      // 高亮当前
    } catch (e) {}
  }

  function newConversation() {
    currentSessionId = null;
    chatHistory = [];
    chatMessages.innerHTML = '<div class="welcome">' +
      '<div class="welcome-icon">🐺</div>' +
      '<h3>你好，我是 ShadowHunter 猎影</h3>' +
      '<p>可以问我：挖矿木马怎么排查？这台服务器 CPU 占用高怎么办？收到钓鱼邮件怎么处置？</p>' +
      '<div class="quick-prompts" id="quick-prompts"></div></div>';
    // 重新绑定快捷提示
    bindQuickPrompts();
    loadConversationList();
  }

  // ===== 报告生成（流式） =====
  async function generateReport() {
    const content = reportInput.value.trim();
    if (!content) return;

    reportGenerate.disabled = true;
    reportContent.innerHTML = '<div class="empty-state">生成中…</div>';
    let fullText = '';

    try {
      const resp = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'report', message: content, history: [], stream: true })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || '请求失败');
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        reportContent.innerHTML = renderMarkdown(fullText);
      }
    } catch (e) {
      reportContent.innerHTML = '<div class="empty-state">⚠️ ' + escapeHtml(e.message) + '</div>';
    } finally {
      reportGenerate.disabled = false;
    }
  }

  // ===== 面板切换 =====
  function switchMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.mode === mode);
    });

    // 面板
    $('#panel-chat').classList.toggle('hidden', mode !== 'qa' && mode !== 'triage');
    $('#panel-report').classList.toggle('hidden', mode !== 'report');
    $('#panel-kb').classList.toggle('hidden', mode !== 'kb');
    $('#panel-settings').classList.toggle('hidden', mode !== 'settings');
    $('#panel-ssh').classList.toggle('hidden', mode !== 'ssh');

    // 标题
    const titles = {
      qa: ['应急响应智能问答', '基于 80+ 份真实应急响应报告蒸馏的知识库，回答应急响应问题'],
      triage: ['智能分诊排查', '描述告警/异常现象，自动判断事件类型并给出排查步骤'],
      report: ['应急响应报告生成', '粘贴排查结果，一键生成标准格式报告'],
      kb: ['知识库', '已沉淀的应急响应知识条目，支持自己添加 / 编辑 / 删除'],
      settings: ['设置', '配置 AI 服务商与 API Key（御三家 + 自定义）'],
      ssh: ['SSH 终端', '连接可能被攻陷的服务器，交互式上机排查']
    };
    chatTitle.textContent = titles[mode][0];
    chatSubtitle.textContent = titles[mode][1];

    // 快捷提示
    bindQuickPrompts(mode);

    if (mode === 'kb') loadKnowledge();
    if (mode === 'settings') loadSettings();
    if (mode === 'ssh') {
      // 延迟初始化，等面板渲染完成
      setTimeout(() => {
        if (sshTabs.length === 0) newSshTab();
        loadSavedConnections();
      }, 50);
    }
  }

  // 绑定快捷提示（抽出独立函数，便于新对话后重新绑定）
  function bindQuickPrompts(mode) {
    mode = mode || 'qa';
    const container = $('#quick-prompts');
    if (!container) return;
    container.innerHTML = '';
    const prompts = mode === 'triage'
      ? ['服务器 CPU 占用 90%，外连矿池 IP 137.184.244.76',
         'EDR 报了 webshell 告警，怎么排查',
         '文件被加密成 .Elbie 后缀，怎么办']
      : ['挖矿木马怎么排查？', '收到钓鱼邮件怎么处置？', '数据库用户批量锁定是什么原因？'];
    const m = mode === 'triage' ? 'triage' : 'qa';
    prompts.forEach((q) => {
      const chip = document.createElement('div');
      chip.className = 'quick-chip';
      chip.textContent = q;
      chip.onclick = () => sendChat(q, m);
      container.appendChild(chip);
    });
  }

  // ===== 知识库加载 =====
  async function loadKnowledge() {
    kbList.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
      const resp = await fetch('/api/knowledge');
      const data = await resp.json();
      kbList.innerHTML = '';
      const kbMeta = {
        '挖矿木马.md': '挖矿木马排查与清除',
        '勒索病毒.md': '勒索病毒（RDP 入侵/phobos 家族）排查与处置',
        '僵尸木马与远控.md': 'Gh0st/银狐/CobaltStrike/vshell 远控排查与溯源',
        'webshell网页后门.md': 'webshell 定位、分析、清除',
        '钓鱼邮件与社工.md': '钓鱼邮件/社工事件分析与样本分析',
        '暗链.md': '暗链（黑帽SEO/爬虫分流）排查',
        '弱口令爆破.md': '弱口令/SSH 爆破/内网横向',
        '数据删除破坏.md': '数据删除/破坏事件排查',
        '数据库批量锁定.md': '数据库用户批量锁定/业务中断',
        '反弹shell与权限维持.md': '反弹shell、计划任务/启动项/后门账号权限维持',
        '反序列化漏洞利用.md': 'Shiro 等反序列化漏洞利用事件',
        '工具投毒供应链.md': '工具投毒/仿冒软件/供应链后门',
        '误报排查.md': '告警误报排查（DNS/SMB/漏扫脏数据等）'
      };

      // 内置条目（只读）
      const builtin = data.docs.filter(d => !d.startsWith('rules/') && d !== 'README.md');
      builtin.forEach((doc) => {
        const name = doc.split('/').pop();
        const desc = kbMeta[name] || '应急响应知识条目';
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = '<div class="kb-card-title">' + escapeHtml(name.replace('.md', '')) + '</div>' +
          '<div class="kb-card-desc">' + escapeHtml(desc) + '</div>';
        card.onclick = () => openKnowledgeDoc(doc, name.replace('.md', ''));
        kbList.appendChild(card);
      });

      // 用户条目（可编辑/删除）
      const userDocs = data.user_docs || [];
      userDocs.forEach((doc) => {
        const name = doc.split('/').pop();
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = '<div class="kb-card-title">' + escapeHtml(name.replace('.md', '')) +
          '<span class="kb-user-tag">用户</span></div>' +
          '<div class="kb-card-desc">自定义知识条目</div>' +
          '<div class="kb-card-actions">' +
            '<button class="ghost-btn kb-view-btn">查看</button>' +
            '<button class="ghost-btn kb-edit-btn">编辑</button>' +
            '<button class="ghost-btn kb-del-btn">删除</button>' +
          '</div>';
        card.querySelector('.kb-view-btn').onclick = (e) => { e.stopPropagation(); openKnowledgeDoc(doc, name.replace('.md', '')); };
        card.querySelector('.kb-edit-btn').onclick = (e) => { e.stopPropagation(); openKbEditor(doc); };
        card.querySelector('.kb-del-btn').onclick = (e) => { e.stopPropagation(); deleteKbDoc(doc); };
        kbList.appendChild(card);
      });

      if (builtin.length === 0 && userDocs.length === 0) {
        kbList.innerHTML = '<div class="empty-state">知识库为空，点「＋ 新建条目」添加</div>';
      }
    } catch (e) {
      kbList.innerHTML = '<div class="empty-state">⚠️ 加载失败</div>';
    }
  }

  // 打开知识库文档（用问答模式让模型讲解）
  function openKnowledgeDoc(doc, title) {
    switchMode('qa');
    sendChat('请给我详细讲解知识库条目【' + title + '】的内容，包括事件特征、排查要点、处置建议。', 'qa');
  }

  // ===== 知识库 CRUD =====
  function openKbEditor(doc) {
    const modal = $('#kb-modal');
    modal.classList.remove('hidden');
    $('#kb-modal-title').textContent = doc ? '编辑知识条目' : '新建知识条目';
    $('#kb-name-input').value = doc ? doc.replace('.md', '') : '';
    $('#kb-content-input').value = '';
    if (doc) {
      fetch('/api/knowledge/' + encodeURIComponent(doc))
        .then(r => r.json())
        .then(d => { $('#kb-content-input').value = d.content || ''; })
        .catch(() => {});
    }
    // 记录正在编辑的条目名（用于覆盖保存）
    modal.dataset.editing = doc || '';
  }

  function closeKbEditor() {
    $('#kb-modal').classList.add('hidden');
  }

  async function saveKbDoc() {
    const name = $('#kb-name-input').value.trim();
    const content = $('#kb-content-input').value.trim();
    if (!name || !content) { toast('名称和内容不能为空', true); return; }
    try {
      const resp = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: content })
      });
      const data = await resp.json();
      if (resp.ok) {
        toast('已保存：' + data.name);
        closeKbEditor();
        loadKnowledge();
      } else {
        toast('保存失败：' + (data.detail || ''), true);
      }
    } catch (e) {
      toast('保存失败', true);
    }
  }

  async function deleteKbDoc(doc) {
    if (!confirm('确定删除知识条目【' + doc.replace('.md', '') + '】吗？')) return;
    try {
      const resp = await fetch('/api/knowledge/' + encodeURIComponent(doc), { method: 'DELETE' });
      if (resp.ok) {
        toast('已删除');
        loadKnowledge();
      } else {
        const d = await resp.json().catch(() => ({}));
        toast('删除失败：' + (d.detail || ''), true);
      }
    } catch (e) {
      toast('删除失败', true);
    }
  }

  // ===== Toast 提示 =====
  function toast(msg, isErr) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 2500);
  }

  // ===== 设置面板 =====
  async function loadSettings() {
    settingsWrap.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
      const resp = await fetch('/api/settings');
      const data = await resp.json();
      const active = data.active_provider;
      const provs = data.providers;

      settingsWrap.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'provider-list';

      PROVIDERS.forEach((p) => {
        const cfg = provs[p.key] || {};
        const isActive = p.key === active;
        const card = document.createElement('div');
        card.className = 'provider-card' + (isActive ? ' active' : '');
        card.id = 'prov-' + p.key;

        const hasKey = cfg.has_key;
        const keyVal = hasKey ? cfg.key_masked : '';

        card.innerHTML =
          '<div class="provider-head">' +
            '<div class="provider-logo">' + p.logo + '</div>' +
            '<div class="provider-name">' + p.name + '</div>' +
            '<span class="provider-tag' + (isActive ? ' active-tag' : '') + '">' +
              (isActive ? '当前使用' : (hasKey ? '已配置' : '未配置')) + '</span>' +
          '</div>' +
          '<div class="provider-desc" style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">' + p.desc + '</div>' +
          '<div class="provider-fields">' +
            '<div class="field">' +
              '<label>API Key</label>' +
              '<div class="key-input-wrap">' +
                '<input type="password" class="key-input" placeholder="' + p.placeholder + '" value="' + escapeHtml(keyVal) + '">' +
              '</div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field">' +
                '<label>Base URL（留空 = 官方）</label>' +
                '<input type="text" class="base-input" placeholder="https://..." value="' + escapeHtml(cfg.base_url || '') + '">' +
              '</div>' +
              '<div class="field">' +
                '<label>模型名</label>' +
                '<input type="text" class="model-input" placeholder="model-name" value="' + escapeHtml(cfg.model || '') + '">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="provider-actions">' +
            '<button class="save-btn save-provider">保存配置</button>' +
            '<button class="use-btn use-provider">设为当前</button>' +
          '</div>';

        list.appendChild(card);
      });

      settingsWrap.appendChild(list);

      const note = document.createElement('div');
      note.className = 'settings-note';
      note.innerHTML = '<b>说明</b>：<br>' +
        '· 御三家 = Anthropic Claude / OpenAI / Google Gemini，另加「自定义」支持任意 OpenAI 兼容网关（DeepSeek、智谱 GLM、通义千问、豆包、Kimi 等）。<br>' +
        '· API Key 存服务端 <code>backend/config.json</code>（仅本机可读），脱敏显示。<br>' +
        '· 已配置的 key 显示为 <code>sk-ant***xyz</code> 形式，不重新填写则保留原 key。<br>' +
        '· Gemini 默认走官方 OpenAI 兼容端点；自定义网关需自己填 Base URL 和模型名。';
      settingsWrap.appendChild(note);

      // 绑定事件
      document.querySelectorAll('.provider-card').forEach((card) => {
        const key = card.id.replace('prov-', '');
        card.querySelector('.save-provider').addEventListener('click', () => saveProvider(key, card));
        card.querySelector('.use-provider').addEventListener('click', () => useProvider(key, card));
      });
    } catch (e) {
      settingsWrap.innerHTML = '<div class="empty-state">⚠️ 加载失败</div>';
    }
  }

  function readProviderInputs(card) {
    return {
      api_key: card.querySelector('.key-input').value.trim(),
      base_url: card.querySelector('.base-input').value.trim(),
      model: card.querySelector('.model-input').value.trim()
    };
  }

  async function saveProvider(key, card) {
    const fields = readProviderInputs(card);
    try {
      const resp = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [key]: fields } })
      });
      const data = await resp.json();
      if (resp.ok) {
        toast('已保存 ' + key + ' 配置');
        loadSettings();
      } else {
        toast('保存失败：' + (data.detail || ''), true);
      }
    } catch (e) {
      toast('保存失败', true);
    }
  }

  async function useProvider(key, card) {
    // 先保存当前输入（避免切换时丢失未保存的修改）
    const fields = readProviderInputs(card);
    try {
      const resp = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_provider: key, providers: { [key]: fields } })
      });
      const data = await resp.json();
      if (resp.ok) {
        toast('已切换为 ' + (PROVIDERS.find(p => p.key === key)?.name || key));
        loadSettings();
        checkHealth();
      } else {
        toast('切换失败：' + (data.detail || ''), true);
      }
    } catch (e) {
      toast('切换失败', true);
    }
  }

  // ===== 文件上传分析 =====
  function bindUpload() {
    $('#upload-btn').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      toast('正在解析文件：' + file.name);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) {
          toast('上传失败：' + (data.detail || ''), true);
          return;
        }
        const truncatedNote = data.truncated ? '\n（注：文件过长已截断至前 ' + data.char_count + ' 字符）' : '';
        addMessage('user', '📎 上传文件「' + data.filename + '」（' + data.char_count + ' 字符）');
        const prompt = '请分析这份文件（' + data.filename + '）的内容，提炼关键信息：\n\n```\n' + data.text + '\n```' + truncatedNote;
        // 用文件分析模式走 chat
        const bubble = addMessage('assistant', '', true);
        let fullText = '';
        sendBtn.disabled = true;
        const resp2 = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'qa', message: prompt, history: chatHistory, stream: true })
        });
        const reader = resp2.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          updateMessage(bubble, fullText);
        }
        chatHistory.push({ role: 'user', content: '上传文件「' + data.filename + '」并请求分析' });
        chatHistory.push({ role: 'assistant', content: fullText });
      } catch (err) {
        toast('上传失败', true);
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  // ===== 沉淀知识 =====
  function bindDistill() {
    $('#distill-btn').addEventListener('click', openDistill);
    $('#distill-cancel').addEventListener('click', closeDistill);
    $('#distill-close').addEventListener('click', closeDistill);
    $('#distill-generate').addEventListener('click', generateDistill);
    $('#distill-save').addEventListener('click', saveDistill);
  }

  function openDistill() {
    $('#distill-modal').classList.remove('hidden');
    $('#distill-name').value = '';
    $('#distill-content').value = '';
    $('#distill-result').classList.add('hidden');
    $('#distill-draft').value = '';
  }

  function closeDistill() {
    $('#distill-modal').classList.add('hidden');
  }

  async function generateDistill() {
    const name = $('#distill-name').value.trim();
    let content = $('#distill-content').value.trim();
    // 留空则用当前对话历史总结
    if (!content) {
      if (chatHistory.length === 0) {
        toast('请先输入内容，或在对话中有历史记录', true);
        return;
      }
      content = chatHistory.map(h => h.role + ': ' + h.content).join('\n\n');
    }
    $('#distill-generate').disabled = true;
    $('#distill-result').classList.remove('hidden');
    $('#distill-draft').value = '生成中…';
    let fullText = '';
    try {
      const resp = await fetch('/api/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content, name: name, history: chatHistory })
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        $('#distill-draft').value = fullText;
      }
    } catch (e) {
      $('#distill-draft').value = '生成失败：' + e.message;
    } finally {
      $('#distill-generate').disabled = false;
    }
  }

  async function saveDistill() {
    const draft = $('#distill-draft').value.trim();
    let name = $('#distill-name').value.trim();
    if (!draft) { toast('草稿为空', true); return; }
    // 从草稿第一行 # 提取条目名
    if (!name) {
      const m = draft.match(/^#\s+(.+)$/m);
      name = m ? m[1].trim() : '未命名条目';
    }
    try {
      const resp = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: draft })
      });
      const data = await resp.json();
      if (resp.ok) {
        toast('已沉淀到知识库：' + data.name);
        closeDistill();
        loadKnowledge();
      } else {
        toast('保存失败：' + (data.detail || ''), true);
      }
    } catch (e) {
      toast('保存失败', true);
    }
  }

  // ===== SSH 终端（xterm.js + 多标签页） =====
  let sshTabs = [];   // [{ id, name, host, port, username, ws, term, status }]
  let sshActiveId = null;
  let sshTabSeq = 0;

  function bindSSH() {
    $('#ssh-connect-btn').addEventListener('click', connectSSH);
    $('#ssh-save-btn').addEventListener('click', saveConnection);
    $('#ssh-new-tab').addEventListener('click', () => newSshTab());
  }

  function makeTermTheme() {
    return {
      background: '#1e1e1e',
      foreground: '#f0f0f0',
      cursor: '#f0f0f0',
      cursorAccent: '#1e1e1e',
      selectionBackground: '#4d4d4d',
      black: '#000000', red: '#c91b00', green: '#00c200', yellow: '#c7c400',
      blue: '#0225c7', magenta: '#ca30c7', cyan: '#00c5c7', white: '#c7c7c7',
      brightBlack: '#686868', brightRed: '#ff6e67', brightGreen: '#5ffa68',
      brightYellow: '#fffc67', brightBlue: '#6871ff', brightMagenta: '#ff77ff',
      brightCyan: '#60fdff', brightWhite: '#ffffff'
    };
  }

  function newSshTab() {
    if (typeof Terminal === 'undefined') {
      toast('xterm.js 加载失败（可能无网络），请刷新重试', true);
      return;
    }
    sshTabSeq += 1;
    const id = 't' + sshTabSeq;
    const tab = { id, name: '新终端', host: '', port: 22, username: '', ws: null, term: null, status: 'idle' };

    // 创建 DOM 容器
    const terminalsEl = $('#ssh-terminals');
    const inst = document.createElement('div');
    inst.className = 'ssh-term-instance';
    inst.id = 'term-inst-' + id;
    terminalsEl.appendChild(inst);

    // 创建 xterm
    const term = new Terminal({
      cursorBlink: true, fontSize: 13,
      fontFamily: '"SF Mono", "Menlo", "Consolas", "Courier New", monospace',
      theme: makeTermTheme(),
      convertEol: false, scrollback: 5000, lineHeight: 1.2
    });
    term.open(inst);
    tab.term = term;
    term.writeln('填写左侧连接信息后点击「连接」，或从历史连接点开');
    term.writeln('');

    term.onData((data) => {
      if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
        tab.ws.send(JSON.stringify({ type: 'input', data: data }));
      }
    });

    sshTabs.push(tab);
    renderSshTabs();
    activateSshTab(id);
    return tab;
  }

  function renderSshTabs() {
    const tabsEl = $('#ssh-tabs');
    tabsEl.innerHTML = '';
    sshTabs.forEach((tab) => {
      const t = document.createElement('div');
      t.className = 'mac-tab' + (tab.id === sshActiveId ? ' active' : '');
      t.innerHTML =
        '<span class="mac-tab-status ' + (tab.status === 'connected' ? 'connected' : (tab.status === 'connecting' ? 'connecting' : '')) + '"></span>' +
        '<span class="mac-tab-name">' + escapeHtml(tab.name) + '</span>' +
        '<span class="mac-tab-close">✕</span>';
      t.querySelector('.mac-tab-name').onclick = () => activateSshTab(tab.id);
      t.querySelector('.mac-tab-close').onclick = (e) => { e.stopPropagation(); closeSshTab(tab.id); };
      t.onclick = () => activateSshTab(tab.id);
      tabsEl.appendChild(t);
    });
  }

  function activateSshTab(id) {
    sshActiveId = id;
    sshTabs.forEach((tab) => {
      const inst = $('#term-inst-' + tab.id);
      if (inst) inst.classList.toggle('active', tab.id === id);
    });
    renderSshTabs();
    const tab = sshTabs.find(t => t.id === id);
    if (tab && tab.term) {
      setTimeout(() => {
        if (tab.fitAddon) { try { tab.fitAddon.fit(); } catch (e) {} }
        tab.term.focus();
      }, 30);
    }
  }

  function closeSshTab(id) {
    const idx = sshTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = sshTabs[idx];
    if (tab.ws) { try { tab.ws.close(); } catch (e) {} }
    const inst = $('#term-inst-' + id);
    if (inst) inst.remove();
    sshTabs.splice(idx, 1);
    if (sshActiveId === id) {
      sshActiveId = sshTabs.length ? sshTabs[sshTabs.length - 1].id : null;
    }
    renderSshTabs();
    if (sshActiveId) activateSshTab(sshActiveId);
  }

  function connectSSH() {
    const host = $('#ssh-host').value.trim();
    const port = parseInt($('#ssh-port').value || '22');
    const username = $('#ssh-user').value.trim();
    const password = $('#ssh-pass').value;
    const name = $('#ssh-name').value.trim() || (username + '@' + host);
    if (!host || !username || !password) {
      toast('请填写主机、用户名、密码', true);
      return;
    }
    // 新建标签并连接
    const tab = newSshTab();
    tab.name = name;
    tab.host = host; tab.port = port; tab.username = username;
    renderSshTabs();
    doConnect(tab, { host, port, username, password });
  }

  function doConnect(tab, cred) {
    tab.status = 'connecting';
    renderSshTabs();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/ws/ssh');
    tab.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'connect', data: cred }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'connected') {
        tab.status = 'connected';
        tab.sessionId = msg.session_id;
        renderSshTabs();
        tab.term.writeln('\r\n已连接 ' + cred.username + '@' + cred.host + ':' + cred.port);
        // resize
        const term = tab.term;
        if (tab.fitAddon) { try { tab.fitAddon.fit(); } catch (e) {} }
        ws.send(JSON.stringify({ type: 'resize', data: { cols: term.cols, rows: term.rows } }));
        term.focus();
        setSshStatus('已连接 ' + tab.name, 'ok');
      } else if (msg.type === 'output') {
        tab.term.write(msg.data);
      } else if (msg.type === 'error') {
        tab.status = 'idle';
        renderSshTabs();
        tab.term.writeln('\r\n[连接失败] ' + msg.message);
        setSshStatus('连接失败：' + msg.message, 'bad');
      } else if (msg.type === 'closed') {
        tab.status = 'idle';
        renderSshTabs();
        tab.term.writeln('\r\n[连接已关闭]');
      }
    };
    ws.onerror = () => {
      setSshStatus('WebSocket 错误', 'bad');
    };
    ws.onclose = () => {
      if (tab.status === 'connected') {
        tab.status = 'idle';
        tab.term.writeln('\r\n[连接已断开]');
        renderSshTabs();
      }
    };
  }

  function setSshStatus(text, cls) {
    const s = $('#ssh-status');
    if (!s) return;
    s.textContent = text;
    s.className = 'ssh-status' + (cls ? ' ' + cls : '');
  }

  function saveConnection() {
    const name = $('#ssh-name').value.trim();
    const host = $('#ssh-host').value.trim();
    const port = parseInt($('#ssh-port').value || '22');
    const username = $('#ssh-user').value.trim();
    const password = $('#ssh-pass').value;
    if (!name || !host || !username || !password) {
      toast('保存需要：名称、主机、用户名、密码', true);
      return;
    }
    fetch('/api/ssh/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, host, port, username, password })
    }).then(r => r.json()).then(d => {
      if (d.ok) { toast('已保存连接：' + name); loadSavedConnections(); }
      else toast('保存失败', true);
    }).catch(() => toast('保存失败', true));
  }

  async function loadSavedConnections() {
    const listEl = $('#ssh-saved-list');
    if (!listEl) return;
    try {
      const r = await fetch('/api/ssh/connections');
      const d = await r.json();
      listEl.innerHTML = '';
      if (!d.connections || d.connections.length === 0) {
        listEl.innerHTML = '<div style="color:#999;font-size:12px;padding:6px;">暂无保存的连接</div>';
        return;
      }
      d.connections.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'ssh-saved-item';
        item.innerHTML =
          '<div class="ssh-saved-info">' +
            '<span class="ssh-saved-name">' + escapeHtml(c.name) + '</span>' +
            '<span class="ssh-saved-host">' + escapeHtml(c.username + '@' + c.host + ':' + c.port) + '</span>' +
          '</div>' +
          '<button class="ssh-saved-del" title="删除">✕</button>';
        item.querySelector('.ssh-saved-del').onclick = (e) => {
          e.stopPropagation();
          if (confirm('删除连接「' + c.name + '」？')) {
            fetch('/api/ssh/connections/' + encodeURIComponent(c.name), { method: 'DELETE' })
              .then(() => { toast('已删除'); loadSavedConnections(); });
          }
        };
        item.onclick = () => {
          // 点击历史连接 → 填表并连接
          $('#ssh-name').value = c.name;
          $('#ssh-host').value = c.host;
          $('#ssh-port').value = c.port;
          $('#ssh-user').value = c.username;
          $('#ssh-pass').value = c.password || '';
          connectSSH();
        };
        listEl.appendChild(item);
      });
    } catch (e) {
      listEl.innerHTML = '<div style="color:#999;font-size:12px;">加载失败</div>';
    }
  }

  function initTerm() {
    // 保留旧接口兼容，不再使用（多标签用 newSshTab）
    if (typeof Terminal === 'undefined') {
      toast('xterm.js 加载失败（可能无网络）', true);
      return;
    }
    if (sshTabs.length === 0) newSshTab();
  }

  // ===== 健康检查 =====
  async function checkHealth() {
    try {
      const resp = await fetch('/api/health');
      const data = await resp.json();
      statusDot.className = 'status-dot ' + (data.has_api_key ? 'ok' : 'bad');
      statusText.textContent = data.has_api_key
        ? 'API 已就绪 · ' + data.knowledge_docs + ' 条知识'
        : '未配置 API Key';
    } catch (e) {
      statusDot.className = 'status-dot bad';
      statusText.textContent = '后端未连接';
    }
  }

  // ===== 工具函数 =====
  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  }

  // ===== 事件绑定 =====
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.mode) switchMode(el.dataset.mode);
    });
  });

  // 新对话按钮
  const newChatBtn = $('#nav-new-chat');
  if (newChatBtn) newChatBtn.addEventListener('click', () => {
    newConversation();
    switchMode('qa');
  });

  sendBtn.addEventListener('click', () => sendChat(chatInput.value, currentMode));
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat(chatInput.value, currentMode);
    }
  });
  chatInput.addEventListener('input', autoResize);

  reportGenerate.addEventListener('click', generateReport);
  $('#report-clear').addEventListener('click', () => { reportInput.value = ''; });
  $('#report-copy').addEventListener('click', async () => {
    const text = reportContent.innerText;
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制');
    } catch (e) {
      alert('复制失败，请手动选择复制');
    }
  });
  $('#report-download').addEventListener('click', () => {
    const text = reportContent.innerText;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '应急响应报告.md';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 知识库 CRUD
  $('#kb-add-btn').addEventListener('click', () => openKbEditor(null));
  $('#kb-modal-close').addEventListener('click', closeKbEditor);
  $('#kb-modal-cancel').addEventListener('click', closeKbEditor);
  $('#kb-modal-save').addEventListener('click', saveKbDoc);

  // 文件上传
  bindUpload();

  // 沉淀知识
  bindDistill();

  // SSH
  bindSSH();

  // ===== 初始化 =====
  switchMode('qa');
  loadConversationList();
  checkHealth();
})();
