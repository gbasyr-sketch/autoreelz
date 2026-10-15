#!/usr/bin/env bash
# Synthetic Nginx -> rootless Caddy -> actual Astro adapter. No store database/env.
set -euo pipefail
[[ "${AR_RUN_PROXY_QA:-}" == 1 ]] || { echo 'Set AR_RUN_PROXY_QA=1 on the deployment host for isolated loopback QA'; exit 1; }
qa_root=$(mktemp -d /tmp/autoreelz-proxy-qa.XXXXXX)
qa_name="autoreelz-proxy-qa-$$"
qa_image="${AR_PROXY_QA_IMAGE:?Verified application image required}"
ardocker() { runuser -u autoreelz2026 -- env XDG_RUNTIME_DIR=/run/user/1018 DOCKER_HOST=unix:///run/user/1018/docker.sock PATH=/srv/autoreelz2026/bin:/usr/local/bin:/usr/bin:/bin docker "$@"; }
cleanup() {
 if [[ -f "$qa_root/nginx.pid" ]]; then nginx -p "$qa_root/" -c "$qa_root/nginx.conf" -s quit 2>/dev/null || true; fi
 ardocker rm -f "$qa_name-edge" "$qa_name-app" >/dev/null 2>&1 || true
 ardocker network rm "$qa_name" >/dev/null 2>&1 || true
 rm -rf "$qa_root"
}
trap cleanup EXIT
if ss -ltn | grep -Eq ':(14389|14390)\b'; then echo 'QA port occupied'; exit 1; fi
chmod 755 "$qa_root"
cp infra/release/Caddyfile.ispmanager "$qa_root/Caddyfile"
python3 - "$qa_root" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=Path('infra/release/nginx-ispmanager.conf').read_text()
start=s.index('server {',s.index('server {')+1)
s=s[start:]
s=s.replace('listen 91.200.150.79:443 ssl http2;','listen 127.0.0.1:14390;')
s='\n'.join(l for l in s.splitlines() if not l.strip().startswith(('ssl_certificate','ssl_protocols')))
s=s.replace('set_real_ip_from 186.2.160.0/24;','set_real_ip_from 127.0.0.2/32;').replace('127.0.0.1:14324','127.0.0.1:14389')
s=s.replace('$autoreelz2026_connection','close')
p.joinpath('nginx.conf').write_text(f'pid {p}/nginx.pid;\nerror_log {p}/error.log;\nevents {{}}\nhttp {{ access_log off;\n'+s+'\n}\n')
PY
cat > "$qa_root/echo.mjs" <<'JS'
import {createServer} from 'node:http';
import {createRequest} from '/app/node_modules/astro/dist/core/app/node.js';
createServer((req,res)=>{
 const r=createRequest(req,{allowedDomains:[{hostname:'autoreelz.ru',protocol:'https'}]});
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify({ip:Reflect.get(r,Symbol.for('astro.clientAddress')),xff:req.headers['x-forwarded-for'],host:req.headers.host}));
}).listen(4321,'0.0.0.0');
JS
chmod 644 "$qa_root"/*
ardocker network create "$qa_name" >/dev/null
ardocker run -d --name "$qa_name-app" --network "$qa_name" --network-alias web --network-alias cms --read-only --health-cmd='exit 0' -v "$qa_root/echo.mjs:/tmp/echo.mjs:ro" "$qa_image" node /tmp/echo.mjs >/dev/null
ardocker run -d --name "$qa_name-edge" --network "$qa_name" -p 127.0.0.1:14389:8080 -v "$qa_root/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b >/dev/null
nginx -p "$qa_root/" -c "$qa_root/nginx.conf" -t
nginx -p "$qa_root/" -c "$qa_root/nginx.conf"
python3 - <<'PY'
import http.client,json,time
checks=[]
def req(source,real,xff,path='/health'):
 c=http.client.HTTPConnection('127.0.0.1',14390,timeout=5,source_address=(source,0))
 c.request('GET',path,headers={'Host':'autoreelz.ru','X-Real-IP':real,'X-Forwarded-For':xff})
 r=c.getresponse();b=r.read();c.close();assert r.status==200,(r.status,b);return json.loads(b)
for n in range(30):
 try: req('127.0.0.1','203.0.113.9','203.0.113.10');break
 except Exception:
  if n==29:raise
  time.sleep(.2)
a=req('127.0.0.2','203.0.113.77','203.0.113.77, 192.0.2.10');b=req('127.0.0.2','203.0.113.77','203.0.113.77, 198.51.100.20')
assert a['ip']==a['xff']=='192.0.2.10';assert b['ip']==b['xff']=='198.51.100.20';checks.append('trusted proxy yields two distinct visitors; forged XFF removed')
direct=req('127.0.0.1','203.0.113.9','203.0.113.10');assert direct['ip']==direct['xff']=='127.0.0.1';checks.append('direct untrusted client cannot spoof X-Real-IP or XFF')
v6=req('127.0.0.2','203.0.113.77','203.0.113.77, 2001:db8::10');assert v6['ip']=='2001:db8::10';checks.append('IPv6 visitor preserved as one address')
invalid=req('127.0.0.2','203.0.113.77','203.0.113.77, not-an-ip');assert invalid['ip']=='127.0.0.2';checks.append('invalid last forwarded IP falls back to TCP peer')
webhook=req('127.0.0.2','203.0.113.77','203.0.113.77, 192.0.2.10','/api/payments/yookassa');assert webhook['ip']=='192.0.2.10';checks.append('exact webhook proxy uses the same normalized IP; synthetic echo only')
print(json.dumps({'passed':True,'synthetic':True,'productionDatabaseAccess':False,'paymentCalls':0,'checks':checks}))
PY
