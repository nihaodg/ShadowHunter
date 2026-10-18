# Windows 主机排查清单

上机排查按此顺序过一遍。**每条都要记录输出 + 结论 + 时间点**。

## 1. 进程与网络连接（挖矿/远控/勒索 必查）

```powershell
# 进程
tasklist                    # 可疑进程（陌生名、临时目录路径）
tasklist /svc               # 进程对应服务
wmic process get name,processid,parentprocessid,executablepath  # 进程 + 父进程 + 可执行文件路径

# 网络连接（外联 C2/矿池/反弹 shell 必查）
netstat -ano                # 连接 + PID，找 ESTABLISHED 到陌生公网 IP
netstat -anob               # 连接 + 对应进程名

# 根据 PID 定位进程
tasklist | findstr <PID>
```

> 高频线索：进程名 `active_desktop_launcher_x64.exe`（银狐）、`gkzq.exe`/`wx.exe`（CobaltStrike/fscan 伪装）、在 `C:\Users\Public\`、`C:\PerfLogs\`、`Temp` 等非常规路径下执行的进程。

## 2. 启动项、计划任务、服务（权限维持）

```powershell
# 启动项
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
wmic startup list full
# 启动文件夹
dir "C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"

# 计划任务
schtasks /query /fo LIST /v    # 全量计划任务，看陌生任务名、陌生可执行文件路径
# 高频恶意计划任务：名称伪装成系统项（如 Explorer\setup），执行 PowerShell 下载/自启动

# 服务
sc query                      # 服务列表
wmic service list brief
```

## 3. 账号与登录日志

```powershell
# 用户
net user                       # 本地用户列表（查后门账号）
net localgroup administrators  # 管理员组（查新增管理员）
wmic useraccount list brief

# 安全日志（登录/爆破/RDP）
# 事件查看器 → Windows 日志 → 安全
# 关键 EventID：
#   4624 登录成功、4625 登录失败（爆破）
#   4648 显式凭据登录、4672 特殊权限
# 用 LogParser 筛选 RDP 登录成功记录（EventID=4624, LogonType=10）
LogParser.exe -i:EVT -o:DATAGRID "SELECT TimeGenerated as LoginTime, EXTRACT_TOKEN(Strings,5,'|') as username, EXTRACT_TOKEN(Strings,8,'|') as LogonType, EXTRACT_TOKEN(Strings,18,'|') AS SourceIP FROM <evtx路径> WHERE EventID=4624"

# RDP 登录日志（定位远程登录 IP）
# 事件查看器 → 应用程序和服务日志 → Microsoft-Windows-TerminalServices-LocalSessionManager-Operational
```

> 高频线索：中勒索前 RDP 登录失败（爆破）日志**被删除**，但中勒索后的失败日志还在 → 攻击者删日志。RDP 登录成功时间与勒索加密时间相差不到 1 分钟 → 入口点就是 RDP。

## 4. 文件排查（恶意文件/webshell/勒索）

```powershell
# 最近变动/新增文件
dir /s /a 可疑目录
# 隐藏文件（webshell 常用隐藏属性）
dir /a:h
attrib           # 查看/清除隐藏属性
# 隐藏受保护的操作系统文件也要显示：文件夹选项取消勾选「隐藏受保护的操作系统文件」

# 全盘搜索可疑文件（everything 按创建/修改时间搜）
# 高频可疑路径：C:\Users\Public\、C:\PerfLogs\、C:\ProgramData\、Temp、web 目录
# webshell 特征：.jsp/.asp/.aspx/.php 一句话木马、图片马（.jpg 里藏 php）、临时文件 .tmp
```

## 5. hosts / DNS 劫持

```powershell
type C:\Windows\System32\drivers\etc\hosts   # 检查恶意域名指向
ipconfig /displaydns                          # DNS 缓存
```

## 6. 样本检测（定性恶意文件）

- 提取可疑文件样本 → 计算 MD5/SHA256
- 提交 VirusTotal / 微步在线 / 杀软全盘查杀（火绒、360、Windows Defender）
- 沙箱跑样本看行为（回连 IP、释放文件、计划任务、Defender 排除项）

## 7. 快速结论模板

每项排查后落一句结论，例如：
- 「启动项无异常」「无隐藏用户」「无恶意进程」
- 「安全日志发现 `x.x.x.x` 于 `时间` RDP 登录成功，无此前爆破日志（疑似被删）」
- 「进程 PID `xxx` 对应 `C:\PerfLogs\xxx.exe`，VT 多家引擎报毒」
- 「计划任务发现 `Explorer\setup`，执行 PowerShell 自启动，为恶意项」
