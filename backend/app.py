import os,time,uuid,logging,sqlite3
from collections import defaultdict,deque
from threading import Lock
from flask import Flask,request,jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from storage import SQLiteStore,FirestoreStore
from auth import actor,register_user,authenticate,create_admin,issue
from services.engine import Problem,mutate,summary,token_view,get,allowed,analytics

def create_app(store=None):
 load_dotenv();app=Flask(__name__);app.config['STORE_MODE']=os.getenv('STORE_MODE','sqlite')
 app.config['SECRET_KEY']=os.getenv('SECRET_KEY') or uuid.uuid4().hex
 app.json.sort_keys=False
 CORS(app,origins=[os.getenv('FRONTEND_ORIGIN','http://localhost:5173')])
 db=store or (FirestoreStore() if app.config['STORE_MODE']=='firestore' else SQLiteStore(os.getenv('SQLITE_PATH','tokenflow.db')))
 limits=defaultdict(deque);lock=Lock()
 def ok(data):return jsonify(success=True,data=data)
 def body():
  p=request.get_json(silent=True)
  if not isinstance(p,dict):raise Problem('A JSON object is required')
  return p
 @app.errorhandler(Problem)
 def problem(e):return jsonify(success=False,message=e.message),e.status
 @app.errorhandler(Exception)
 def failure(e):
  from werkzeug.exceptions import HTTPException
  if isinstance(e,HTTPException):return jsonify(success=False,message=e.description),e.code
  app.logger.exception('API request failed');return jsonify(success=False,message='Unable to save changes. Please try again.'),500
 @app.before_request
 def throttle():
  if request.method=='POST':
   with lock:
    now=time.monotonic();q=limits[request.remote_addr]
    while q and q[0]<now-60:q.popleft()
    if len(q)>=120:raise Problem('Too many requests; wait a minute',429)
    q.append(now)
 @app.get('/api/health')
 def health():return ok({'status':'ok','storage':app.config['STORE_MODE'],'demo':app.config['STORE_MODE']!='firestore'})
 @app.post('/api/auth/register')
 def register():
  if app.config['STORE_MODE']=='firestore':raise Problem('Use Firebase email and password registration',400)
  p=body()
  try:user=register_user(db,p.get('name'),p.get('email'),p.get('password'))
  except sqlite3.IntegrityError:raise Problem('An account with this email already exists',409)
  return ok(issue(app,user)),201
 @app.post('/api/auth/login')
 def login():
  if app.config['STORE_MODE']=='firestore':raise Problem('Use Firebase email and password sign-in',400)
  p=body();role=p.get('role','customer')
  if role not in ('customer','admin'):raise Problem('Unknown account type')
  return ok(issue(app,authenticate(db,p.get('email'),p.get('password'),role)))
 @app.get('/api/auth/admin/setup-status')
 def admin_setup_status():return ok({'available':app.config['STORE_MODE']=='sqlite' and not db.has_admin()})
 @app.post('/api/auth/admin/setup')
 def admin_setup():
  if app.config['STORE_MODE']!='sqlite':raise Problem('Admin setup is available only for the local demo',400)
  try:user,password=create_admin(db)
  except sqlite3.IntegrityError:raise Problem('Admin setup has already been completed',409)
  return ok({'email':user['email'],'password':password,**issue(app,user)}),201
 @app.get('/api/me')
 def me():return ok(actor(app))
 @app.get('/api/departments')
 def departments():return ok(summary(db.read()))
 @app.get('/api/queue/<id>')
 def queue(id):
  s=summary(db.read());return ok(get(s['departments'],id))
 @app.get('/api/tokens')
 def mine():
  a=actor(app);s=db.read();return ok([token_view(s,t) for t in s['tokens'] if t['ownerUid']==a['uid']])
 @app.get('/api/tokens/<id>')
 def ticket(id):
  a=actor(app);s=db.read();t=get(s['tokens'],id)
  if a['uid']!=t['ownerUid']:allowed(a,t['departmentId'])
  return ok(token_view(s,t))
 @app.post('/api/tokens')
 def create():
  a=actor(app);p=body()
  if not p.get('displayName'):p['displayName']=a.get('displayName','')
  r=db.transact(lambda s:mutate(s,'create',p,a));return ok(token_view(db.read(),r)),201
 @app.get('/api/dashboard')
 def dashboard():
   a=actor(app)
   if a['role']!='admin':raise Problem('Admin access required',403)
   s=db.read();ids=a['departmentIds'];permitted=lambda x:'*' in ids or x['departmentId'] in ids
   return ok({**summary(s),'counters':[c for c in s['counters'] if permitted(c)],'tokens':[token_view(s,t) for t in s['tokens'] if permitted(t)],'analytics':analytics(s,ids)})
 @app.get('/api/analytics')
 def stats():
   a=actor(app)
   if a['role']!='admin':raise Problem('Admin access required',403)
   return ok(analytics(db.read(),a['departmentIds']))
 @app.post('/api/counters/<id>/<action>')
 def counter_action(id,action):
  if action not in ('open','close','next'):raise Problem('Unknown counter action',404)
  a=actor(app);return ok(db.transact(lambda s:mutate(s,action,{'counterId':id},a)))
 @app.post('/api/queue/next')
 def next_token():
  a=actor(app);p=body();return ok(db.transact(lambda s:mutate(s,'next',p,a)))
 @app.post('/api/tokens/<id>/<action>')
 def token_action(id,action):
  if action not in ('start','complete','skip','recall','cancel'):raise Problem('Unknown ticket action',404)
  a=actor(app);return ok(db.transact(lambda s:mutate(s,action,{'tokenId':id},a)))
 @app.post('/api/departments')
 def new_department():
  a=actor(app);p=body();return ok(db.transact(lambda s:mutate(s,'department',p,a)))
 @app.post('/api/counters')
 def new_counter():
  a=actor(app);p=body();return ok(db.transact(lambda s:mutate(s,'counter',p,a)))
 @app.post('/api/simulate')
 def simulate():
  if os.getenv('SIMULATION_ENABLED','true' if app.config['STORE_MODE']=='sqlite' else 'false')!='true':raise Problem('Simulation is disabled',403)
  a=actor(app);p=body();allowed(a,p.get('departmentId'))
  if a['role']!='admin':raise Problem('Admin access required',403)
  count=p.get('count',1)
  if type(count)!=int or not 1<=count<=10:raise Problem('Count must be between 1 and 10')
  def run(s):
   d=get(s['departments'],p.get('departmentId'));return [mutate(s,'create',{'departmentId':d['id'],'service':d['services'][0],'requestId':uuid.uuid4().hex,'displayName':'Simulated visitor'}, {'uid':uuid.uuid4().hex,'role':'customer'}) for _ in range(count)]
  return ok(db.transact(run))
 return app

if __name__=='__main__':create_app().run(host='127.0.0.1',port=int(os.getenv('PORT',5000)),debug=False)
