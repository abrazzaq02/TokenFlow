"""Adds five synthetic visitors per category. Never resets existing data."""
import uuid,os
from dotenv import load_dotenv
from storage import SQLiteStore,FirestoreStore
from services.engine import mutate
load_dotenv()
if os.getenv('SIMULATION_ENABLED','false')!='true':raise SystemExit('Set SIMULATION_ENABLED=true to seed synthetic data.')
db=FirestoreStore() if os.getenv('STORE_MODE')=='firestore' else SQLiteStore(os.getenv('SQLITE_PATH','tokenflow.db'))
def seed(s):
 result=[]
 for d in s['departments']:
  for n in range(5):result.append(mutate(s,'create',{'departmentId':d['id'],'service':d['services'][0],'requestId':uuid.uuid4().hex,'displayName':f'Simulated visitor {n+1}'},{'uid':uuid.uuid4().hex,'role':'customer'}))
 return len(result)
print(f'Created {db.transact(seed)} synthetic tickets.')
