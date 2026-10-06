# 部署清单：班前五分钟后端 → 云服务器

前置：SSH 可用 ✓ / nginx 已跑现有网站 ✓ / 域名已备案+HTTPS ✓
本方案**不动现有网站**：只是加一个 nginx server 块 + 一个 systemd 服务。

## 实际部署结果（2026-10-01 已完成）

| 项 | 值 |
|---|---|
| API 地址 | `https://api.maomaozhao.cn` |
| 服务器 | 阿里云 Ubuntu 24.04（公网 IP 见提交材料，不写入本仓库） |
| 部署路径 | `/root/banqian-server/`（`index.js`、`package.json`） |
| 进程管理 | `banqian.service`（systemd，开机自启+崩溃自动重启） |
| Node | v18.19.1（apt 源安装） |
| nginx | `/etc/nginx/sites-available/banqian-api` → `127.0.0.1:3000` |
| 证书 | `/etc/letsencrypt/live/api.maomaozhao.cn/`（certbot，至 2026-12-30，自动续期） |
| DNS | `api` A 记录 → 服务器公网 IP（见提交材料），**加在 DNSPod**（域名 NS 是 dnspod.net；加错平台记录不生效） |
| 现有网站 | `maomaozhao.cn` → `127.0.0.1:8000`，未改动，验证 200 |

常用命令：

```bash
systemctl status banqian          # 服务状态
journalctl -u banqian -f          # 实时日志
systemctl restart banqian         # 改完 index.js 后重启
curl https://api.maomaozhao.cn/   # 健康检查
```

### 环境变量（凭据只进 systemd，不进仓库，找袁博伦单独拿）

| 变量 | 用途 | 不配置时 |
|---|---|---|
| `WX_APPID` / `WX_SECRET` | 微信服务端 API（openid、小程序码） | dev_id 降级、文本码 |
| `ALI_AK_ID` / `ALI_AK_SECRET` / `NLS_APPKEY` | 阿里 NLS 语音 | 语音端点桩兜底 |
| `QWEATHER_KEY` | `/api/weather` 和风天气真源 | 桩兜底演示天气（`source:'stub'`），不断链 |
| `QWEATHER_HOST` | 和风新版控制台分配的专属 API Host（如 `xxxx.re.qweatherapi.com`）；**新 key 必须配**，经典老 key 用默认 `devapi.qweather.com` 无需配 | 默认 `devapi.qweather.com` |
| `LLM_KEY` | LLM 主通道 key（OpenAI 兼容协议；2026-10-06 已接入 DeepSeek，配在 `/etc/systemd/system/banqian.service.d/llm.conf`，权限 600） | 判分/答疑/剧本生成回落工程占位实现，不断链 |
| `LLM_BASE_URL` / `LLM_MODEL` | 主通道接口地址与模型名 | 默认 `https://api.deepseek.com` / `deepseek-chat` |
| `LLM_BASE_URL_2/LLM_KEY_2/LLM_MODEL_2`、`_3` | 二/三通道降级（三通道骨架预留） | 未配则单通道 |

> 部署脚本（`run_deploy.py` / `verify.py`）另需三个**本机**环境变量，服务端运行不需要：`DEPLOY_HOST`（服务器地址）、`DEPLOY_USER`（默认 `root`）、`SSHPASS`（SSH 口令）。仓库里不写死任何服务器地址。

改法：`sudo systemctl edit banqian` 加 `Environment=...`，或改 unit 文件后 `systemctl daemon-reload && systemctl restart banqian`。
验证：`curl -X POST https://api.maomaozhao.cn/api/weather -H 'Content-Type: application/json' -d '{"lat":36.65,"lng":117.12}'` —— 返回 `source:'qweather'` 即真源接通。

以下是最初的通用步骤，留档备查（占位于当时已填实）。

## 1. 本地：传代码上服务器（git bash / PowerShell）

```bash
scp -r "班前5分钟/server" YOUR_USER@SERVER_IP:~/banqian-server
```

（或等 Gitee 仓库通了以后 `git clone`，正式走仓库）

## 2. 服务器：装 Node + 跑起来

```bash
ssh YOUR_USER@SERVER_IP
sudo apt update && sudo apt install -y nodejs    # Ubuntu 24.04 源里是 v18+，够用

# 先前台跑一次验证
cd ~/banqian-server && node index.js
# 另一个终端: curl http://127.0.0.1:3000/  应返回 {"ok":true,...}
```

## 3. systemd 常驻

```bash
sudo cp ~/banqian-server/deploy/banqian.service /etc/systemd/system/
sudo systemctl enable --now banqian
sudo systemctl status banqian      # active (running) 即成功
curl http://127.0.0.1:3000/        # 健康检查；管理端接口需管理员 openid，未激活会返回 forbidden
```

## 4. DNS + 证书 + nginx

```bash
# a) DNS 控制台：加 A 记录  api → SERVER_IP  （域名在哪个平台买的就去哪个平台加）
# b) 放行：云服务器安全组确认 443/80 已开（网站能 HTTPS 说明已开）

# c) nginx 配置
sudo cp ~/banqian-server/deploy/nginx-banqian.conf /etc/nginx/sites-available/banqian-api
sudo ln -s /etc/nginx/sites-available/banqian-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# d) 证书：先看现有证书是不是泛域名 *.域名.com
sudo certbot certificates
#    是 → 改 nginx-banqian.conf 里两行证书路径指向现有证书，reload 即可
#    不是 → 给子域名单独签：
sudo certbot --nginx -d api.YOUR_DOMAIN.com
sudo systemctl reload nginx
```

## 5. 验证 HTTPS 通

```bash
curl https://api.YOUR_DOMAIN.com/    # 应返回 {"ok":true,...}
```

## 6. 小程序侧

- mp.weixin.qq.com → 开发管理 → 开发设置 → **服务器域名** → request 合法域名加 `https://api.YOUR_DOMAIN.com`
- `miniprogram/config.js`：`API_BASE` 改为 `https://api.YOUR_DOMAIN.com`，`USE_MOCK=false`

## 7. 排障速查

| 症状 | 查 |
|------|-----|
| curl 127.0.0.1:3000 不通 | `systemctl status banqian`、`journalctl -u banqian -f` |
| 443 通但 502 | nginx `error_log`；多半是后端没起来 |
| 真机 wx.request 报错 | 域名没进白名单 / 证书链不全（用 sslchecker.com 验） |
| 录音上传 413 | nginx `client_max_body_size` 没生效 |
