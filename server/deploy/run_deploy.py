#!/usr/bin/env python3
"""班前五分钟后端一键部署：传代码→装Node→systemd→nginx server块(80先跑，certbot后补443)
只做增量：新建 /root/banqian-server、banqian.service、nginx banqian-api 块，不动现有站点。"""
import paramiko, os, sys

# 服务器地址与账号一律从环境变量注入，仓库里不写死任何主机
HOST = os.environ['DEPLOY_HOST']
USER = os.environ.get('DEPLOY_USER', 'root')
PW = os.environ['SSHPASS']
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # server/ 目录

NGINX_CONF = '''server {
    listen 80;
    listen [::]:80;
    server_name api.maomaozhao.cn;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
}
'''

SYSTEMD = '''[Unit]
Description=banqian-5min backend (orchestrator)
After=network.target

[Service]
ExecStart=/usr/bin/node /root/banqian-server/index.js
WorkingDirectory=/root/banqian-server
Restart=always
RestartSec=3
User=root
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
'''

def run(c, cmd, show=True):
    _, out, err = c.exec_command(cmd, timeout=300)
    o = (out.read() + err.read()).decode('utf-8', 'replace').strip()
    if show:
        print(f'=== {cmd}\n{o or "(empty)"}')
    return o

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=10)
print('SSH connected')

# 1. 传代码
sftp = c.open_sftp()
try: sftp.mkdir('/root/banqian-server')
except IOError: pass
for f in ['index.js', 'package.json']:
    sftp.put(os.path.join(LOCAL, f), f'/root/banqian-server/{f}')
    print('uploaded', f)
sftp.close()

# 2. Node
if 'NO' in run(c, 'node --version || echo NO_NODE'):
    run(c, 'apt-get update -qq')
    run(c, 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs', show=True)
    run(c, 'node --version')

# 3. systemd
run(c, f"cat > /etc/systemd/system/banqian.service <<'EOF'\n{SYSTEMD}EOF", show=False)
run(c, 'systemctl daemon-reload && systemctl enable --now banqian && sleep 1 && systemctl is-active banqian')
run(c, "curl -s http://127.0.0.1:3000/ && echo && curl -s -X POST http://127.0.0.1:3000/api/workers -H 'Content-Type: application/json' -d '{}'")

# 4. nginx server 块（先 80，certbot 稍后自动改成 443）
run(c, f"cat > /etc/nginx/sites-available/banqian-api <<'EOF'\n{NGINX_CONF}EOF", show=False)
run(c, 'ln -sf /etc/nginx/sites-available/banqian-api /etc/nginx/sites-enabled/banqian-api')
out = run(c, 'nginx -t 2>&1')
if 'successful' in out or 'ok' in out:
    run(c, 'systemctl reload nginx')
    print('nginx reloaded, api block live on :80')
else:
    print('!! nginx -t failed, NOT reloading', file=sys.stderr)
c.close()
print('DONE')
