import importlib.util,pathlib,tempfile,unittest,io,hashlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('yandex',pathlib.Path(__file__).parents[1]/'scripts/backup/yandex_webdav.py');y=importlib.util.module_from_spec(spec);spec.loader.exec_module(y)
class Tests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.client=y.Client({'login':'test','password':'not-real'})
 def tearDown(self):self.temp.cleanup()
 def test_only_own_backup_paths(self):
  self.assertEqual(y.safe_path(y.PREFIX+'/autoreelz2026/config'),y.PREFIX+'/autoreelz2026/config')
  for value in ['/disk/other','http://evil.test/','/disk/AUTO-REELZ-backups/../secret',y.PREFIX+'/%2e%2e/private',y.PREFIX+'/file?target=evil',y.PREFIX+'-other/file']:
   with self.assertRaises(y.TransportError):y.safe_path(value)
 def test_redirects_require_yandex_https_and_no_embedded_credentials(self):
  for url in ['https://uploader28mfpbpp.disk.yandex.net/upload-token','https://downloader.disk.yandex.ru/token','https://s131nrg.storage.yandex.net/token']:self.assertEqual(y.safe_target(url),url)
  for url in ['http://downloader.disk.yandex.ru/token','https://evil.test/file','https://uploader.disk.yandex.net.evil.test/','https://user:pass@downloader.disk.yandex.ru/file','https://downloader.disk.yandex.ru:8080/file','https://downloader.disk.yandex.ru:bad/file']:
   with self.assertRaises(y.TransportError):y.safe_target(url)
 def test_put_is_preserved_and_credentials_are_not_forwarded(self):
  payload=self.root/'data';payload.write_bytes(b'ciphertext');empty=self.root/'empty';empty.touch();calls=[]
  def call(method,url,folder,**kwargs):
   calls.append((method,url,kwargs))
   return y.Reply(302,{'location':'https://uploader1.disk.yandex.net/secret'},empty) if len(calls)==1 else y.Reply(201,{},empty)
  with patch.object(self.client,'call',side_effect=call):r=self.client.follow('PUT',y.PREFIX+'/autoreelz2026/data/aa/'+'a'*64,self.root,payload=payload)
  self.assertEqual(r.status,201);self.assertEqual([x[0] for x in calls],['PUT','PUT']);self.assertTrue(calls[0][2]['authenticated']);self.assertFalse(calls[1][2]['authenticated']);self.assertEqual(calls[1][2]['payload'],payload)
 def test_success_requires_download_matching_the_payload(self):
  data=self.root/'data';data.write_bytes(b'ciphertext');wrong=self.root/'wrong';wrong.write_bytes(b'corruption');empty=self.root/'empty';empty.touch()
  with patch.object(self.client,'follow',side_effect=[y.Reply(201,{},empty),y.Reply(200,{},wrong)]):
   with self.assertRaisesRegex(y.TransportError,'not_verified'):self.client.request('PUT',y.PREFIX+'/file',self.root,data,{})
  with patch.object(self.client,'follow',side_effect=[y.TransportError('lost_response'),y.Reply(200,{},data)]) as follow:
   self.assertEqual(self.client.request('PUT',y.PREFIX+'/file',self.root,data,{}).status,201);self.assertEqual([x.args[0] for x in follow.call_args_list],['PUT','GET']);self.assertEqual(follow.call_args_list[0].kwargs['headers']['Sha256'],hashlib.sha256(data.read_bytes()).hexdigest())
 def test_signed_redirect_chains_are_bounded(self):
  p=self.root/'empty';p.touch()
  with patch.object(self.client,'call',return_value=y.Reply(302,{'location':'https://downloader.disk.yandex.ru/again'},p)) as call:
   with self.assertRaisesRegex(y.TransportError,'redirect_loop'):self.client.follow('GET',y.PREFIX+'/file',self.root)
   self.assertEqual(call.call_count,5)
 def test_eventual_visibility_retries_only_reads(self):
  data=self.root/'data';data.write_bytes(b'ciphertext');empty=self.root/'empty';empty.touch()
  with patch.object(self.client,'follow',side_effect=[y.Reply(201,{},empty),y.Reply(404,{},empty),y.Reply(404,{},empty),y.Reply(200,{},data)]) as follow,patch.object(y.time,'sleep'):
   self.assertEqual(self.client.request('PUT',y.PREFIX+'/file',self.root,data,{}).status,201);self.assertEqual([x.args[0] for x in follow.call_args_list],['PUT','GET','GET','GET'])
 def test_fixed_and_chunked_bodies_are_bounded_and_complete(self):
  p=self.root/'body';self.assertEqual(y.receive_body(io.BytesIO(b'abc'),{'Content-Length':'3'},p),3);self.assertEqual(p.read_bytes(),b'abc')
  self.assertEqual(y.receive_body(io.BytesIO(b'3\r\nabc\r\n0\r\n\r\n'),{'Transfer-Encoding':'chunked'},p),3)
  for body,headers in [(b'a',{'Content-Length':'3'}),(b'',{'Content-Length':str(y.MAX_BYTES+1)}),(b'',{'Content-Length':'1','Transfer-Encoding':'chunked'}),(b'bad\r\nx',{'Transfer-Encoding':'chunked'})]:
   with self.assertRaises(y.TransportError):y.receive_body(io.BytesIO(body),headers,p)
 def test_only_final_response_headers_are_used(self):self.assertEqual(y.response_headers('HTTP/1.1 100 Continue\r\nX-Temp: no\r\n\r\nHTTP/1.1 201 Created\r\nContent-Length: 0\r\n'),{'content-length':'0'})
if __name__=='__main__':unittest.main()
