"""Source-only retrieval fakes: no network, SDK, subprocess or media calls."""
import importlib.util,copy,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('retrieval',Path(__file__).parents[2]/'scripts/event-marker-root-retrieval.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Response(io.BytesIO):
 def __init__(self,url,raw):
  super().__init__(raw);self.url=url;self.status=200;self.headers={'Content-Length':str(len(raw)),'Content-Encoding':'identity','x-amz-server-side-encryption':'AES256'}
 def geturl(self):return self.url
class Retrieval(unittest.TestCase):
 def fixture(self):
  digest='sha256:'+'a'*64;task='arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/'+'1'*32;definition='arn:aws:ecs:us-east-1:079358094174:task-definition/SIMULATED:1'
  container={'name':'worker','image':'SIMULATED@'+digest,'cpu':8192,'memory':16384,'linuxParameters':{'initProcessEnabled':True}}
  shape={'cpu':'8192','memory':'16384','networkMode':'awsvpc','requiresCompatibilities':['FARGATE'],'runtimePlatform':{'cpuArchitecture':'X86_64','operatingSystemFamily':'LINUX'},'containerDefinitions':[container]}
  launch={'kind':'ecs-run-task','parameters':{'count':1,'taskDefinition':definition,'overrides':{'containerOverrides':[{'name':'worker','command':['node','scripts/event-marker-program-collector.mjs','--run-id','task6-simulated'],'environment':[{'name':'VRDEX_NATIVE_BINDING_CONTEXT_B64','value':'SIMULATED'}]}]}}}
  expected={'taskArn':task,'taskDefinitionArn':definition,'imageDigest':digest,'definition':shape,'launch':launch}
  row={'taskArn':task,'taskDefinitionArn':definition,'lastStatus':'STOPPED','overrides':launch['parameters']['overrides'],'createdAt':'2026-01-01T00:00:00Z','startedAt':'2026-01-01T00:00:01Z','stoppedAt':'2026-01-01T00:00:02Z','containers':[{'name':'worker','lastStatus':'STOPPED','exitCode':0,'imageDigest':digest}],'attachments':[{'type':'ElasticNetworkInterface','details':[{'name':'networkInterfaceId','value':'eni-12345678'}]}]}
  records={'task':{'request':{'cluster':'vrdex-restream-worker','tasks':[task]},'response':{'tasks':[row],'failures':[]}},'definition':{'request':{'taskDefinition':definition},'response':{'taskDefinition':{**shape,'taskDefinitionArn':definition,'status':'INACTIVE'}}},'eni':{'request':{'NetworkInterfaceIds':['eni-12345678']},'response':{'NetworkInterfaces':[]}}}
  body=b'SIMULATED PCM original';files=[{'name':'original.pcm',**r.identity(body)}];terminal={'schema':'single-program-terminal-v1','runId':'task6-simulated','groupId':'canary-000','invocationId':'mass-320-48000stereo-073','capacityAccepted':False,'pairedQualification':False,'binding':{'imageManifestSHA':'a'*64,'candidateSHA':'b'*64},'destination':'s3://'+r.BUCKET+'/synthetic-benchmarks/task6-simulated/qualification/canary-000/','artifacts':files};raw=r.wire(terminal)
  config={'downloadAuthorized':True,'runId':'task6-simulated','groupId':'canary-000','deadlineMonotonic':100,'candidateSHA':'b'*64};objects={'original.pcm':body,'terminal.json':raw};urls={n:'https://'+r.BUCKET+'.s3.us-east-1.amazonaws.com/synthetic-benchmarks/task6-simulated/qualification/canary-000/'+n for n in objects}
  return config,expected,records,raw,objects,urls
 def test_native_physical_cleanup_and_exact_new_overrides(self):
  c,e,records,*_=self.fixture();self.assertTrue(r.validate_native(e,records)['physicalClosed'])
  for mutate in [lambda x:x['task']['response']['tasks'][0].update(lastStatus='RUNNING'),lambda x:x['definition']['response']['taskDefinition'].update(status='ACTIVE'),lambda x:x['eni']['response'].update(NetworkInterfaces=[{}]),lambda x:x['task']['response']['tasks'][0].update(overrides={})]:
   bad=copy.deepcopy(records);mutate(bad)
   with self.assertRaises(ValueError):r.validate_native(e,bad)
 def test_full_originals_have_two_independent_reads_and_preserved_receipts(self):
  c,e,records,raw,objects,urls=self.fixture();calls=[]
  def transport(url,timeout):calls.append(url);return Response(url,objects[url.rsplit('/',1)[1]])
  with tempfile.TemporaryDirectory() as d,patch.object(r,'ROOT',Path(d)/'store'):
   result=r.retrieve_group(c,e,records,raw,r.identity(raw),urls,transport=transport,clock=lambda:0,free=lambda:512*r.MIB)
   self.assertEqual(len(calls),4);self.assertEqual(result['files'],result['independentRemoteFiles']);self.assertEqual(result['schema'],'single-program-root-retrieval-v1');self.assertTrue(result['native']['physicalClosed']);self.assertFalse(result['capacityAccepted']);self.assertEqual((r.ROOT/'task6-simulated/canary-000/original.pcm').read_bytes(),objects['original.pcm'])
 def test_second_pass_mismatch_preserves_first_original_and_negative(self):
  c,e,records,raw,objects,urls=self.fixture();calls={}
  def transport(url,timeout):calls[url]=calls.get(url,0)+1;return Response(url,objects[url.rsplit('/',1)[1]] if calls[url]==1 else b'changed')
  with tempfile.TemporaryDirectory() as d,patch.object(r,'ROOT',Path(d)/'store'):
   with self.assertRaises(ValueError):r.retrieve_group(c,e,records,raw,r.identity(raw),urls,transport=transport,clock=lambda:0,free=lambda:512*r.MIB)
   self.assertTrue((r.ROOT/'task6-simulated/canary-000/terminal.json').exists());self.assertTrue((r.ROOT/'task6-simulated/canary-000/retrieval-negative.json').exists())
 def test_scope_inventory_group_perfile_space_and_deadline_caps(self):
  c,e,records,raw,objects,urls=self.fixture();specs=[{'name':n,**r.identity(b),'url':urls[n]} for n,b in objects.items()]
  for mutate in [lambda x:x.update(groupId='mass-000'),lambda x:x.update(downloadAuthorized=False),lambda x:x.update(deadlineMonotonic=float('nan'))]:
   bad={**c};mutate(bad)
   with self.assertRaises(ValueError):r.validate_specs(bad,specs)
  for bad in [specs*130,[{**specs[0],'bytes':64*r.MIB+1}],[{**specs[0],'url':specs[0]['url'].replace(r.BUCKET,'other')}],[{**specs[0],'name':str(i)+'.pcm','bytes':64*r.MIB,'url':specs[0]['url'].rsplit('/',1)[0]+'/'+str(i)+'.pcm'} for i in range(3)]]:
   with self.assertRaises(ValueError):r.validate_specs(c,bad)
  for free,clock in [(lambda:511*r.MIB,lambda:0),(lambda:512*r.MIB,lambda:101)]:
   with tempfile.TemporaryDirectory() as d,patch.object(r,'ROOT',Path(d)/'store'):
    with self.assertRaises(ValueError):r.retrieve_group(c,e,records,raw,r.identity(raw),urls,transport=lambda *_:self.fail('transport started'),clock=clock,free=free)
  with tempfile.TemporaryDirectory() as d,patch.object(r,'ROOT',Path(d)/'store'),patch.object(r,'tree_bytes',return_value=r.HIGH_WATER):
   with self.assertRaisesRegex(ValueError,'high_water'):r.retrieve_group(c,e,records,raw,r.identity(raw),urls,transport=lambda *_:self.fail('transport started'),clock=lambda:0,free=lambda:512*r.MIB)
if __name__=='__main__':unittest.main()
