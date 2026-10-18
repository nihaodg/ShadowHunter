# Linux 主机排查清单

上机排查按此顺序过一遍。**每条都要记录输出 + 结论 + 时间点**，用于溯源和报告。

## 1. 账号与登录（最先看，弱口令/后门账号是高频入口）

```bash
# 当前在线用户 / 登录情况
w
who
last -i                     # 非本地登录（远程 SSH）记录，重点看异常 IP
lastlog

# 用户与后门账号
cat /etc/passwd             # 检查新增的可登录账号（uid=0 或多个 uid=0）
awk -F: '$3==0 {print}' /etc/passwd   # uid=0 的用户（root 后门）
cat /etc/shadow             # 密码哈希；弱口令账号、空密码账号
grep useradd /var/log/secure /var/log/auth.log 2>/dev/null  # 账号添加记录

# SSH 公钥后门
ls -la /root/.ssh/ /home/*/.ssh/ 2>/dev/null
cat /root/.ssh/authorized_keys 2>/dev/null   # 检查是否存在攻击者公钥
```

## 2. 历史命令（溯源金矿）

```bash
cat /root/.bash_history
cat /home/*/.bash_history
# 高频线索关键词：set +o history、rm -rf、useradd、curl/wget 下载、ssh 爆破工具、挖矿、webshell
```

> 注意：`set +o history` 出现 = 攻击者有意隐藏后续操作；history 被删/为空 = 攻击痕迹。

## 3. 进程与网络连接（挖矿/远控/反弹shell 必查）

```bash
ps aux                      # 可疑进程（陌生名、高 CPU、/tmp 或隐藏目录下执行）
top -c                      # 实时 CPU/内存，找高占用进程
ps -ef --forest             # 看父子进程关系（反弹 shell 的父进程）

netstat -antlp              # 网络连接 + PID，找外联恶意 IP/矿池/C2
ss -antlp
# 重点：ESTABLISHED 到陌生公网 IP、高位端口、已知矿池端口

lsof -p <PID>               # 某进程打开的文件/连接
ls -l /proc/<PID>/exe       # 进程对应可执行文件真实路径（可能已删除）
```

> 挖矿高频手法：删了挖矿文件后进程还在、`netstat` 能看到矿池 IP 但 `lsof`/`LD_PRELOAD` 定位不到 PID（进程隐藏/文件已删）。此时用防火墙封禁矿池 IP 兜底。

## 4. 计划任务与启动项（权限维持重灾区）

```bash
crontab -l                  # 当前用户计划任务
cat /etc/crontab
ls -la /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ /etc/cron.weekly/ /etc/cron.monthly/
# 重点：/etc/cron.d 下的可疑文件（CentOS 对格式要求宽松，会把非标准文件也解析执行，如 cron.tar）
# 7 天内被修改的计划任务目录
find /etc/cron* -mtime -7 -type f 2>/dev/null

# 启动项
cat /etc/rc.local           # 开机启动脚本
ls -la /etc/init.d/
systemctl list-unit-files --type=service | grep enabled
systemctl list-timers       # systemd 定时器
# 7 天内被劫持的系统文件
find / -mtime -7 -type f 2>/dev/null | grep -vE '/proc|/sys|/dev' | head -50
```

## 5. 启动服务与可疑文件

```bash
chkconfig --list 2>/dev/null  # 或 systemctl list-units
find / -mtime -7 -type f 2>/dev/null   # 最近变动的文件（挖矿/webshell 常藏在 /tmp /var/tmp /dev/shm）
ls -la /tmp /var/tmp /dev/shm   # 临时目录常见恶意工具落地
find / -name "*.jsp" -o -name "*.php" -o -name "*.war" 2>/dev/null  # web 后门
# 隐藏文件（. 开头）
ls -la / | grep '^d.*\.'
```

## 6. 系统日志

```bash
# SSH 登录/爆破日志
cat /var/log/secure /var/log/auth.log 2>/dev/null | grep -E 'Failed password|Accepted'
# 统计爆破来源 IP
grep 'Failed password' /var/log/secure 2>/dev/null | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn
# 成功登录
grep 'Accepted' /var/log/secure 2>/dev/null

# 内核/系统日志
dmesg | tail -50
```

## 7. 提权风险（挖矿提权常见）

```bash
sudo -V                     # sudo 版本（如 1.8.23 覆盖 CVE-2021-3156）
uname -a                    # 内核版本，核对是否在提权漏洞覆盖范围
cat /etc/sudoers            # sudo 配置是否被篡改
```

## 8. 快速结论模板

每项排查后落一句结论，例如：
- 「`/etc/passwd` 无新增 uid=0 账号，无后门用户」
- 「`crontab -l` 无异常，`/etc/cron.d` 未发现恶意计划任务文件」
- 「`netstat` 未发现外联恶意 IP，`ps` 无高占用可疑进程」
- 「`auth.log` 中发现 `x.x.x.x` 于 `时间` 成功登录，此前有大量 Failed password（爆破）」
