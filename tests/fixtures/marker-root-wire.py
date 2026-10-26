"""Explicit source fixture: real retrieval/wire code with local-only transport."""
import importlib.util,io,json,sys,time,urllib.parse
from pathlib import Path
spec=importlib.util.spec_from_file_location('retrieval',Path(__file__).parents[2]/'scripts/event-marker-root-retrieval.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
input_path,seconds,originals,target=sys.argv[1:]
request=json.loads(Path(input_path).read_bytes());r.ROOT=Path(target)
class Response(io.BytesIO):
 def __init__(self,url):
  raw=(Path(originals)/urllib.parse.urlsplit(url).path.rsplit('/',1)[1]).read_bytes()
  super().__init__(raw);self.url=url;self.status=200;self.headers={'Content-Length':str(len(raw)),'Content-Encoding':'identity','x-amz-server-side-encryption':'AES256'}
 def geturl(self):return self.url
import base64
result=r.retrieve_group({**request['config'],'deadlineMonotonic':time.monotonic()+float(seconds)},request['expected'],request['records'],base64.b64decode(request['terminalBase64'],validate=True),request['terminalIdentity'],request['urls'],transport=lambda url,timeout:Response(url),free=lambda:512*r.MIB)
sys.stdout.buffer.write(r.wire(result)+b'\n');sys.stdout.buffer.flush()
