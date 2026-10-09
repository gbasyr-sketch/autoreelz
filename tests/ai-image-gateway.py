import base64
import copy
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('image_gateway', Path(__file__).parents[1] / 'services/ai-image-gateway/server.py')
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class ImageGatewayTest(unittest.TestCase):
    def setUp(self):
        self.request = dict(model=gateway.MODEL, prompt='Render approved product copy', size='1536x1024', quality='high', images=[base64.b64encode(b'RIFF0000WEBP').decode()])

    def test_fixed_image_endpoint_payload_is_translated_without_user_urls(self):
        body, boundary = gateway.multipart(self.request)
        self.assertIn(b'name="image[]"', body)
        self.assertIn(b'name="n"\r\n\r\n1', body)
        self.assertIn(b'name="output_format"\r\n\r\npng', body)
        self.assertTrue(body.endswith(('--' + boundary + '--\r\n').encode()))

    def test_other_models_sizes_qualities_and_parameters_are_rejected(self):
        for changes in [{'model': 'gpt-6-luna'}, {'size': 'auto'}, {'quality': 'max'}, {'url': 'https://example.com'}, {'images': []}, {'images': self.request['images'] * 7}, {'prompt': 'x' * 24001}]:
            data = copy.deepcopy(self.request)
            data.update(changes)
            with self.assertRaises(ValueError):
                gateway.multipart(data)

    def test_remote_urls_wrong_images_and_oversized_base64_are_rejected(self):
        for image in ['https://example.com/image.png', base64.b64encode(b'not-webp').decode(), 'a' * (3 * 1024 * 1024 + 1)]:
            with self.assertRaises(ValueError):
                gateway.multipart({**self.request, 'images': [image]})


if __name__ == '__main__':
    unittest.main()
