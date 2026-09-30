import importlib.util, io, unittest, threading, urllib.request, urllib.error, concurrent.futures, time
from pathlib import Path
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('bgworker',Path(__file__).resolve().parents[1]/'services/background-removal/worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class Model:
 def get_inputs(self):return [type('Input',(),{'name':'input'})()]
 def run(self,*args):
  mask=np.zeros((1,1,320,320),dtype=np.float32);mask[:,:,40:280,40:280]=1
  return [mask]
def png(image):
 b=io.BytesIO();image.save(b,format='PNG');return b.getvalue()
class TestWorker(unittest.TestCase):
 def setUp(self):w.session=Model()
 def test_rgb_preserved_and_real_alpha(self):
  source=Image.new('RGB',(100,100),(50,90,200));out=Image.open(io.BytesIO(w.remove_background(png(source))))
  self.assertEqual(out.convert('RGB').tobytes(),source.tobytes());self.assertEqual(out.getchannel('A').getextrema(),(0,255))
 def test_existing_alpha_is_not_segmented_again(self):
  source=Image.new('RGBA',(60,60),(3,2,1,170));out=Image.open(io.BytesIO(w.remove_background(png(source))))
  self.assertEqual(source.tobytes(),out.tobytes())
 def test_bad_input_and_queue_bound(self):
  with self.assertRaises(Exception):w.remove_background(b'not an image')
  server=w.Server(('127.0.0.1',0),w.Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  def request():
   try:
    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{server.server_port}/remove',data=b'x'),timeout=4) as r:return r.status
   except urllib.error.HTTPError as e:return e.code
  actual=w.remove_background
  try:
   w.remove_background=lambda raw:(time.sleep(.25) or b'PNG')
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:request(),range(4)))
   self.assertEqual(sorted(results),[200,200,200,429])
  finally:w.remove_background=actual;server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
