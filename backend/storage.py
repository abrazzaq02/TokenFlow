import json, sqlite3, os, time
from contextlib import closing
from services.engine import initial,summary,token_view

class SQLiteStore:
 def __init__(self,path):
  self.path=path
  with closing(self.connect()) as db, db:
   db.execute('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, data TEXT NOT NULL)')
   db.execute('INSERT OR IGNORE INTO state VALUES(1,?)',(json.dumps(initial()),))
   db.execute('CREATE TABLE IF NOT EXISTS accounts(uid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT "", email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ("customer", "admin")), created_at INTEGER NOT NULL)')
   if 'name' not in {row[1] for row in db.execute('PRAGMA table_info(accounts)')}:db.execute('ALTER TABLE accounts ADD COLUMN name TEXT NOT NULL DEFAULT ""')
   db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_local_admin ON accounts(role) WHERE role='admin'")
 def connect(self):return sqlite3.connect(self.path,timeout=30)
 def create_account(self,uid,name,email,password_hash,role):
  with closing(self.connect()) as db, db:
   db.execute('INSERT INTO accounts(uid,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',(uid,name,email,password_hash,role,int(time.time())))
 def account(self,email):
  with closing(self.connect()) as db, db:
   row=db.execute('SELECT uid,name,email,password_hash,role FROM accounts WHERE email=?',(email,)).fetchone()
  return dict(zip(('uid','name','email','password_hash','role'),row)) if row else None
 def has_admin(self):
  with closing(self.connect()) as db, db:return db.execute("SELECT 1 FROM accounts WHERE role='admin' LIMIT 1").fetchone() is not None
 def read(self):
  with closing(self.connect()) as db, db:return json.loads(db.execute('SELECT data FROM state WHERE id=1').fetchone()[0])
 def transact(self,fn):
  with closing(self.connect()) as db, db:
   db.execute('BEGIN IMMEDIATE');s=json.loads(db.execute('SELECT data FROM state WHERE id=1').fetchone()[0]);result=fn(s)
   db.execute('UPDATE state SET data=? WHERE id=1',(json.dumps(s),));return result

class FirestoreStore:
 """Bounded hackathon aggregate (250 tokens), serialized atomically across API workers.
 Private aggregate plus authorized real-time projections. Split by branch for scale.
 """
 def __init__(self):
  import firebase_admin
  from firebase_admin import firestore
  if not firebase_admin._apps:firebase_admin.initialize_app()
  self.db=firestore.client();self.ref=self.db.collection('private_state').document('queue');self.fs=firestore
 def read(self):
  snap=self.ref.get();return snap.to_dict()['data'] if snap.exists else initial()
 def transact(self,fn):
  @self.fs.transactional
  def run(tx):
   snap=self.ref.get(transaction=tx);s=snap.to_dict()['data'] if snap.exists else initial();r=fn(s)
   tx.set(self.ref,{'data':s,'updatedAt':self.fs.SERVER_TIMESTAMP})
   tx.set(self.db.collection('public_queue').document('summary'),summary(s))
   for t in s['tokens']:tx.set(self.db.collection('tokens').document(t['id']),token_view(s,t))
   return r
  return run(self.db.transaction())
