import sys,os,uuid
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
import pytest
from services.engine import initial,mutate,estimates,analytics,Problem
from storage import SQLiteStore
from app import create_app
ADMIN={'uid':'admin','role':'admin','departmentIds':['*']}
def ticket(s,uid=None,now=1000,key=None):return mutate(s,'create',{'departmentId':'bank','service':'Cash & deposits','requestId':key or uuid.uuid4().hex},{'uid':uid or uuid.uuid4().hex,'role':'customer'},now)
def test_fifo_estimates_and_idempotency():
 s=initial();a=ticket(s,'u',key='request-0001');assert ticket(s,'u',key='request-0001')['id']==a['id']
 b=ticket(s);c=ticket(s);e=estimates(s,1000);assert [e[t['id']]['estimatedWaitMinutes'] for t in [a,b,c]]==[0,0,5]
 assert mutate(s,'next',{'counterId':'bank-1'},ADMIN,1000)['id']==a['id']
 assert mutate(s,'next',{'counterId':'bank-2'},ADMIN,1000)['id']==b['id']
 with pytest.raises(Problem):mutate(s,'next',{'counterId':'bank-1'},ADMIN)
def test_closed_counter_and_complete():
 s=initial();t=ticket(s)
 with pytest.raises(Problem):mutate(s,'next',{'counterId':'bank-3'},ADMIN)
 mutate(s,'next',{'counterId':'bank-1'},ADMIN,1060);mutate(s,'start',{'tokenId':t['id']},ADMIN,1120)
 mutate(s,'close',{'counterId':'bank-1'},ADMIN,1121)
 assert s['counters'][0]['currentTokenId']==t['id']
 mutate(s,'complete',{'tokenId':t['id']},ADMIN,1420)
 assert s['records'][0]['actualServiceMinutes']==5
 assert analytics(s,['*'])['averageWait']==2
 with pytest.raises(Problem):mutate(s,'complete',{'tokenId':t['id']},ADMIN,1450)
def test_no_counters_and_notifications():
 s=initial()
 for c in ['bank-1','bank-2']:mutate(s,'close',{'counterId':c},ADMIN,900)
 t=ticket(s);assert estimates(s)[t['id']]['estimatedWaitMinutes'] is None;assert not t['notificationState']
 mutate(s,'open',{'counterId':'bank-1'},ADMIN,1000);first=t['notificationAt']
 ticket(s,now=1020);assert t['notificationAt']==first
 assert t['notificationState']
def test_roles_recall_and_owner():
 s=initial();t=ticket(s,'owner');staff={'uid':'staff','role':'staff','departmentIds':['hospital']}
 with pytest.raises(Problem):mutate(s,'next',{'counterId':'bank-1'},staff)
 with pytest.raises(Problem):mutate(s,'cancel',{'tokenId':t['id']},{'uid':'other','role':'customer'})
 mutate(s,'next',{'counterId':'bank-1'},ADMIN);mutate(s,'skip',{'tokenId':t['id']},ADMIN)
 second=ticket(s);mutate(s,'recall',{'tokenId':t['id']},ADMIN)
 assert mutate(s,'next',{'counterId':'bank-1'},ADMIN)['id']==second['id']
def test_atomic_concurrency(tmp_path):
 db=SQLiteStore(str(tmp_path/'test.db'))
 with ThreadPoolExecutor(max_workers=8) as ex:ts=list(ex.map(lambda _:db.transact(lambda s:ticket(s)),range(20)))
 assert len({t['tokenNumber'] for t in ts})==20
 with ThreadPoolExecutor(max_workers=2) as ex:assigned=list(ex.map(lambda cid:db.transact(lambda s:mutate(s,'next',{'counterId':cid},ADMIN)),['bank-1','bank-2']))
 assert len({t['id'] for t in assigned})==2
 assert len(db.read()['tokens'])==20

def test_api_auth_and_tracking(tmp_path,monkeypatch):
 monkeypatch.setenv('STORE_MODE','sqlite')
 app=create_app(SQLiteStore(str(tmp_path/'api.db')));c=app.test_client()
 assert c.get('/api/dashboard').status_code==401
 r=c.post('/api/auth/register',json={'name':'Taylor User','email':'User@example.test','password':'user-password'});assert r.status_code==201
 j=r.json['data'];assert j['user']['name']=='Taylor User';h={'Authorization':'Bearer '+j['token']}
 assert c.get('/api/dashboard',headers=h).status_code==403
 p={'departmentId':'bank','service':'Cash & deposits','requestId':'unique-request','displayName':''}
 r=c.post('/api/tokens',headers=h,json=p);assert r.status_code==201;t=r.json['data']
 assert t['displayName']=='Taylor User'
 assert c.post('/api/tokens',headers=h,json=p).json['data']['id']==t['id']
 other=c.post('/api/auth/register',json={'name':'Second User','email':'second@example.test','password':'other-password'}).json['data']['token']
 assert c.get('/api/tokens/'+t['id'],headers={'Authorization':'Bearer '+other}).status_code==403
 assert c.post('/api/auth/login',json={'email':'user@example.test','password':'wrong-pass','role':'customer'}).status_code==401
 assert c.post('/api/auth/login',json={'email':'user@example.test','password':'user-password','role':'admin'}).status_code==401
 assert c.post('/api/auth/login',json={'email':'user@example.test','password':'user-password','role':'staff'}).status_code==400
 assert c.post('/api/auth/register',json={'name':'Taylor User','email':'USER@example.test','password':'user-password'}).status_code==409
 assert c.post('/api/auth/register',json={'name':'','email':'empty@example.test','password':'user-password'}).status_code==400
 assert c.post('/api/auth/register',json={'name':'Short Pass','email':'short@example.test','password':'tiny'}).status_code==400
 assert c.post('/api/auth/guest').status_code==404
 assert c.post('/api/auth/admin',json={'password':'legacy-disabled'}).status_code==404
 setup=c.post('/api/auth/admin/setup');assert setup.status_code==201
 credentials=setup.json['data'];assert credentials['email'].endswith('@tokenflow.local') and len(credentials['password'])>=20
 assert c.post('/api/auth/admin/setup').status_code==409
 login=c.post('/api/auth/login',json={'email':credentials['email'],'password':credentials['password'],'role':'admin'});assert login.status_code==200
 a=login.json['data']['token'];ah={'Authorization':'Bearer '+a}
 assert c.get('/api/dashboard',headers=ah).status_code==200
 assert c.get('/api/auth/admin/setup-status').json['data']['available'] is False
 assert c.post('/api/tokens',headers=h,json={**p,'requestId':'another-key','service':'fake'}).status_code==400
 assert c.post('/api/simulate',headers=ah,json={'departmentId':'bank','count':2}).status_code==200

def test_sms_failure(monkeypatch):
 from services.notifications import send_sms
 import requests
 for k in ('TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM'):monkeypatch.setenv(k,'test')
 def fail(*args,**kwargs):raise requests.ConnectionError('provider unavailable')
 monkeypatch.setattr(requests,'post',fail)
 assert send_sms('+12025550123','test')['status']=='failed'
