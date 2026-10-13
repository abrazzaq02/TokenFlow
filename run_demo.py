"""Serve the built frontend and shared SQLite API from one LAN-reachable origin."""
import os,sys,socket,secrets
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'backend'))
from dotenv import load_dotenv
load_dotenv(ROOT/'backend'/'.env')
def local_ip():
    try:
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as route:
            route.connect(('8.8.8.8',80))
            address=route.getsockname()[0]
        if address and not address.startswith('127.'):return address
    except OSError:
        pass
    try:candidates=socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:candidates=[]
    return next((ip for ip in candidates if not ip.startswith('127.')), '127.0.0.1')
if not (ROOT/'dist'/'index.html').exists():raise SystemExit('Build first: cd frontend && npm install && npm run build')
port=int(os.getenv('PORT','5000'));origin=os.getenv('PUBLIC_ORIGIN') or f'http://{local_ip()}:{port}'
os.environ['PUBLIC_ORIGIN']=origin
db_path=Path(os.getenv('SQLITE_PATH') or 'tokenflow.db')
os.environ['SQLITE_PATH']=str(db_path if db_path.is_absolute() else ROOT/'backend'/db_path)
os.environ.setdefault('SESSION_SECRET_FILE',str(ROOT/'backend'/'.session-secret'))
os.environ.setdefault('SIMULATION_ENABLED','true')
if not os.getenv('ADMIN_SETUP_KEY'):os.environ['ADMIN_SETUP_KEY']=secrets.token_urlsafe(18)
from app import create_app
app=create_app()
print(f'\nTokenFlow is ready at {origin}\nOpen this address on both laptop and phone (same Wi-Fi).\nIf the address is incorrect, set PUBLIC_ORIGIN=http://YOUR-LAN-IP:{port}.\n')
if app.config['STORE_MODE']=='sqlite':
    from storage import SQLiteStore
    if not SQLiteStore(os.environ['SQLITE_PATH']).has_admin():print('First-admin setup key (enter in the Admin setup prompt): '+os.environ['ADMIN_SETUP_KEY'])
app.run(host='0.0.0.0',port=port,debug=False)
