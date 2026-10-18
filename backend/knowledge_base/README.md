# 应急响应知识库目录

本目录为事件类型 playbook，处置时**先看 SKILL.md 分诊表对上的那一篇**，不要通读整个目录。

## 事件类型 playbook

| 文件 | 事件类型 |
|------|---------|
| `挖矿木马.md` | 挖矿木马（CPU/矿池外联/弱口令入口） |
| `勒索病毒.md` | 勒索病毒（RDP 入侵/文件加密/家族判定） |
| `僵尸木马与远控.md` | 僵尸木马/远控（Gh0st/银狐/CobaltStrike/vshell） |
| `webshell网页后门.md` | webshell 网页后门（定位/分析/清除） |
| `钓鱼邮件与社工.md` | 钓鱼邮件/社工（邮件分析/样本分析/社工） |
| `暗链.md` | 暗链（黑帽SEO/爬虫分流） |
| `弱口令爆破.md` | 弱口令/SSH 爆破/内网横向 |
| `数据删除破坏.md` | 数据删除/破坏（账号覆盖） |
| `数据库批量锁定.md` | 数据库批量锁定/业务中断 |
| `反弹shell与权限维持.md` | 反弹shell/权限维持（计划任务/公钥/后门账号） |
| `反序列化漏洞利用.md` | Shiro 等反序列化漏洞利用 |
| `工具投毒供应链.md` | 工具投毒/仿冒软件/供应链后门 |
| `误报排查.md` | 告警误报排查（DNS/SMB/漏扫脏数据/历史残留） |

## 排查清单（rules/）

| 文件 | 内容 |
|------|------|
| `../rules/ir-workflow.md` | 六阶段总流程 |
| `../rules/ir-redline.md` | 红线（取证/最小破坏/脱敏） |
| `../rules/ir-linux-checklist.md` | Linux 排查清单（命令） |
| `../rules/ir-windows-checklist.md` | Windows 排查清单（命令） |
| `../rules/ir-report-format.md` | 报告格式（唯一） |

## 使用原则

1. 分诊定级 → 对表开 playbook
2. 排查 → 过对应清单（Linux/Windows）
3. 溯源 → 串攻击链
4. 报告 → ir-report-format.md
5. 多类型叠加 → 按攻击链串多个 playbook（如「弱口令 → 挖矿」「钓鱼 → 工具投毒 → 远控」）
