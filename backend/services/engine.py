"""Pure queue engine. All mutations are executed inside a storage transaction."""
import time, uuid, heapq
from statistics import mean

CATEGORIES = [
 ('bank','Banks','BNK','Everyday banking, without the everyday wait.','Central Bank • City Branch',['Cash & deposits','Account services'],5),
 ('hospital','Hospitals','MED','Less waiting. More care.','City Care • Outpatient Desk',['Consultation registration','Lab collection'],8),
 ('police','Police Stations','POL','Your local services, a little simpler.','City Police • Facilitation Desk',['Character certificate','Report assistance'],7),
 ('government','Government / NADRA','GOV','Get the paperwork moving.','Citizen Center • Main Branch',['ID card services','Document verification'],6),
 ('utility','Utility Centers','UTL','Bills, connections, and everything between.','Utility Hub • Customer Services',['Billing support','New connection'],4)]

class Problem(Exception):
 def __init__(self,message,status=400): self.message,self.status=message,status

def initial():
 s={'departments':[],'counters':[],'tokens':[],'records':[],'events':[],'revision':0}
 for id,name,prefix,desc,branch,services,duration in CATEGORIES:
  s['departments'].append(dict(id=id,name=name,prefix=prefix,description=desc,branch=branch,services=services,duration=duration,active=True,sequence=0))
  for n in range(1,4): s['counters'].append(dict(id=f'{id}-{n}',departmentId=id,name=f'Counter {n:02}',isOpen=n<3,currentTokenId=None))
 return s

def get(items,id):
 v=next((x for x in items if x['id']==id),None)
 if not v: raise Problem('Record not found',404)
 return v

def allowed(actor,department):
 if actor['role']!='admin': raise Problem('Admin access required',403)
 if actor.get('departmentIds')!=['*'] and department not in actor.get('departmentIds',[]): raise Problem('This branch is outside your access',403)

def average(s,d):
 rs=[r['actualServiceMinutes'] for r in s['records'] if r['departmentId']==d and r['actualServiceMinutes']>0][-30:]
 return mean(rs) if rs else get(s['departments'],d)['duration']

def estimates(s,now=None):
 now=now or time.time(); result={}
 for d in s['departments']:
  avg=average(s,d['id']); heap=[]
  for c in s['counters']:
   if c['departmentId']!=d['id'] or not c['isOpen']:continue
   remaining=0
   if c['currentTokenId']:
    t=get(s['tokens'],c['currentTokenId']); start=t.get('serviceStartTime') or t.get('calledAt') or now
    remaining=max(.5,avg-(now-start)/60)
   heapq.heappush(heap,(remaining,c['id']))
  waiting=sorted([t for t in s['tokens'] if t['departmentId']==d['id'] and t['status']=='waiting'],key=lambda t:t['queueSequence'])
  for pos,t in enumerate(waiting,1):
   wait=None
   if heap:
    wait,cid=heapq.heappop(heap);heapq.heappush(heap,(wait+avg,cid))
   result[t['id']]={'position':pos,'estimatedWaitMinutes':round(wait,1) if wait is not None else None}
 return result

def token_view(s,t,now=None):
 return {**t,**estimates(s,now).get(t['id'],{'position':0,'estimatedWaitMinutes':0})}

def summary(s,now=None):
 est=estimates(s,now); ds=[]
 for d in s['departments']:
  ts=[t for t in s['tokens'] if t['departmentId']==d['id']]; cs=[c for c in s['counters'] if c['departmentId']==d['id']]
  waits=[est[t['id']]['estimatedWaitMinutes'] for t in ts if t['status']=='waiting']
  ds.append({**d,'waiting':sum(t['status']=='waiting' for t in ts),'openCounters':sum(c['isOpen'] for c in cs),'estimatedWait':max((x for x in waits if x is not None),default=0) if any(c['isOpen'] for c in cs) else None})
 return {'departments':ds,'revision':s['revision']}

def analytics(s,ids):
 ts=[t for t in s['tokens'] if '*' in ids or t['departmentId'] in ids]; rs=[r for r in s['records'] if '*' in ids or r['departmentId'] in ids]
 started=[(t['serviceStartTime']-t['arrivalTime'])/60 for t in ts if t.get('serviceStartTime')]
 return dict(issued=len(ts),waiting=sum(t['status']=='waiting' for t in ts),serving=sum(t['status'] in ('called','serving') for t in ts),completed=sum(t['status']=='completed' for t in ts),skipped=sum(t['status']=='skipped' for t in ts),averageWait=round(mean(started),1) if started else 0,averageService=round(mean([r['actualServiceMinutes'] for r in rs]),1) if rs else 0,byCounter=[{'name':c['name'],'id':c['id'],'completed':sum(r['counterId']==c['id'] for r in rs)} for c in s['counters'] if '*' in ids or c['departmentId'] in ids],history=[{'time':e['time'],'waiting':sum(v for k,v in e['byDepartment'].items() if '*' in ids or k in ids)} for e in s['events'][-40:]])

def mutate(s,action,p,actor,now=None):
 now=now or time.time(); result=None
 if action=='create':
  d=get(s['departments'],p.get('departmentId'))
  if not d['active']:raise Problem('This service is unavailable')
  if p.get('service') not in d['services']:raise Problem('Choose a valid service')
  key=p.get('requestId')
  if not isinstance(key,str) or not 8<=len(key)<=100:raise Problem('A valid request ID is required')
  old=next((t for t in s['tokens'] if t['ownerUid']==actor['uid'] and t['requestId']==key),None)
  if old:return old
  if any(t['ownerUid']==actor['uid'] and t['departmentId']==d['id'] and t['status'] in ('waiting','called','serving') for t in s['tokens']):raise Problem('You already have an active ticket for this branch',409)
  if len(s['tokens'])>=250:raise Problem('Demo capacity reached (250 tickets). Archive/reset the demo before continuing.',409)
  name=p.get('displayName','').strip()
  if len(name)>60:raise Problem('Name must be 60 characters or fewer')
  d['sequence']+=1
  result=dict(id=uuid.uuid4().hex,ownerUid=actor['uid'],departmentId=d['id'],service=p['service'],displayName=name,tokenNumber=f"{d['prefix']}-{d['sequence']:03}",queueSequence=d['sequence'],requestId=key,status='waiting',arrivalTime=now,serviceStartTime=None,serviceEndTime=None,assignedCounterId=None,notificationState=False,smsStatus='unavailable',createdAt=now,updatedAt=now)
  s['tokens'].append(result)
 elif action in ('open','close','next'):
  c=get(s['counters'],p.get('counterId'));allowed(actor,c['departmentId'])
  if action!='next': c['isOpen']=action=='open';result=c
  else:
   if not c['isOpen']:raise Problem('Open this counter first',409)
   if c['currentTokenId']:raise Problem('Finish the current ticket first',409)
   q=sorted([t for t in s['tokens'] if t['departmentId']==c['departmentId'] and t['status']=='waiting'],key=lambda t:t['queueSequence'])
   if not q:raise Problem('No waiting tickets',409)
   result=q[0];result.update(status='called',calledAt=now,assignedCounterId=c['id'],updatedAt=now);c['currentTokenId']=result['id']
 elif action in ('start','complete','skip','recall','cancel'):
  t=get(s['tokens'],p.get('tokenId'));result=t
  if action=='cancel':
   if t['ownerUid']!=actor['uid']:raise Problem('This ticket belongs to another user',403)
   if t['status']!='waiting':raise Problem('Only waiting tickets may be cancelled',409)
   t['status']='cancelled'
  else:
   allowed(actor,t['departmentId'])
   if action=='recall':
    if t['status']!='skipped':raise Problem('Only skipped tickets may rejoin',409)
    d=get(s['departments'],t['departmentId']);d['sequence']+=1;t.update(status='waiting',queueSequence=d['sequence'],assignedCounterId=None,notificationState=False)
   else:
    c=get(s['counters'],t.get('assignedCounterId'))
    if c['currentTokenId']!=t['id']:raise Problem('Ticket is not assigned to this counter',409)
    if action=='start':
     if t['status']!='called':raise Problem('Call this ticket first',409)
     t.update(status='serving',serviceStartTime=now)
    elif action=='complete':
     if t['status']!='serving':raise Problem('Start service before completing',409)
     t.update(status='completed',serviceEndTime=now);c['currentTokenId']=None
     s['records'].append(dict(id=uuid.uuid4().hex,tokenId=t['id'],departmentId=t['departmentId'],counterId=c['id'],arrivalTime=t['arrivalTime'],serviceStartTime=t['serviceStartTime'],serviceEndTime=now,actualWaitingMinutes=(t['serviceStartTime']-t['arrivalTime'])/60,actualServiceMinutes=(now-t['serviceStartTime'])/60,finalStatus='completed'))
    elif action=='skip':
     if t['status']!='called':raise Problem('Only called tickets may be marked no-show',409)
     t['status']='skipped';c['currentTokenId']=None
  t['updatedAt']=now
 elif action=='department':
  if actor['role']!='admin':raise Problem('Admin access required',403)
  if not p.get('name') or not p.get('branch'):raise Problem('Name and branch are required')
  if p.get('id'):
   d=get(s['departments'],p['id']);allowed(actor,d['id']);d.update(name=str(p['name'])[:60],branch=str(p['branch'])[:100]);result=d
  else:
   if actor.get('departmentIds')!=['*']:raise Problem('Global admin required to create a department',403)
   if len(s['departments'])>=20:raise Problem('MVP department capacity reached',409)
   result=dict(id=uuid.uuid4().hex,name=str(p['name'])[:60],branch=str(p['branch'])[:100],prefix='NEW',description='Public service desk',services=['General assistance'],duration=5,active=True,sequence=0);s['departments'].append(result)
 elif action=='counter':
  if actor['role']!='admin':raise Problem('Admin access required',403)
  d=get(s['departments'],p.get('departmentId'));allowed(actor,d['id'])
  if not p.get('name'):raise Problem('Counter name is required')
  if len(s['counters'])>=60:raise Problem('MVP counter capacity reached',409)
  result=dict(id=uuid.uuid4().hex,departmentId=d['id'],name=str(p['name'])[:40],isOpen=False,currentTokenId=None);s['counters'].append(result)
 else:raise Problem('Unknown action')
 s['revision']+=1
 for id,e in estimates(s,now).items():
  if e['position']<=4 and e['estimatedWaitMinutes'] is not None:
   t=get(s['tokens'],id)
   if not t['notificationState']:t['notificationState']=True;t['notificationAt']=now
 s['events'].append({'time':now,'byDepartment':{d['id']:sum(t['status']=='waiting' and t['departmentId']==d['id'] for t in s['tokens']) for d in s['departments']}});s['events']=s['events'][-100:]
 return result
