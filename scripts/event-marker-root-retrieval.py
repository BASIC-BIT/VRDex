"""Checked-in Root single-PROGRAM original retrieval. Import performs no operation.
Root explicitly supplies an absolute retrieval deadline and authorized inputs.
Only retrieve() opens HTTPS, and only after downloadAuthorized is exactly True.
No AWS control-plane, shell, process, service or billing operation is present.
"""
import datetime as dt
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import ssl
import signal
import stat
import time
import urllib.parse
import urllib.request

ROOT=Path('/workspace/VRDex-stream-operator-sdd/codec-retrieval')
MIB=1048576
PAYLOAD=134152192
TERMINAL=65536
HIGH_WATER=384*MIB
BUCKET='vrdex-restream-worker-079358094174-artifacts'
def require(ok,code):
 if not ok:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def wire(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def identity(raw):return {'bytes':len(raw),'sha256':sha(raw)}
@contextmanager
def absolute_deadline(deadline,clock=time.monotonic):
 """Native root caller must dedicate its main thread and unused SIGALRM.
 One absolute alarm covers TLS/header slow-drip, reads, hashing and receipts.
 Existing deadline owners are rejected, never cancelled or extended.
 """
 require(signal.getitimer(signal.ITIMER_REAL)==(0.,0.) and signal.getsignal(signal.SIGALRM)==signal.SIG_DFL,'retrieval_deadline_owner')
 remaining=deadline-clock();require(remaining>0,'retrieval_deadline')
 def expired(*_):raise ValueError('retrieval_absolute_deadline')
 signal.signal(signal.SIGALRM,expired)
 try:
  signal.setitimer(signal.ITIMER_REAL,remaining);yield
 finally:
  signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,signal.SIG_DFL)
def projection(actual,wanted):
 if isinstance(wanted,dict):return isinstance(actual,dict) and all((k not in actual and v==[]) or k in actual and projection(actual[k],v) for k,v in wanted.items())
 if isinstance(wanted,list):return isinstance(actual,list) and len(actual)==len(wanted) and all(projection(x,y) for x,y in zip(actual,wanted))
 return type(actual) is type(wanted) and actual==wanted
def utc(value):
 require(isinstance(value,str),'native_time')
 result=dt.datetime.fromisoformat(value.replace('Z','+00:00'));require(result.tzinfo is not None,'native_time');return result.timestamp()

def validate_native(expected,records):
 """Validate saved actual request/response bodies, never caller outcome flags."""
 try:
  task=expected['taskArn'];definition=expected['taskDefinitionArn'];image=expected['imageDigest']
  require(re.fullmatch(r'arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/[a-f0-9]{32}',task),'native_task_identity')
  require(re.fullmatch(r'arn:aws:ecs:us-east-1:079358094174:task-definition/[a-zA-Z0-9_-]+:[1-9][0-9]*',definition),'native_definition_identity')
  t=records['task'];d=records['definition'];e=records['eni']
  require(t['request']=={'cluster':'vrdex-restream-worker','tasks':[task]} and t['response'].get('failures')==[] and len(t['response']['tasks'])==1,'native_task_query')
  row=t['response']['tasks'][0]
  require(row['taskArn']==task and row['taskDefinitionArn']==definition and row['lastStatus']=='STOPPED' and len(row['containers'])==1,'native_stopped')
  overrides=row.get('overrides',{})
  require(overrides==expected['launch']['parameters']['overrides'],'native_override')
  require(expected['launch']['kind']=='ecs-run-task' and expected['launch']['parameters']['taskDefinition']==definition and expected['launch']['parameters']['count']==1,'native_launch')
  c=row['containers'][0]
  require(c['name']=='worker' and c['lastStatus']=='STOPPED' and type(c['exitCode']) is int and 0<=c['exitCode']<=255 and c['imageDigest']==image,'native_exit')
  created,started,stopped=(utc(row[k]) for k in ['createdAt','startedAt','stoppedAt'])
  require(0<=started-created and 0<=stopped-started,'native_time_order')
  within_deadlines=started-created<=120 and stopped-started<=660
  require(d['request']=={'taskDefinition':definition},'native_definition_query');actual=d['response']['taskDefinition']
  require(actual['taskDefinitionArn']==definition and actual['status']=='INACTIVE','native_definition_inactive')
  spec=expected['definition'];require(projection(actual,{k:v for k,v in spec.items() if k!='tags'}),'native_definition_drift')
  require(actual['cpu']=='8192' and actual['memory']=='16384' and actual['networkMode']=='awsvpc' and actual['requiresCompatibilities']==['FARGATE'] and actual['runtimePlatform']=={'cpuArchitecture':'X86_64','operatingSystemFamily':'LINUX'} and actual.get('volumes',[])==[],'native_shape')
  require(len(actual['containerDefinitions'])==1,'native_container');container=actual['containerDefinitions'][0]
  require(set(actual)<=set(spec)|{'taskDefinitionArn','status','revision','registeredAt','registeredBy','deregisteredAt','requiresAttributes','compatibilities','placementConstraints'} and actual.get('placementConstraints',[])==[],'native_definition_extra')
  require(set(container)<=set(spec['containerDefinitions'][0])|{'portMappings','systemControls','volumesFrom','environmentFiles','privileged','readonlyRootFilesystem'} and not container.get('readonlyRootFilesystem',False),'native_container_extra')
  log=dict(container.get('logConfiguration',{}));require(log.pop('secretOptions',[])==[] and log==spec['containerDefinitions'][0].get('logConfiguration',{}),'native_log_binding')
  require(container['image'].endswith('@'+image) and container['cpu']==8192 and container['memory']==16384 and container['linuxParameters']=={'initProcessEnabled':True} and not container.get('privileged',False) and container.get('mountPoints',[])==[] and container.get('volumesFrom',[])==[] and container.get('secrets',[])==[],'native_isolation')
  require(container.get('entryPoint',[])==spec['containerDefinitions'][0].get('entryPoint',[]) and container.get('environment',[])==spec['containerDefinitions'][0].get('environment',[]) and container.get('environmentFiles',[])==[] and container.get('portMappings',[])==[] and container.get('systemControls',[])==[] and actual.get('pidMode') is None and actual.get('ipcMode') is None,'native_extra_binding')
  enis=[v['value'] for a in row['attachments'] if a['type']=='ElasticNetworkInterface' for v in a['details'] if v['name']=='networkInterfaceId']
  require(len(enis)==1 and re.fullmatch(r'eni-[a-f0-9]{8,17}',enis[0]),'native_eni_identity')
  require(e['request'] in [{'NetworkInterfaceIds':enis},{'Filters':[{'Name':'network-interface-id','Values':enis}]}] and e['response'].get('NetworkInterfaces')==[],'native_eni_query')
  return {'schema':'marker-root-native-v1','taskArn':task,'taskDefinitionArn':definition,'eni':enis[0],'imageDigest':image,'physicalClosed':True,'withinDeadlines':within_deadlines,'exitCode':c['exitCode'],'pendingSeconds':started-created,'runningSeconds':stopped-started,'recordsSha256':sha(wire(records)),'expectedSha256':sha(wire(expected)),'expected':expected,'records':records}
 except (KeyError,TypeError,IndexError):raise ValueError('native_records_required') from None

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('retrieval_redirect')
def native_transport(url,timeout):
 require('SSLKEYLOGFILE' not in os.environ,'retrieval_tls_keylog')
 # Python default trust and proxy policy, including managed CA configuration.
 opener=urllib.request.build_opener(urllib.request.ProxyHandler(),urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())
 return opener.open(urllib.request.Request(url,headers={'Accept-Encoding':'identity'}),timeout=timeout)
def regular(path):
 s=path.lstat();require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.getuid(),'retrieval_regular');return s
def stable_file(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def owned_dir(path,create=False):
 if create:
  try:path.mkdir(mode=0o700)
  except FileExistsError:pass
 s=path.lstat();require(stat.S_ISDIR(s.st_mode) and not path.is_symlink() and path.resolve()==path and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700,'retrieval_directory')
def tree_bytes(path,guard=lambda:None):
 total=0
 if not path.exists():return 0
 owned_dir(path)
 for base,dirs,files in os.walk(path,followlinks=False):
  guard()
  for name in dirs:guard();owned_dir(Path(base)/name)
  for name in files:guard();total+=regular(Path(base)/name).st_size;require(total<=HIGH_WATER,'retrieval_high_water')
 return total
def payload_groups(path,guard):
 compact={'.lock','terminal.json','retrieval.json','retrieval-negative.json','native.json','verified-group.json','deletion.json','deletion-intent.json','deletion-negative.json'}
 groups={}
 for base,_,files in os.walk(path,followlinks=False):
  guard()
  payload=sum(regular(Path(base)/name).st_size for name in files if name not in compact)
  if payload:require(payload<=128*MIB,'retrieval_payload_cap');groups[base]=payload
 return groups
def validate_specs(config,specs):
 require(config.get('downloadAuthorized') is True,'retrieval_disabled')
 run=config.get('runId','');group=config.get('groupId','')
 require(re.fullmatch(r'task6-[a-z0-9-]{1,96}',run) and group=='canary-000','retrieval_identity')
 require(isinstance(specs,list) and 1<=len(specs)<=257,'retrieval_inventory')
 total=0;seen=set();prefix=f'/synthetic-benchmarks/{run}/qualification/{group}/'
 for s in specs:
  name=s.get('name','');require(re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,159}',name) and name not in seen and name not in ['retrieval.json','retrieval-negative.json','deletion.json','deletion-intent.json','deletion-negative.json','verified-group.json','native.json'],'retrieval_name');seen.add(name)
  require(type(s.get('bytes')) is int and 0<s['bytes']<=(TERMINAL if name in ['terminal.json','receipt.json'] else 64*MIB) and re.fullmatch(r'[a-f0-9]{64}',s.get('sha256','')),'retrieval_bound')
  total+=s['bytes'];u=urllib.parse.urlsplit(s.get('url',''))
  require(u.scheme=='https' and u.hostname in [BUCKET+'.s3.amazonaws.com',BUCKET+'.s3.us-east-1.amazonaws.com'] and u.port in [None,443] and u.username is None and u.password is None and not u.fragment and u.path==prefix+name,'retrieval_url')
 require(total<=128*MIB and sum(s['bytes'] for s in specs if s['name']!='terminal.json')<=PAYLOAD,'retrieval_aggregate')
 require(type(config.get('deadlineMonotonic')) in (int,float) and math.isfinite(config['deadlineMonotonic']),'retrieval_deadline')
 return run,group,total
def sync_directory(path,guard=lambda:None):
 guard();before=path.lstat();require(stat.S_ISDIR(before.st_mode) and path.resolve()==path,'deletion_directory')
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  current=os.fstat(fd);require((current.st_dev,current.st_ino)==(before.st_dev,before.st_ino),'deletion_directory_changed')
  guard();os.fsync(fd);guard()
 finally:os.close(fd)
def sync_directory_chain(path,guard):
 # Commit each child directory before the parent entry naming it, through /.
 for directory in [path,*path.parents]:sync_directory(directory,guard)
def sync_file(path,guard):
 guard();before=regular(path);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  require(stable_file(os.fstat(fd))==stable_file(before),'deletion_changed');guard();os.fsync(fd);guard()
 finally:os.close(fd)
def exclusive_json(path,value,guard=lambda:None):
 guard()
 raw=wire(value)+b'\n';require(len(raw)<=196608,'retrieval_receipt_cap')
 guard()
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb',buffering=0) as h:guard();written=h.write(raw);guard();require(written==len(raw),'retrieval_short_write');h.flush();guard();os.fsync(h.fileno());guard()
 require(path.read_bytes()==raw,'retrieval_readback');guard();sync_directory(path.parent,guard);return identity(raw)
def stream(spec,config,transport,clock,free,sink=None):
 def guard():require(clock()<config['deadlineMonotonic'],'retrieval_deadline');require(free()>=128*MIB,'retrieval_free_during')
 guard();h=hashlib.sha256();count=0
 try:
  with transport(spec['url'],min(15,config['deadlineMonotonic']-clock())) as response:
   require(response.status==200 and response.geturl()==spec['url'] and response.headers.get('Content-Encoding','identity')=='identity','retrieval_response')
   require(response.headers.get('Content-Length')==str(spec['bytes']),'retrieval_length_header')
   require(response.headers.get('x-amz-server-side-encryption')=='AES256','retrieval_encryption')
   while True:
    guard();b=response.read(min(65536,spec['bytes']+1-count));guard()
    if not b:break
    count+=len(b);require(count<=spec['bytes'],'retrieval_integrity')
    if sink:
     guard();written=sink.write(b);guard();require(written==len(b),'retrieval_short_write')
    h.update(b);guard()
   guard()
 except ValueError:raise
 except Exception:raise ValueError('retrieval_transport') from None
 require(count==spec['bytes'] and h.hexdigest()==spec['sha256'],'retrieval_integrity')
 return {k:spec[k] for k in ('name','bytes','sha256')}
def retrieve(config,specs,**effects):
 validate_specs(config,specs)
 clock=effects.get('clock',time.monotonic)
 if effects.get('transport') is not None:result=_retrieve(config,specs,**effects)
 else:
  require(not effects,'retrieval_native_effects')
  with absolute_deadline(config['deadlineMonotonic'],clock=clock):result=_retrieve(config,specs,clock=clock)
 # Files are provisional until ROOT observes timely return, including cleanup.
 require(clock()<config['deadlineMonotonic'],'retrieval_deadline');return result
def _retrieve(config,specs,*,transport=None,clock=time.monotonic,free=None):
 """Explicit root call only. No retry; partial original bytes remain on failure.
 Caller supplies terminal + exact terminal.artifacts, after native STOPPED.
 Two streaming reads verify the retained remote original independently; only
 one full local copy is created. Other local trees count toward high-water.
 """
 run,group,total=validate_specs(config,specs)
 require(clock()<config['deadlineMonotonic'],'retrieval_deadline')
 free=free or (lambda:os.statvfs(ROOT.parent).f_bavail*os.statvfs(ROOT.parent).f_frsize)
 def guard():require(clock()<config['deadlineMonotonic'],'retrieval_deadline')
 free_before=free();require(free_before>=512*MIB,'retrieval_free_before')
 min_free=free_before
 original_free=free
 def monitored_free():
  nonlocal min_free
  value=original_free();min_free=min(min_free,value);return value
 free=monitored_free
 require(ROOT.parent.resolve()==ROOT.parent,'retrieval_parent')
 owned_dir(ROOT,True);lockfd=os.open(ROOT/'.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  regular(ROOT/'.lock');fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  require(tree_bytes(ROOT,guard)+total<=HIGH_WATER,'retrieval_high_water')
  require(len(payload_groups(ROOT,guard))<=1,'retrieval_two_copy')
  owned_dir(ROOT/run,True);directory=ROOT/run/group;directory.mkdir(mode=0o700);owned_dir(directory)
  files=[];remote=[]
  try:
   for spec in specs:
    require(tree_bytes(ROOT,guard)+spec['bytes']<=HIGH_WATER,'retrieval_high_water')
    fd=os.open(directory/spec['name'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb',buffering=0) as out:
     files.append(stream(spec,config,transport or native_transport,clock,free,out));guard();out.flush();guard();os.fsync(out.fileno());guard()
    remote.append(stream(spec,config,transport or native_transport,clock,free))
   require(clock()<config['deadlineMonotonic'] and free()>=128*MIB,'retrieval_deadline_or_space')
   receipt={'schema':'single-program-root-retrieval-v1','runId':run,'groupId':group,'files':files,'independentRemoteFiles':remote,'freeBeforeBytes':free_before,'minimumFreeDuringBytes':min_free,'localHighWaterBytes':tree_bytes(ROOT,guard),'absoluteDeadlineMonotonic':config['deadlineMonotonic'],'finishedMonotonic':clock(),'qualificationAccepted':False,'capacityAccepted':False}
   exclusive_json(directory/'retrieval.json',receipt,guard);require(tree_bytes(ROOT,guard)<=HIGH_WATER,'retrieval_high_water');require(clock()<config['deadlineMonotonic'] and free()>=128*MIB,'retrieval_finalization');return receipt
  except Exception:
   # No recovery budget: late or failed journaling must preserve the cause.
   try:
    if clock()<config['deadlineMonotonic']:exclusive_json(directory/'retrieval-negative.json',{'schema':'marker-root-retrieval-negative-v1','runId':run,'groupId':group,'completedFiles':files,'qualificationAccepted':False,'negativeOriginalsPreserved':True},guard)
   except Exception:pass
   raise
 finally:os.close(lockfd)

def retrieve_group(config,expected,records,terminal_bytes,terminal_identity,urls,**effects):
 require(config.get('downloadAuthorized') is True,'retrieval_disabled')
 require(type(config.get('deadlineMonotonic')) in (int,float) and math.isfinite(config['deadlineMonotonic']),'retrieval_deadline')
 clock=effects.get('clock',time.monotonic)
 if effects.get('transport') is not None:result=_retrieve_group(config,expected,records,terminal_bytes,terminal_identity,urls,**effects)
 else:
  require(not effects,'retrieval_native_effects')
  with absolute_deadline(config['deadlineMonotonic'],clock=clock):result=_retrieve_group(config,expected,records,terminal_bytes,terminal_identity,urls,clock=clock)
 require(clock()<config['deadlineMonotonic'],'retrieval_deadline');return result
def _retrieve_group(config,expected,records,terminal_bytes,terminal_identity,urls,**effects):
 """ROOT entry: native raw records and terminal inventory precede any fetch.
 Explicitly retain complete negative groups; a retrieval receipt is not PASS.
 """
 require(config.get('downloadAuthorized') is True,'retrieval_disabled')
 clock=effects.get('clock',time.monotonic)
 def guard():require(clock()<config['deadlineMonotonic'],'retrieval_deadline')
 guard()
 native=validate_native(expected,records)
 require(0<len(terminal_bytes)<=TERMINAL and identity(terminal_bytes)==terminal_identity,'retrieval_terminal_sha')
 terminal=json.loads(terminal_bytes)
 require(terminal.get('schema')=='single-program-terminal-v1' and terminal.get('runId')==config.get('runId') and terminal.get('groupId')==config.get('groupId') and terminal.get('capacityAccepted') is False,'retrieval_terminal_binding')
 require(terminal.get('pairedQualification') is False and terminal.get('invocationId')=='mass-320-48000stereo-073','retrieval_terminal_scope')
 require(terminal.get('binding',{}).get('imageManifestSHA')==native['imageDigest'].replace('sha256:','') and terminal['binding']['candidateSHA']==config['candidateSHA'],'retrieval_terminal_image')
 require(terminal.get('destination')==f's3://{BUCKET}/synthetic-benchmarks/{config["runId"]}/qualification/canary-000/','retrieval_terminal_target')
 files=terminal.get('artifacts');require(isinstance(files,list) and len(files)<=256 and all(isinstance(f,dict) and set(f)=={'name','bytes','sha256'} and f['name']!='terminal.json' for f in files),'retrieval_terminal_inventory')
 identities=[{'name':'terminal.json',**terminal_identity},*files]
 require(set(urls)=={f['name'] for f in identities},'retrieval_url_inventory')
 specs=[{**f,'url':urls[f['name']]} for f in identities]
 result=_retrieve(config,specs,**effects)
 # Separate later native facts; serialized provisional terminal stays untouched.
 directory=ROOT/config['runId']/config['groupId']
 try:
  exclusive_json(directory/'native.json',native,guard)
  guard()
 except Exception:
  try:
   if clock()<config['deadlineMonotonic'] and not (directory/'retrieval-negative.json').exists():exclusive_json(directory/'retrieval-negative.json',{'schema':'marker-root-retrieval-negative-v1','qualificationAccepted':False,'nativeFinalizationIncomplete':True},guard)
  except Exception:pass
  raise
 return {**result,'native':native}

if __name__=='__main__':
 import sys,base64
 require(len(sys.argv)==3,'retrieval_usage')
 input_path=Path(sys.argv[1]);before=regular(input_path);require(0<before.st_size<=196608,'retrieval_input_cap')
 fd=os.open(input_path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as source:
  require(stable_file(os.fstat(source.fileno()))==stable_file(before),'retrieval_input_changed');raw=source.read(196609);require(len(raw)==before.st_size and source.read(1)==b'' and stable_file(os.fstat(source.fileno()))==stable_file(before),'retrieval_input_changed')
 require(0<len(raw)<=196608,'retrieval_input_cap');request=json.loads(raw)
 require(request['schema']=='single-program-root-retrieval-input-v1','retrieval_input')
 config=request['config'];remaining=float(sys.argv[2]);require(math.isfinite(remaining) and remaining>0,'retrieval_deadline')
 config={**config,'deadlineMonotonic':time.monotonic()+remaining}
 result=retrieve_group(config,request['expected'],request['records'],base64.b64decode(request['terminalBase64'],validate=True),request['terminalIdentity'],request['urls'])
 raw=wire(result)+b'\n';require(len(raw)<=196608,'retrieval_output_cap');sys.stdout.buffer.write(raw);sys.stdout.buffer.flush()
 require(time.monotonic()<config['deadlineMonotonic'],'retrieval_deadline')
