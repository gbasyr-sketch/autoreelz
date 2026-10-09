"""Image-only companion gateway. Prepared locally; deploy separately from the text relay."""
import base64
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import threading
import urllib.request
import urllib.error

shared = Path(__file__).parent.parent / 'ai-gateway/server.py'
if not shared.exists():
    shared = Path('/opt/autoreelz-ai-gateway/server.py')
spec = importlib.util.spec_from_file_location('text_gateway_base', shared)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
MODEL = 'gpt-image-2.5-sunburst-2026-09-08'
MAX_REQUEST = 24 * 1024 * 1024
MAX_RESPONSE = 16 * 1024 * 1024


def multipart(value):
    if not isinstance(value, dict) or set(value) != {'model', 'prompt', 'size', 'quality', 'images'}:
        raise ValueError('Invalid image request')
    if value['model'] != MODEL or value['size'] != '1536x1024' or value['quality'] != 'high':
        raise ValueError('Unsupported image settings')
    if not isinstance(value['prompt'], str) or not 1 <= len(value['prompt'].encode()) <= 24000:
        raise ValueError('Invalid prompt size')
    if not isinstance(value['images'], list) or not 1 <= len(value['images']) <= 6:
        raise ValueError('Invalid image count')
    images = []
    for encoded in value['images']:
        if not isinstance(encoded, str) or len(encoded) > 3 * 1024 * 1024:
            raise ValueError('Invalid image size')
        image = base64.b64decode(encoded, validate=True)
        if not 12 <= len(image) <= 2 * 1024 * 1024 or image[:4] != b'RIFF' or image[8:12] != b'WEBP':
            raise ValueError('WebP input required')
        images.append(image)
    boundary = 'autoreelz-' + secrets.token_hex(24)
    body = bytearray()
    fields = dict(model=MODEL, prompt=value['prompt'], size='1536x1024', quality='high', n='1', output_format='png', background='opaque')
    for key, data in fields.items():
        body.extend((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{data}\r\n').encode())
    for index, image in enumerate(images):
        body.extend((f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-{index}.webp"\r\nContent-Type: image/webp\r\n\r\n').encode())
        body.extend(image)
        body.extend(b'\r\n')
    body.extend((f'--{boundary}--\r\n').encode())
    return bytes(body), boundary


class Handler(base.Handler):
    def authenticated(self):
        tokens = self.headers.get_all('X-AutoReelz-Image-Gateway', [])
        return len(tokens) == 1 and hmac.compare_digest(tokens[0], self.server.token)

    def do_POST(self):
        if not self.authenticated():
            return self.reply(401, b'{}')
        if self.path != '/v1/images/edits':
            return self.reply(404, b'{}')
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not lengths[0].isdigit() or self.headers.get('Transfer-Encoding'):
            return self.reply(400, b'{}')
        length = int(lengths[0])
        if not 1 <= length <= MAX_REQUEST:
            return self.reply(413, b'{}')
        authorizations = self.headers.get_all('Authorization', [])
        if len(authorizations) != 1 or not authorizations[0].startswith('Bearer sk-') or len(authorizations[0]) > 1024:
            return self.reply(401, b'{}')
        if self.headers.get('Content-Type') != 'application/json':
            return self.reply(415, b'{}')
        try:
            body, boundary = multipart(json.loads(self.rfile.read(length)))
        except Exception:
            return self.reply(422, b'{}')
        request = urllib.request.Request('https://api.openai.com/v1/images/edits', data=body, method='POST', headers={'Authorization': authorizations[0], 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'User-Agent': 'AUTO-REELZ-image-gateway/1.0'})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), base.NoRedirect())
        try:
            try:
                response = opener.open(request, timeout=165)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                result = response.read(MAX_RESPONSE + 1)
                if len(result) > MAX_RESPONSE:
                    raise ValueError('Large result')
                self.send_response(response.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(result)))
                self.send_header('Connection', 'close')
                request_id = response.headers.get('x-request-id', '')
                if re.fullmatch(r'[A-Za-z0-9_-]{1,200}', request_id):
                    self.send_header('X-Request-Id', request_id)
                self.end_headers()
                self.wfile.write(result)
                self.close_connection = True
        except Exception:
            return self.reply(502, b'{"error":{"code":"image_gateway_uncertain"}}')


if __name__ == '__main__':
    token = os.environ['IMAGE_GATEWAY_TOKEN']
    if not re.fullmatch('[a-f0-9]{64}', token):
        raise RuntimeError('Invalid configuration')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain('/etc/autoreelz-ai-gateway/server.crt', '/etc/autoreelz-ai-gateway/server.key')
    server = base.Server(('0.0.0.0', 14447), context, token, ['91.200.150.79', '127.0.0.1'])
    server.RequestHandlerClass = Handler
    server.slots = threading.BoundedSemaphore(1)
    server.serve_forever()
