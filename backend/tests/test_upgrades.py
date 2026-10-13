import sys,os,uuid,time
from urllib.parse import urlparse,parse_qs
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
import pytest
from app import create_app
from storage import SQLiteStore
from services.engine import initial,mutate,public_ticket,Problem
from services.insights import recommendations,compare
A={'uid':'a','role':'admin','departmentIds':['*']}
def new(s,owner=None,at=1000):return mutate(s,'create',{'departmentId':'bank','service':'Cash & deposits','displayName':'Visitor','requestId':uuid.uuid4().hex},{'uid':owner or uuid.uuid4().hex,'role':'customer'},at)
@pytest.fixture
def api_fixture(tmp_path,monkeypatch):
 monkeypatch.setenv('STORE_MODE','sqlite');monkeypatch.setenv('ADMIN_SETUP_KEY','setup-test');monkeypatch.setenv('SIMULATION_ENABLED','true');monkeypatch.setenv('PUBLIC_ORIGIN','https://queue.example.test')
 db=SQLiteStore(str(tmp_path/'db.sqlite'));app=create_app(db);app.config['TESTING']=True;c=app.test_client()
 user=c.post('/api/auth/register',json={'name':'Scanner Test','email':'scan@example.test','password':'a-long-password'}).json['data']
 h={'Authorization':'Bearer '+user['token']}
 t=c.post('/api/tokens',headers=h,json={'departmentId':'bank','service':'Cash & deposits','requestId':'qr-upgrade-0001'}).json['data']
 return app,c,db,h,t

def test_qr_separate_device_live_status_and_privacy(api_fixture):
 app,c,db,h,t=api_fixture
 link=c.post(f'/api/tokens/{t["id"]}/share',headers=h,json={}).json['data']['url'];u=urlparse(link)
 assert u.netloc=='queue.example.test' and u.scheme=='https' and not u.query
 key=parse_qs(u.fragment)['key'][0];scan=app.test_client();qh={'Authorization':'Ticket '+key}
 r=scan.get(f'/api/public/tokens/{t["id"]}',headers=qh);assert r.status_code==200;v=r.json['data']
 assert v['displayName']=='Scanner Test' and v['timezone']=='Asia/Karachi';assert v['peopleAhead']==0 and v['estimatedTurnTime'] is not None
 assert all(k not in v for k in ['ownerUid','phoneNumber','email','requestId','shareVersion'])
 assert 'no-store' in r.headers['Cache-Control']
 db.transact(lambda s:mutate(s,'next',{'counterId':'bank-1'},A));v=scan.get(f'/api/public/tokens/{t["id"]}',headers=qh).json['data']
 assert v['status']=='called' and v['counterName']=='Counter 01' and v['nowServing'][0]['tokenNumber']==t['tokenNumber']
 assert 'Counter 01' in v['message']
 assert scan.post(f'/api/tokens/{t["id"]}/cancel',headers=qh,json={}).status_code==401
 assert scan.post('/api/counters/bank-2/next',headers=qh,json={}).status_code==401
 assert scan.get(f'/api/public/tokens/{t["id"]}').status_code==401

def test_qr_revocation_expiry_and_tampering(api_fixture):
 app,c,db,h,t=api_fixture;url=c.post(f'/api/tokens/{t["id"]}/share',headers=h,json={}).json['data']['url'];key=parse_qs(urlparse(url).fragment)['key'][0]
 endpoint=f'/api/public/tokens/{t["id"]}';qh={'Authorization':'Ticket '+key}
 assert c.get(endpoint,headers={'Authorization':'Ticket '+key+'bad'}).status_code==403
 app.config['SHARE_TTL_SECONDS']=-1;assert c.get(endpoint,headers=qh).status_code==410;app.config['SHARE_TTL_SECONDS']=172800
 assert c.post(f'/api/tokens/{t["id"]}/revoke-share',headers=h,json={}).status_code==200
 assert c.get(endpoint,headers=qh).status_code==403
 newkey=parse_qs(urlparse(c.post(f'/api/tokens/{t["id"]}/share',headers=h,json={}).json['data']['url']).fragment)['key'][0]
 assert c.get(endpoint,headers={'Authorization':'Ticket '+newkey}).status_code==200

def test_recommendations_are_pure_and_scoped():
 s=initial();[new(s) for _ in range(12)];rev=s['revision'];r=recommendations(s,['bank'],1000)
 assert len(r)==1 and r[0]['projectedAverageEstimate']<r[0]['currentAverageEstimate'];assert s['revision']==rev and not s['counters'][2]['isOpen']
 assert recommendations(s,['hospital'],1000)==[]
 for c in ['bank-1','bank-2']:mutate(s,'close',{'counterId':c},A,1000)
 r=recommendations(s,['bank'],1000)[0];assert r['currentAverageEstimate'] is None and r['projectedAverageEstimate']>=0

def test_repeatable_comparison_uses_identical_workloads():
 a=compare({'seed':42});b=compare({'seed':42});assert a==b
 assert [(r['arrival'],r['serviceDuration']) for r in a['baseline']['records']]==[(r['arrival'],r['serviceDuration']) for r in a['improved']['records']]
 assert a['improved']['averageWait']<a['baseline']['averageWait']
 assert a['improved']['completedByHorizon']>a['baseline']['completedByHorizon']
 same=compare({'baselineCounters':2,'improvedCounters':2});assert same['reductionPercent']==0
 one=compare({'customers':1});assert one['baseline']['averageWait']==0 and one['reductionPercent']==0
 with pytest.raises(Problem):compare({'customers':True})
 with pytest.raises(Problem):compare({'serviceMinutes':float('nan')})

def test_api_validation_setup_and_compare_permissions(api_fixture):
 app,c,db,h,t=api_fixture
 assert c.post('/api/auth/admin/setup',json={}).status_code==403
 assert c.post('/api/simulation/compare',headers=h,json={}).status_code==403
 malformed=c.post('/api/tokens',headers=h,json={'departmentId':'hospital','service':'Lab collection','requestId':'bad-name-request','displayName':123});assert malformed.status_code==400
 a=c.post('/api/auth/admin/setup',json={'setupKey':'setup-test'});assert a.status_code==201;ah={'Authorization':'Bearer '+a.json['data']['token']}
 old=db.read();response=c.post('/api/simulation/compare',headers=ah,json={'customers':15});assert response.status_code==200;assert old==db.read()
 assert c.post('/api/counters',headers=ah,json={'departmentId':'bank','name':[]}).status_code==400
 assert c.post('/api/departments',headers=ah,json={'id':'bank','name':'Banks','branch':'Branch','instructions':22}).status_code==400
 assert c.get('/api/dashboard',headers=ah).json['data']['simulationEnabled'] is True

def test_recall_alert_cycle_and_paused_ticket():
 s=initial();t=new(s);v=public_ticket(s,t,1000);first=v['notificationEventId'];assert v['notificationState']
 mutate(s,'next',{'counterId':'bank-1'},A,1001);called=public_ticket(s,t,1001);assert called['notificationEventId']!=first
 mutate(s,'skip',{'tokenId':t['id']},A,1002);mutate(s,'recall',{'tokenId':t['id']},A,1003);assert public_ticket(s,t,1003)['notificationEventId']!=first
 for c in ['bank-1','bank-2']:mutate(s,'close',{'counterId':c},A,1004)
 view=public_ticket(s,t,1004);assert view['estimatedTurnTime'] is None and not view['notificationState'] and 'paused' in view['message']

def test_old_database_preserved_with_new_features(tmp_path):
 path=str(tmp_path/'old.db');db=SQLiteStore(path);t=db.transact(lambda s:new(s,'existing'))
 def legacy(s):
  for key in ['shareVersion','queueCycle','initialEstimatedWait']:s['tokens'][0].pop(key,None)
 db.transact(legacy);reopened=SQLiteStore(path);s=reopened.read();assert s['tokens'][0]['id']==t['id'];assert public_ticket(s,s['tokens'][0])['tokenNumber']==t['tokenNumber']

def test_concurrent_same_request_one_ticket_and_counter_claim(tmp_path):
 db=SQLiteStore(str(tmp_path/'concurrent.db'));payload={'departmentId':'bank','service':'Cash & deposits','requestId':'same-network-retry'};owner={'uid':'same','role':'customer'}
 with ThreadPoolExecutor(max_workers=8) as pool:r=list(pool.map(lambda _:db.transact(lambda s:mutate(s,'create',payload,owner)),range(8)))
 assert len({x['id'] for x in r})==1 and len(db.read()['tokens'])==1
 def claim(c):
  try:return db.transact(lambda s:mutate(s,'next',{'counterId':c},A))['id']
  except Problem:return None
 with ThreadPoolExecutor(max_workers=2) as pool:claims=list(pool.map(claim,['bank-1','bank-2']))
 assert sum(c is not None for c in claims)==1
