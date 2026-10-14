#!/usr/bin/env python3
"""Private Unix-socket WebDAV bridge for AUTO REELZ's encrypted backup repository.

Yandex's desktop-client route returns a signed upload URL before receiving a PUT.
Keep PUT/body on that hop, strip credentials, and verify stored bytes before success.
No public listener, arbitrary upstream URL, generic proxy or account-wide path exists.
"""
import base64, ctypes, hashlib, http.server, json, os, pathlib, re, secrets, signal, socketserver, subprocess, tempfile, threading, time, urllib.parse

ROOT = pathlib.Path('/var/lib/autoreelz2026-backup')
SOCKET = ROOT/'private/yandex-webdav.sock'
CREDENTIALS = ROOT/'private/yandex-webdav.json'
PREFIX = '/disk/AUTO-REELZ-backups'
ORIGIN = 'https://webdav.yandex.ru'
MAX_BYTES = 64*1024*1024
STANDARD_PROPS = b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>'
# Same desktop-client compatibility profile as pinned rclone v1.75.2's Yandex backend.
USER_AGENT = 'Yandex.Disk '+json.dumps({'os':'windows','dtype':'ydisk3','vsn':'3.2.37.4977','id':'6BD01244C7A94456BBCEE7EEC990AEAD','id2':'0F370CD40C594A4783BC839C846B999C','session_id':secrets.token_urlsafe(96)},separators=(',',':'))

class TransportError(Exception):pass

def safe_path(value):
    parsed=urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:raise TransportError('invalid_path')
    path=parsed.path
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+',path) or any(x in ['.','..'] for x in path.split('/')) or '//' in path:raise TransportError('invalid_path')
    if path.rstrip('/')!=PREFIX and not path.startswith(PREFIX+'/'):raise TransportError('outside_backup_folder')
    return path

def safe_target(url):
    try:
        parsed=urllib.parse.urlsplit(url)
        port=parsed.port
    except ValueError as error:raise TransportError('unsafe_redirect') from error
    host=parsed.hostname or ''
    allowed=host=='downloader.disk.yandex.ru' or re.fullmatch(r'(?:uploader|downloader)[a-z0-9]*\.disk\.yandex\.net',host) or re.fullmatch(r's[a-z0-9]+\.storage\.yandex\.net',host)
    if parsed.scheme!='https' or not allowed or parsed.username or parsed.password or port not in [None,443]:raise TransportError('unsafe_redirect')
    return url

def response_headers(raw):
    result={}
    for line in raw.splitlines():
        if line.startswith('HTTP/'):result={}
        elif ':' in line:
            name,value=line.split(':',1);result[name.strip().lower()]=value.strip()
    return result

class Reply:
    def __init__(self,status,headers,body):self.status=status;self.headers=headers;self.body=body

class Client:
    def __init__(self,credentials):
        login,password=credentials['login'],credentials['password']
        if not isinstance(login,str) or not isinstance(password,str) or not login or not password or any(c in login+password for c in '\r\n'):raise TransportError('invalid_credentials')
        self.authorization='Basic '+base64.b64encode((login+':'+password).encode()).decode()
    def call(self,method,url,folder,*,payload=None,headers=None,authenticated=False):
        if authenticated:
            if not url.startswith(ORIGIN+'/'):raise TransportError('credential_destination')
            safe_path(url[len(ORIGIN):])
        else:safe_target(url)
        request_headers=dict(headers or {})
        if authenticated:request_headers['Authorization']=self.authorization
        elif any(k.lower()=='authorization' for k in request_headers):raise TransportError('credential_redirect')
        ident=secrets.token_hex(8);head=folder/(ident+'.headers');body=folder/(ident+'.body')
        # Config on stdin keeps credentials and signed URLs out of process arguments/logs.
        config='url = '+json.dumps(url)+'\n'
        for name,value in request_headers.items():
            if any(c in name+str(value) for c in '\r\n'):raise TransportError('invalid_header')
            config+='header = '+json.dumps(name+': '+str(value))+'\n'
        args=['/usr/bin/curl','--config','-','--silent','--show-error','--http1.1','--ipv4','--noproxy','*','--connect-timeout','10','--max-time','120','--max-filesize',str(MAX_BYTES),'--expect100-timeout','10','--request',method,'--user-agent',USER_AGENT if authenticated else 'AUTO-REELZ-backup/1','--dump-header',str(head),'--output',str(body),'--write-out','%{http_code}']
        if method=='HEAD':args+=['--head']
        if payload is not None:args+=['--upload-file' if method=='PUT' else '--data-binary',str(payload) if method=='PUT' else '@'+str(payload)]
        try:run=subprocess.run(args,input=config,capture_output=True,text=True,timeout=125)
        except subprocess.TimeoutExpired as error:raise TransportError('upstream_timeout') from error
        if run.returncode:
            print(json.dumps({'error':'upstream_connection','curlExit':run.returncode,'method':method,'host':urllib.parse.urlsplit(url).hostname,'status':run.stdout.strip() if run.stdout.strip().isdigit() else None}),flush=True)
            raise TransportError('upstream_connection')
        if not body.exists():body.touch(mode=0o600)
        if body.stat().st_size>MAX_BYTES:raise TransportError('upstream_too_large')
        try:status=int(run.stdout.strip())
        except ValueError as error:raise TransportError('invalid_upstream_response') from error
        return Reply(status,response_headers(head.read_text()),body)
    def follow(self,method,path,folder,*,payload=None,headers=None):
        url=ORIGIN+safe_path(path);authenticated=True
        for _ in range(5):
            result=self.call(method,url,folder,payload=payload,headers=headers,authenticated=authenticated)
            if result.status not in [301,302,303,307,308]:return result
            # Never change PUT to GET or forward Basic credentials to signed endpoints.
            if method not in ['GET','HEAD','PUT']:raise TransportError('unexpected_redirect')
            url=safe_target(urllib.parse.urljoin(url,result.headers.get('location','')));authenticated=False
        raise TransportError('redirect_loop')
    def request(self,method,path,folder,payload,headers):
        if payload is not None and not payload.stat().st_size and method not in ['PUT','PROPFIND']:payload=None
        if method=='PROPFIND' and (payload is None or payload.stat().st_size==0):
            payload=folder/'properties.xml';payload.write_bytes(STANDARD_PROPS)
        if method!='PUT':return self.follow(method,path,folder,payload=payload,headers=headers)
        data=payload.read_bytes();digest=hashlib.sha256(data).digest()
        put_headers={'Content-Type':'application/binary','Expect':'100-continue','Etag':hashlib.md5(data).hexdigest(),'Sha256':digest.hex()}
        try:written=self.follow('PUT',path,folder,payload=payload,headers=put_headers)
        except TransportError:written=None
        # Resolve a lost upload response without sending the body again. Do not accept
        # a 201 (or an uncertain result) until the logical file downloads identically.
        if written is None or 200<=written.status<300:
            for attempt in range(6):
                try:verified=self.follow('GET',path,folder)
                except TransportError:verified=None
                if verified is not None and verified.status==200:
                    if verified.body.stat().st_size==len(data) and hashlib.sha256(verified.body.read_bytes()).digest()==digest:
                        empty=folder/'accepted';empty.touch(mode=0o600);return Reply(201,{},empty)
                    if verified.body.stat().st_size:raise TransportError('uploaded_file_not_verified')
                # The upload node can commit before the logical path becomes visible.
                # Retry only reads; never send a second PUT after an unknown outcome.
                if attempt<5:time.sleep(min(2,attempt+.5))
            raise TransportError('uploaded_file_not_verified')
        return written

def receive_body(stream,headers,path):
    transfer=headers.get('Transfer-Encoding','').lower();length=headers.get('Content-Length');count=0
    if transfer and (transfer!='chunked' or length is not None):raise TransportError('invalid_framing')
    with path.open('wb') as out:
        if transfer:
            while True:
                line=stream.readline(128)
                if not re.fullmatch(rb'[0-9a-fA-F]+\r\n',line):raise TransportError('invalid_chunk')
                size=int(line.strip(),16)
                if not size:
                    if stream.readline(8192)!=b'\r\n':raise TransportError('unsupported_trailer')
                    break
                count+=size
                if count>MAX_BYTES:raise TransportError('body_too_large')
                remaining=size
                while remaining:
                    data=stream.read(min(remaining,65536))
                    if not data:raise TransportError('truncated_body')
                    out.write(data);remaining-=len(data)
                if stream.read(2)!=b'\r\n':raise TransportError('invalid_chunk')
        else:
            if length is not None and not re.fullmatch('[0-9]+',length):raise TransportError('invalid_length')
            count=int(length or 0)
            if count>MAX_BYTES:raise TransportError('body_too_large')
            remaining=count
            while remaining:
                data=stream.read(min(remaining,65536))
                if not data:raise TransportError('truncated_body')
                out.write(data);remaining-=len(data)
    return count

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def setup(self):
        super().setup();self.connection.settimeout(150)
    def handle_request(self):
        with self.server.capacity:
            try:
                path=safe_path(self.path)
                if self.command in ['PUT','DELETE']:
                    relative=path.removeprefix(PREFIX+'/autoreelz2026/')
                    if not re.fullmatch(r'(?:data/[a-f0-9]{2}|index|locks|snapshots)/[a-f0-9]{64}',relative):raise TransportError('protected_object')
                with tempfile.TemporaryDirectory(prefix='webdav-',dir=ROOT/'work') as name:
                    folder=pathlib.Path(name);payload=folder/'request';receive_body(self.rfile,self.headers,payload)
                    headers={key:self.headers[key] for key in ['Content-Type','Depth','Range'] if key in self.headers}
                    result=self.server.client.request(self.command,path,folder,payload,headers)
                    self.send_response(result.status);self.send_header('Connection','close')
                    for key in ['content-type','etag','last-modified','content-range','dav']:
                        if key in result.headers and '\r' not in result.headers[key] and '\n' not in result.headers[key]:self.send_header(key,result.headers[key])
                    length=result.headers.get('content-length','0') if self.command=='HEAD' else str(result.body.stat().st_size)
                    self.send_header('Content-Length',length if length.isdigit() else '0');self.end_headers()
                    if self.command!='HEAD':
                        with result.body.open('rb') as f:
                            for chunk in iter(lambda:f.read(65536),b''):self.wfile.write(chunk)
                    self.close_connection=True
            except (TransportError,TimeoutError,OSError) as error:
                # Only a fixed error code is logged; signed URLs and provider bodies stay private.
                code=str(error) if isinstance(error,TransportError) else 'transport_io'
                print(json.dumps({'error':code}),flush=True)
                try:self.send_error(502,'Backup transport unavailable')
                except OSError:pass
                self.close_connection=True
    do_GET=do_HEAD=do_PUT=do_DELETE=do_PROPFIND=do_MKCOL=do_PROPPATCH=handle_request

class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    def __init__(self,path,client):
        self.client=client;self.capacity=threading.BoundedSemaphore(2);super().__init__(path,Handler)

def main():
    os.umask(0o077)
    if os.geteuid()!=0:raise TransportError('root_required')
    parent=os.getppid()
    if ctypes.CDLL(None).prctl(1,signal.SIGTERM,0,0,0)!=0:raise TransportError('parent_signal_failed')
    if os.getppid()!=parent:raise TransportError('parent_exited')
    info=CREDENTIALS.lstat()
    if CREDENTIALS.is_symlink() or info.st_uid!=0 or info.st_mode&0o077:raise TransportError('unsafe_credentials')
    client=Client(json.loads(CREDENTIALS.read_text()))
    if SOCKET.exists():raise TransportError('socket_already_exists')
    with Server(str(SOCKET),client) as server:
        os.chmod(SOCKET,0o600);print(json.dumps({'ready':True}),flush=True)
        try:server.serve_forever(poll_interval=.1)
        finally:SOCKET.unlink(missing_ok=True)

if __name__=='__main__':main()
