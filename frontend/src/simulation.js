// Same seeded workload generator and FIFO simulation as the Python implementation.
export function compare(p={}){
 const seed=p.seed??42,n=p.customers??15,a=p.baselineCounters??1,b=p.improvedCounters??3,duration=p.serviceMinutes??5,gap=p.arrivalInterval??0;
 for(const [v,lo,hi] of [[seed,0,999999],[n,1,200],[a,1,10],[b,1,10]])if(!Number.isInteger(v)||v<lo||v>hi)throw Error('Invalid simulation parameters.');
 if(!Number.isFinite(duration)||duration<.5||duration>60||!Number.isFinite(gap)||gap<0||gap>30)throw Error('Invalid arrival or service duration.');
 let state=seed>>>0;const rng=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};const round=v=>Math.round((v+Number.EPSILON)*100)/100;
 const customers=Array.from({length:n},(_,i)=>({arrival:round(i*gap),duration:round(duration*(.8+.4*rng()))}));
 function run(count){const free=Array(count).fill(0),records=customers.map((c,i)=>{let counter=0;for(let j=1;j<count;j++)if(free[j]<free[counter])counter=j;const start=Math.max(free[counter],c.arrival),finish=start+c.duration;free[counter]=finish;return {token:i+1,arrival:c.arrival,serviceDuration:c.duration,start:round(start),finish:round(finish),wait:round(start-c.arrival),counter:counter+1}});return {counters:count,averageWait:round(records.reduce((n,r)=>n+r.wait,0)/n),maxWait:Math.max(...records.map(r=>r.wait)),completedByHorizon:records.filter(r=>r.finish<=30).length,totalCompletionMinutes:Math.max(...records.map(r=>r.finish)),records}}
 const baseline=run(a),improved=run(b),reduction=round(baseline.averageWait-improved.averageWait);return {seed,customers:n,horizonMinutes:30,arrivalInterval:gap,serviceMinutes:duration,baseline,improved,averageWaitReductionMinutes:reduction,reductionPercent:baseline.averageWait?Math.round(1000*reduction/baseline.averageWait)/10:0,label:'Simulated service outcomes, not real-world measurements. Both runs use identical arrivals and service durations. No live tickets were changed.'}
}
