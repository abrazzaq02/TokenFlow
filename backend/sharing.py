"""Signed, expiring, read-only ticket links. The key is carried in a URL fragment."""
import time
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from flask import request
from services.engine import Problem

def signer(app):return URLSafeTimedSerializer(app.config['SECRET_KEY'],salt='tokenflow-readonly-ticket-v1')
def issue(app,t):
    key=signer(app).dumps({'id':t['id'],'v':t.get('shareVersion',0)})
    origin=app.config.get('PUBLIC_ORIGIN') or request.host_url.rstrip('/')
    return {'url':f'{origin}/track/{t["id"]}#key={key}','expiresInSeconds':app.config['SHARE_TTL_SECONDS']}
def verify(app,t,key):
    if not key:raise Problem('Open a current QR link, or sign in as the ticket owner.',401)
    try:data=signer(app).loads(key,max_age=app.config['SHARE_TTL_SECONDS'])
    except SignatureExpired:raise Problem('This QR link has expired. Ask the ticket owner for a new QR.',410)
    except BadSignature:raise Problem('This QR link is invalid.',403)
    if data.get('id')!=t['id'] or data.get('v')!=t.get('shareVersion',0):raise Problem('This QR link has been revoked or is invalid.',403)
    terminal=t.get('serviceEndTime') or t.get('updatedAt') or t['arrivalTime']
    if t['status'] in ('completed','cancelled') and time.time()-terminal>86400:raise Problem('This ticket link is no longer available.',410)
