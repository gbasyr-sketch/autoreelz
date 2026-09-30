"""Bounded internal U²-Net service. No database, cloud API or network downloads."""
import hashlib
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 24_000_000
MODEL = Path(os.environ.get('BACKGROUND_MODEL', '/models/u2net.onnx'))
MODEL_SHA = '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491'
slots = threading.BoundedSemaphore(3)  # one running request and at most two waiting
inference = threading.Lock()
session = None


def load_model():
    global session
    if hashlib.sha256(MODEL.read_bytes()).hexdigest() != MODEL_SHA:
        raise RuntimeError('Model checksum mismatch')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 3
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    session = ort.InferenceSession(str(MODEL), sess_options=options, providers=['CPUExecutionProvider'])


def remove_background(raw):
    with Image.open(io.BytesIO(raw)) as image:
        if image.format not in ('PNG', 'JPEG', 'WEBP') or getattr(image, 'n_frames', 1) != 1:
            raise ValueError('Unsupported image')
        if image.width * image.height > 24_000_000:
            raise ValueError('Too many pixels')
        original = ImageOps.exif_transpose(image).convert('RGBA')
    original.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    # Existing transparency is preserved; users can restore/erase the mask in the UI.
    if original.getchannel('A').getextrema()[0] == 255:
        pixels = np.asarray(original.convert('RGB').resize((320, 320), Image.Resampling.LANCZOS), dtype=np.float32)
        pixels /= max(float(pixels.max()), 1e-6)
        pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
        tensor = np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])
        predicted = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
        low, high = float(predicted.min()), float(predicted.max())
        if not np.isfinite(predicted).all() or high-low < 1e-8:
            raise ValueError('Invalid mask')
        mask = Image.fromarray(np.clip((predicted-low)/(high-low)*255, 0, 255).astype(np.uint8))
        original.putalpha(mask.resize(original.size, Image.Resampling.LANCZOS))
    output = io.BytesIO()
    original.save(output, format='PNG')
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, *_):
        pass  # Do not log images or request bodies.

    def reply(self, code, data, mime='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, b'{"ok":true}' if self.path == '/health' else b'{}')

    def do_POST(self):
        if self.path != '/remove':
            return self.reply(404, b'{}')
        if not slots.acquire(blocking=False):
            return self.reply(429, b'{"error":"busy"}')
        acquired = False
        try:
            if self.headers.get('Transfer-Encoding'):
                return self.reply(400, b'{}')
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > MAX_BYTES:
                return self.reply(413, b'{}')
            raw = self.rfile.read(size)
            if len(raw) != size:
                return self.reply(400, b'{}')
            acquired = inference.acquire(timeout=20)
            if not acquired:
                return self.reply(429, b'{"error":"busy"}')
            self.reply(200, remove_background(raw), 'image/png')
        except (ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            self.reply(422, b'{"error":"invalid_image"}')
        except (BrokenPipeError, ConnectionError, TimeoutError):
            pass
        except Exception:
            self.reply(503, b'{"error":"processing_failed"}')
        finally:
            if acquired:
                inference.release()
            slots.release()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 4


if __name__ == '__main__':
    load_model()
    Server(('0.0.0.0', int(os.environ.get('PORT', '8090'))), Handler).serve_forever()
