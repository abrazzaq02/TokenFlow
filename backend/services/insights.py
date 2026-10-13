"""Transparent estimates and repeatable counter comparisons; no ML or fabricated metrics."""
import copy, heapq, random, math, time
from statistics import mean
from .engine import estimates, average, get, Problem

def serving(s, department_id):
    tokens={t['id']:t for t in s['tokens']}
    return [{'tokenNumber':tokens[c['currentTokenId']]['tokenNumber'],'counterName':c['name'],'status':tokens[c['currentTokenId']]['status']} for c in s['counters'] if c['departmentId']==department_id and c.get('currentTokenId') in tokens and tokens[c['currentTokenId']]['status'] in ('called','serving')]

def instruction(status, counter=None, position=0, wait=None):
    if status=='waiting':
        if wait is None:return 'Service is paused. Waiting for an available counter.'
        if 0<position<=4:return 'Your turn is approaching. Please stay near the service area.'
        return 'Your place is saved. We will keep you updated.'
    return {'called':f'It is your turn. Please proceed to {counter or "your assigned counter"}.','serving':'Your service is in progress.','completed':'Your service is complete. Thank you.','cancelled':'This ticket has been cancelled and is no longer active.','skipped':'You missed your call. Contact staff to rejoin the queue.'}.get(status,'Please contact the service desk.')

def recommendations(s, ids, now=None):
    now=now if now is not None else time.time();base=estimates(s,now);out=[]
    for d in s['departments']:
        if '*' not in ids and d['id'] not in ids:continue
        waiting=[t for t in s['tokens'] if t['departmentId']==d['id'] and t['status']=='waiting']
        closed=[c for c in s['counters'] if c['departmentId']==d['id'] and not c['isOpen']]
        if not waiting or not closed:continue
        candidate=closed[0];after=copy.deepcopy(s);get(after['counters'],candidate['id'])['isOpen']=True
        projected=estimates(after,now);current=[base[t['id']]['estimatedWaitMinutes'] for t in waiting];future=[projected[t['id']]['estimatedWaitMinutes'] for t in waiting]
        before=None if any(v is None for v in current) else round(mean(current),1)
        later=round(mean(future),1);saving=None if before is None else round(before-later,1)
        if before is not None and saving<1:continue
        out.append({'departmentId':d['id'],'counterId':candidate['id'],'counterName':candidate['name'],'waiting':len(waiting),'currentAverageEstimate':before,'projectedAverageEstimate':later,'estimatedMinutesSaved':saving,'reason':f'{len(waiting)} people are waiting. Opening {candidate["name"]} '+('would resume this queue.' if before is None else f'could reduce average estimated wait from {before:g} to {later:g} minutes.'),'assumption':'Assumes staff are available, unchanged service durations, and no new arrivals. Estimates, not measured savings.'})
    return out

def compare(payload):
    def integer(name,default,low,high):
        v=payload.get(name,default)
        if type(v)!=int or not low<=v<=high:raise Problem(f'{name} must be an integer between {low} and {high}')
        return v
    seed=integer('seed',42,0,999999);n=integer('customers',15,1,200);a=integer('baselineCounters',1,1,10);b=integer('improvedCounters',3,1,10)
    duration=payload.get('serviceMinutes',5);gap=payload.get('arrivalInterval',0)
    if isinstance(duration,bool) or not isinstance(duration,(int,float)) or not math.isfinite(duration) or not .5<=duration<=60:raise Problem('serviceMinutes must be between 0.5 and 60')
    if isinstance(gap,bool) or not isinstance(gap,(int,float)) or not math.isfinite(gap) or not 0<=gap<=30:raise Problem('arrivalInterval must be between 0 and 30')
    state=seed
    def rng():
        nonlocal state
        state=(1664525*state+1013904223)&0xffffffff
        return state/4294967296
    customers=[{'arrival':round(i*gap,2),'duration':round(duration*(.8+.4*rng()),2)} for i in range(n)]
    horizon=30
    def run(count):
        available=[(0,c) for c in range(count)];heapq.heapify(available);rows=[]
        for i,customer in enumerate(customers):
            free,c=heapq.heappop(available);start=max(free,customer['arrival']);finish=start+customer['duration'];heapq.heappush(available,(finish,c))
            rows.append({'token':i+1,'arrival':customer['arrival'],'serviceDuration':customer['duration'],'start':round(start,2),'finish':round(finish,2),'wait':round(start-customer['arrival'],2),'counter':c+1})
        return {'counters':count,'averageWait':round(mean(r['wait'] for r in rows),2),'maxWait':max(r['wait'] for r in rows),'completedByHorizon':sum(r['finish']<=horizon for r in rows),'totalCompletionMinutes':max(r['finish'] for r in rows),'records':rows}
    baseline,improved=run(a),run(b);reduction=round(baseline['averageWait']-improved['averageWait'],2)
    return {'seed':seed,'customers':n,'horizonMinutes':horizon,'arrivalInterval':gap,'serviceMinutes':duration,'baseline':baseline,'improved':improved,'averageWaitReductionMinutes':reduction,'reductionPercent':round(100*reduction/baseline['averageWait'],1) if baseline['averageWait'] else 0,'label':'Simulated service outcomes, not real-world measurements. Both runs use identical arrivals and service durations. No live tickets were changed.'}
