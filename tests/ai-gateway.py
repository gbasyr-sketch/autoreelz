import copy
import http.client
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).parents[1] / 'services/ai-gateway/server.py')
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class PlainTestContext:
    def wrap_socket(self, socket, **kwargs):
        return socket


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.server = gateway.Server(('127.0.0.1', 0), PlainTestContext(), 'a' * 64, ['127.0.0.1'])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.data = dict(model='gpt-6-luna', instructions='Only facts', input='{}', reasoning={'effort': 'none'}, text={'format': {'type': 'json_object'}}, max_output_tokens=1800, store=False, service_tier='default')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path='/v1/responses', body=None, token='a' * 64, method='POST'):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        connection.request(method, path, json.dumps(self.data if body is None else body), {'Authorization': 'Bearer sk-qa-only', 'X-AutoReelz-Gateway': token, 'Content-Type': 'application/json'})
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_auth_and_path_block_before_upstream(self):
        with patch.object(gateway, 'forward') as call:
            self.assertEqual(self.request(token='wrong')[0], 401)
            self.assertEqual(self.request(path='/v1/chat/completions')[0], 404)
            self.assertEqual(self.request(path='/health', method='GET'), (200, b'{"ok":true}'))
            call.assert_not_called()

    def test_fixed_model_format_budget_and_no_tools(self):
        invalid = [{'model': 'other'}, {'service_tier': 'priority'}, {'store': True}, {'max_output_tokens': 1801}, {'max_output_tokens': True}, {'tools': []}, {'reasoning': {'effort': 'high'}}, {'input': []}, {'text': {'format': {'type': 'text'}}}]
        with patch.object(gateway, 'forward') as call:
            for change in invalid:
                value = copy.deepcopy(self.data)
                value.update(change)
                self.assertEqual(self.request(body=value)[0], 400)
            self.assertEqual(self.request(body={'input': 'x' * 65536})[0], 413)
            call.assert_not_called()

    def test_single_forward_preserves_response_and_errors(self):
        for status in [200, 401, 403, 429, 500]:
            with patch.object(gateway, 'forward', return_value=(status, b'{"usage":{}}')) as call:
                self.assertEqual(self.request(), (status, b'{"usage":{}}'))
                call.assert_called_once()
                self.assertEqual(json.loads(call.call_args.args[0]), self.data)
                self.assertEqual(call.call_args.args[1], 'Bearer sk-qa-only')

    def test_network_uncertainty_is_not_retried_or_reported_free(self):
        with patch.object(gateway, 'forward', side_effect=TimeoutError('private key details')) as call:
            status, body = self.request()
            self.assertEqual(status, 502)
            self.assertNotIn(b'private', body)
            self.assertIn(b'gateway_uncertain', body)
            call.assert_called_once()

    def test_redirects_are_never_followed(self):
        self.assertIsNone(gateway.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://untrusted.invalid'))


if __name__ == '__main__':
    unittest.main()
