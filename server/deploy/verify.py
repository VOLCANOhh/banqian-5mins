# -*- coding: utf-8 -*-
# 部署 index.js 并冒烟测试绑定链路
import paramiko, os

# 服务器地址与账号一律从环境变量注入，仓库里不写死任何主机
HOST = os.environ['DEPLOY_HOST']
USER = os.environ.get('DEPLOY_USER', 'root')
PWD = os.environ['SSHPASS']
# server/ 目录（本脚本位于 server/deploy/ 下），不写死任何本机绝对路径
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PWD, timeout=10)
sftp = c.open_sftp()
sftp.put(LOCAL + r'\index.js', '/root/banqian-server/index.js')
sftp.close()
print('uploaded')

B = 'https://api.maomaozhao.cn'
cmds = [
    'systemctl restart banqian && sleep 1 && systemctl is-active banqian',
    # 未绑定设备 → need_bind
    "curl -s -X POST %s/api/me -H 'Content-Type: application/json' -d '{\"dev_id\":\"dev-newphone\"}' --max-time 10" % B,
    # 预置绑定 dev-w001 → worker
    "curl -s -X POST %s/api/me -H 'Content-Type: application/json' -d '{\"dev_id\":\"dev-w001\"}' --max-time 10 | head -c 160" % B,
    '',
    # 工人刷身份码
    "curl -s -X POST %s/api/bind/ticket -H 'Content-Type: application/json' -d '{\"dev_id\":\"dev-newphone\"}' --max-time 10" % B,
    '',
    # 管理员激活（dev-admin → admin）
    "curl -s -X POST %s/api/admin/activate -H 'Content-Type: application/json' -d '{\"dev_id\":\"dev-admin\",\"code\":\"2468\"}' --max-time 10" % B,
    # 管理端发码 w003
    "curl -s -X POST %s/api/bind/code -H 'Content-Type: application/json' -d '{\"dev_id\":\"dev-admin\",\"worker_id\":\"w003\"}' --max-time 10" % B,
]
for cmd in cmds:
    if not cmd:
        print()
        continue
    _, out, err = c.exec_command(cmd, timeout=60)
    print('=== ' + cmd[:75])
    print((out.read() + err.read()).decode('utf-8', 'replace').strip() or '(empty)')

# 取回 bind/code 的 qr_text 做 resolve 闭环 + claim 闭环测试
script = r'''
import json, subprocess
def post(path, d):
    out = subprocess.check_output(['curl','-s','-X','POST','https://api.maomaozhao.cn'+path,
        '-H','Content-Type: application/json','-d',json.dumps(d),'--max-time','10'])
    return json.loads(out)

# 机制2闭环：工人(dev-newphone2) 扫 w003 的码自绑
code = post('/api/bind/code', {'dev_id':'dev-admin','worker_id':'w003'})
print('code →', code['qr_text'])
r = post('/api/bind/resolve', {'dev_id':'dev-newphone2','code':code['qr_text']})
print('resolve →', r.get('worker',{}).get('name'), r.get('ok'))
# 机制1闭环：工人(dev-newphone3) 亮码 → 管理员认领成 w004
tk = post('/api/bind/ticket', {'dev_id':'dev-newphone3'})
print('ticket →', tk['qr_text'])
r = post('/api/bind/claim', {'dev_id':'dev-admin','ticket':tk['ticket'],'worker_id':'w004'})
print('claim →', r.get('worker',{}).get('name'), r.get('ok'))
# 认领后再查 me：newphone3 应已绑 w004
r = post('/api/me', {'dev_id':'dev-newphone3'})
print('me →', r.get('worker',{}).get('name'), 'need_bind=', r.get('need_bind'))
# 重发作废：regenerate 后旧码应失效
old = code['qr_text']
post('/api/bind/code', {'dev_id':'dev-admin','worker_id':'w003','regenerate':True})
r = post('/api/bind/resolve', {'dev_id':'dev-newphone9','code':old})
print('old code resolve →', r.get('error'))
# 非管理员调 bind/code 应 403
r = post('/api/bind/code', {'dev_id':'dev-w001','worker_id':'w003'})
print('worker bind/code →', r.get('error'))
'''
_, out, err = c.exec_command('python3 - <<\'PYEOF\'\n' + script + '\nPYEOF', timeout=90)
print('\n=== 闭环测试 ===')
print((out.read() + err.read()).decode('utf-8', 'replace'))
c.close()
print('DONE')
