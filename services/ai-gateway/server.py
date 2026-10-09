"""Private, bounded Responses relay. No keys, prompts or responses are logged/stored."""
import hmac
import http.server
import json
import os
import ssl
import threading
import urllib.error
import urllib.request

MAX_BODY = 65536
MAX_REPLY = 131072
UPSTREAM = 'https://api.openai.com/v1/responses'
MODEL = 'gpt-6-luna'


def valid_payload(value):
    return (isinstance(value, dict)
            and set(value) == {'model', 'instructions', 'input', 'reasoning', 'text', 'max_output_tokens', 'store', 'service_tier'}
            and value['model'] == MODEL and value['store'] is False and value['service_tier'] == 'default'
            and type(value['max_output_tokens']) is int and 1 <= value['max_output_tokens'] <= 1800
            and value['reasoning'] == {'effort': 'none'}
            and value['text'] == {'format': {'type': 'json_object'}}
            and isinstance(value['instructions'], str) and isinstance(value['input'], str))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def forward(body, authorization):
    request = urllib.request.Request(UPSTREAM, data=body, method='POST', headers={
        'Authorization': authorization, 'Content-Type': 'application/json',
        'User-Agent': 'AUTO-REELZ-description-gateway/1.0'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(request, timeout=28)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read(MAX_REPLY + 1)
        if len(payload) > MAX_REPLY:
            raise ValueError('Oversized response')
        return response.status, payload


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'AUTO-REELZ'
    sys_version = ''

    def log_message(self, *args):
        pass

    def reply(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def authenticated(self):
        values = self.headers.get_all('X-AutoReelz-Gateway', [])
        return len(values) == 1 and hmac.compare_digest(values[0], self.server.token)

    def do_GET(self):
        if not self.authenticated():
            return self.reply(401, b'{"error":{"code":"gateway_access"}}')
        self.reply(200 if self.path == '/health' else 404, b'{"ok":true}' if self.path == '/health' else b'{}')

    def do_POST(self):
        if not self.authenticated():
            return self.reply(401, b'{"error":{"code":"gateway_access"}}')
        if self.path != '/v1/responses':
            return self.reply(404, b'{}')
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not lengths[0].isdigit() or self.headers.get('Transfer-Encoding'):
            return self.reply(400, b'{}')
        length = int(lengths[0])
        if not 1 <= length <= MAX_BODY:
            return self.reply(413, b'{}')
        authorizations = self.headers.get_all('Authorization', [])
        if len(authorizations) != 1 or not authorizations[0].startswith('Bearer sk-') or len(authorizations[0]) > 1024:
            return self.reply(401, b'{}')
        if self.headers.get('Content-Type') != 'application/json':
            return self.reply(415, b'{}')
        try:
            body = self.rfile.read(length)
            if len(body) != length or not valid_payload(json.loads(body)):
                return self.reply(400, b'{}')
        except (ValueError, UnicodeError, TimeoutError):
            return self.reply(400, b'{}')
        try:
            status, reply = forward(body, authorizations[0])
        except Exception:
            # A connection failure may follow an accepted/billable upstream request.
            return self.reply(502, b'{"error":{"code":"gateway_uncertain"}}')
        return self.reply(status, reply)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, context, token, allowed):
        self.context, self.token, self.allowed = context, token, set(allowed)
        self.slots = threading.BoundedSemaphore(2)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if address[0] not in self.allowed or not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            request.settimeout(5)
            request = self.context.wrap_socket(request, server_side=True)
            request.settimeout(32)
            super().process_request_thread(request, address)
        except Exception:
            self.shutdown_request(request)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        pass


if __name__ == '__main__':
    token = os.environ['GATEWAY_TOKEN']
    if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
        raise RuntimeError('Invalid gateway configuration')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain('/etc/autoreelz-ai-gateway/server.crt', '/etc/autoreelz-ai-gateway/server.key')
    Server(('0.0.0.0', 14446), context, token, ['91.200.150.79', '127.0.0.1']).serve_forever()
