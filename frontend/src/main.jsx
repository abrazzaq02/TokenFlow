import React,{useState,useEffect,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,NavLink,Link,useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {ArrowUpRight,ArrowRight,LayoutGrid,Ticket,ChartNoAxesCombined,Settings,Landmark,HeartPulse,ShieldCheck,IdCard,Zap,Clock,Users,Check,ChevronRight,Search,Bell,Plus,Download,LogOut,Menu,X,CheckCircle2,Activity,ScanLine,RefreshCw,SlidersHorizontal,Play,Square,Copy,MapPin,ExternalLink} from 'lucide-react';
import {ResponsiveContainer,AreaChart,Area,XAxis,YAxis,Tooltip,CartesianGrid,BarChart,Bar} from 'recharts';
import QRCode from 'qrcode';
import {api,publicApi,showcase,demoMode,mode,registerUser,loginUser,loginAdmin,setupAdmin,adminSetupAvailable,logout,subscribe} from './api';
import './styles.css';
import {useData} from './useLiveData';
import {NowServing,Recommendations,Comparison,useTicketAlerts} from './queue-ui';
const icons={bank:Landmark,hospital:HeartPulse,police:ShieldCheck,government:IdCard,utility:Zap};
const colors={bank:'purple',hospital:'pink',police:'blue',government:'orange',utility:'green'};
const moneyTime=v=>v===null?'Paused':`${Math.ceil(v||0)} min`;
const pretty=s=>({skipped:'No-show',called:'Your turn',serving:'In service',waiting:'In queue',completed:'Completed',cancelled:'Cancelled'}[s]||s);
function Icon({type,...props}){const C=icons[type]||Landmark;return <C {...props}/>}
function Button({children,onClick,kind='',disabled=false,...props}){return <button className={`btn ${kind}`} onClick={onClick} disabled={disabled} {...props}>{children}</button>}
function QR({value,size=160}){const [url,setUrl]=useState(''),[error,setError]=useState('');useEffect(()=>{let live=true;setUrl('');setError('');if(value)QRCode.toDataURL([{data:value,mode:'byte'}],{width:Math.max(512,size*3),margin:4,errorCorrectionLevel:'M',color:{dark:'#242130',light:'#ffffff'}}).then(u=>live&&setUrl(u)).catch(()=>live&&setError('QR generation failed. Use the tracking link below.'));return()=>{live=false}},[value,size]);return error?<p role="alert">{error}</p>:url?<img className="qr" src={url} width={size} height={size} alt="Scan to open this ticket"/>:<div style={{width:size,height:size}} aria-label="Preparing QR code"/>}

function App() {
  const [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false);
  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4500);
  };
  return (
    <BrowserRouter>
      <div className="app">
        <aside className={mobile ? "sidebar show" : "sidebar"}>
          <Link to="/home" className="brand" onClick={() => setMobile(false)}>
            <img src="/logo.svg" />
            Token<span>Flow</span>
            <span className="brand-dot">®</span>
          </Link>
          <div className="workspace">
            <span className="workspace-icon">
              <Zap size={18} />
            </span>
            <div>
              Public services<small>Your everyday, upgraded</small>
            </div>
            <span className="live-dot" />
          </div>
          <nav>
            <div className="nav-label">CUSTOMER PORTAL</div>
            <NavLink to="/home" end onClick={() => setMobile(false)}>
              <LayoutGrid size={19} />Overview
              <span className="nav-bubble">5</span>
            </NavLink>
            <NavLink to="/tickets" onClick={() => setMobile(false)}>
              <Ticket size={19} />My tickets
            </NavLink>
            <div className="nav-label nav-label-spaced">ADMINISTRATION</div>
            <NavLink to="/admin" onClick={() => setMobile(false)}>
              <SlidersHorizontal size={19} />Admin dashboard
            </NavLink>
            <NavLink to="/analytics" onClick={() => setMobile(false)}>
              <ChartNoAxesCombined size={19} />Analytics
            </NavLink>
            <div className="nav-label nav-label-spaced">PREFERENCES</div>
            <NavLink to="/settings" onClick={() => setMobile(false)}>
              <Settings size={19} />Settings
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="time-card">
              <div className="spark">✦</div>
              <strong>
                Life’s too short
                <br />
                for long queues.
              </strong>
              <p>
                Get a ticket.
                <br />
                Go live your day.
              </p>
              <Link to="/home#services">
                Find a service <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="profile">
              <span className="avatar">Y</span>
              <div>
                Your workspace
                <small>
                  {showcase || demoMode ? "Interactive demo" : "Connected portal"}
                </small>
              </div>
              <span className="live-dot" />
            </div>
          </div>
        </aside>
        <main>
          <header>
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle navigation"
            >
              <Menu />
            </button>
            <div className="breadcrumb">
              Workspace <ChevronRight size={14} />
              <span>TokenFlow</span>
            </div>
            <div className="header-right">
              <span className={`mode${demoMode ? " demo-mode" : ""}`}>
                <span className="live-dot" />
                {demoMode
                  ? "Demo Mode"
                  : showcase
                    ? "Demo playground"
                    : mode === "firebase"
                      ? "Live services"
                      : "Local API demo"}
              </span>
              <Link
                className="icon-button"
                to="/tickets"
                aria-label="My ticket notifications"
              >
                <Bell size={20} />
              </Link>
              <span className="avatar small">Y</span>
            </div>
          </header>
          <div className="page">
            <Routes>
              <Route path="/" element={<Access notify={notify} />} />
              <Route path="/home" element={<CustomerOnly notify={notify}><Home notify={notify} /></CustomerOnly>} />
              <Route path="/tickets" element={<CustomerOnly notify={notify}><Tickets notify={notify} /></CustomerOnly>} />
              <Route path="/track/:id" element={<Track notify={notify} />} />
              <Route path="/admin" element={<Admin notify={notify} />} />
              <Route
                path="/analytics"
                element={<Admin analyticsOnly notify={notify} />}
              />
              <Route
                path="/settings"
                element={<SettingsPage notify={notify} />}
              />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>Page not found</h1>
                    <Link to="/">Back to account options</Link>
                  </div>
                }
              />
            </Routes>
            <footer>
              <span>© {new Date().getFullYear()} TokenFlow</span>
              <span>
                Less waiting. More living.{" "}
                <span className="purple-text">✦</span>
              </span>
            </footer>
          </div>
        </main>
        {toast && (
          <div role="status" className="toast">
            <CheckCircle2 size={20} />
            {toast}
          </div>
        )}
      </div>
    </BrowserRouter>
  );
}
function CustomerOnly({ children, notify }) {
  const signedIn =
    demoMode || sessionStorage.getItem("tf-user") === "yes";
  const [,render]=useState(0);useEffect(()=>{const expired=()=>render(n=>n+1);addEventListener("tokenflow-auth-expired",expired);return()=>removeEventListener("tokenflow-auth-expired",expired)},[]);
  return signedIn ? children : <Access notify={notify} />;
}

function Access({ notify }) {
  const [creating, setCreating] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (
      sessionStorage.getItem("tf-user") === "yes"
    ) {
      navigate(`/home${location.search}`, { replace: true });
    }
  }, [navigate]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (creating) await registerUser(name, email, password);
      else await loginUser(email, password);
      notify(creating ? "Your account is ready." : "Welcome back.");
      navigate(`/home${location.search}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="WELCOME TO TOKENFLOW"
        title="Choose your portal."
        subtitle="Sign in or create an account to continue."
      />
      <div className="portal-choices">
        <section className="portal-choice">
          <span className="service-icon purple"><Users /></span>
          <h2>User</h2>
          <p>Create an account to save tickets and follow your queue.</p>
          <div className="portal-actions">
            <Button kind="primary" onClick={() => { setCreating(true); setError(""); }}>
              Create account
            </Button>
            <Button kind="soft" onClick={() => { setCreating(false); setError(""); }}>
              Log in
            </Button>
          </div>
        </section>
        <section className="portal-choice admin-choice">
          <span className="service-icon green"><ShieldCheck /></span>
          <h2>Admin</h2>
          <p>Sign in to manage counters, service queues, and analytics.</p>
          <Link className="btn dark" to="/admin">Admin login or account setup <ArrowRight size={17}/></Link>
        </section>
      </div>
      <section className="login-card user-login-card">
        <h2>{creating ? "Create your User account" : "Log in as User"}</h2>
        <div className="auth-switch" role="group" aria-label="User account action">
          <button type="button" className={creating ? "active" : ""} onClick={() => { setCreating(true); setError(""); }}>Create account</button>
          <button type="button" className={!creating ? "active" : ""} onClick={() => { setCreating(false); setError(""); }}>Log in</button>
        </div>
        <form onSubmit={submit}>
          {creating && <label>Name<input autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>}
          <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete={creating ? "new-password" : "current-password"} required minLength={8} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <ErrorBox text={error} />}
          <Button kind="primary full" disabled={busy}>{busy ? "Please wait…" : creating ? "Create User account" : "Log in as User"}<ArrowRight size={17}/></Button>
        </form>
      </section>
    </>
  );
}

function Home({ notify }) {
  const { data, error, refresh } = useData(() => api("/departments"));
  const mine = useData(() => api("/tokens"));
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (data && params.get("service")) {
      setSelected(data.departments.find((d) => d.id === params.get("service")));
      setParams({}, { replace: true });
    }
  }, [data, params]);
  useTicketAlerts(mine.data?.find(t=>t.status==="called"||t.status==="waiting"&&t.notificationState),notify);
  const ds = data?.departments || [],
    active = mine.data?.find((t) =>
      ["waiting", "called", "serving"].includes(t.status),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE LESS WAIT. A LOT MORE DAY.</div>
          <h1>
            Your time. <span>Reclaimed.</span>
          </h1>
          <p>Pick a service, grab a token, and we’ll keep your place.</p>
        </div>
        <span className="date-pill">
          <span className="live-dot" />
          All systems ready
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-tag">
            <Zap size={13} /> THE SMARTER WAY TO WAIT
          </span>
          <h2>
            Skip the queue.
            <br />
            Keep your <span>flow.</span>
          </h2>
          <p>
            Your next bank visit, hospital appointment, or paperwork run — minus
            the standing around.
          </p>
          <a className="btn lime" href="#services">
            Get your token <ArrowUpRight size={18} />
          </a>
          <span className="hero-note">Free to use. Easy to follow.</span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-circle">✦</div>
          <div className="hero-ticket">
            <div className="mini-brand">
              <img src="/logo.svg" /> TokenFlow <span>↗</span>
            </div>
            <span className="ticket-caption">MORE LIFE. LESS LINE.</span>
            <div className="hero-ticket-number">
              YOU’RE
              <br />
              UP NEXT.
            </div>
            <div className="ticket-dashes" />
            <div className="ticket-bottom">
              <div>
                <span>YOUR DAY</span>
                <strong>Uninterrupted.</strong>
              </div>
              <ScanLine size={37} />
            </div>
          </div>
          <span className="float-label">
            <CheckCircle2 size={16} /> Your spot is saved.
          </span>
        </div>
      </section>
      <div className="stats-row">
        <Stat
          label="Services, one place"
          value={ds.length || "5"}
          icon={LayoutGrid}
          detail="Everyday essentials"
        />
        <Stat
          label="Counters open"
          value={ds.reduce((n, d) => n + d.openCounters, 0)}
          icon={Activity}
          detail="Ready to help you"
        />
        <Stat
          label="Currently in queue"
          value={ds.reduce((n, d) => n + d.waiting, 0)}
          icon={Users}
          detail={showcase || demoMode ? "Simulated visitors" : "Across all services"}
        />
        <Stat
          label="Your active tickets"
          value={
            mine.data?.filter((t) =>
              ["waiting", "called", "serving"].includes(t.status),
            ).length || 0
          }
          icon={Ticket}
          detail="All in one place"
        />
      </div>
      <NowServing items={ds.flatMap(d=>(d.nowServing||[]).map(t=>({...t,counterName:`${d.name} · ${t.counterName}`})))}/>
      <div className="content-grid">
        <section id="services">
          <div className="section-head">
            <div>
              <h2>
                Where are we headed? <span className="count">05</span>
              </h2>
              <p>Choose a service to get started.</p>
            </div>
            <div className="search">
              <Search size={16} />
              <input
                aria-label="Search services"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a service..."
              />
            </div>
          </div>
          {error && <ErrorBox text={error} />}
          <div className="service-grid">
            {ds
              .filter((d) =>
                (d.name + d.branch)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((d) => (
                <button
                  className={`service-card ${colors[d.id] || "purple"}`}
                  key={d.id}
                  onClick={() => setSelected(d)}
                >
                  <div className="service-top">
                    <span className="service-icon">
                      <Icon type={d.id} size={24} />
                    </span>
                    <ArrowUpRight className="card-arrow" size={20} />
                  </div>
                  <h3>{d.name}</h3>
                  <p>{d.description}</p>
                  <div className="service-meta">
                    <span>
                      <span className="live-dot" />
                      {d.openCounters} counters open
                    </span>
                    <span>
                      <Clock size={13} />
                      {moneyTime(d.estimatedWait)}
                    </span>
                  </div>
                </button>
              ))}
          </div>
          {!ds.length && !error && (
            <div className="empty">Loading services…</div>
          )}
          {ds.length > 0 &&
            !ds.some((d) =>
              (d.name + d.branch).toLowerCase().includes(search.toLowerCase()),
            ) && <div className="empty">No matching services.</div>}
          <div className="service-foot">
            <ShieldCheck size={16} /> Routine public services. For emergencies,
            contact local emergency services.
          </div>
        </section>
        <aside className="right-column">
          <div className="queue-widget">
            <div className="section-head">
              <h3>Your next stop</h3>
              <span className="tiny-label">LIVE</span>
            </div>
            {active ? (
              <>
                <div className="small-label">ACTIVE TOKEN</div>
                <div className="widget-number">{active.tokenNumber}</div>
                <span className={`badge ${active.status}`}>
                  {pretty(active.status)}
                </span>
                <div className="widget-details">
                  <span>
                    Position<strong>{active.position || "—"}</strong>
                  </span>
                  <span>
                    Est. wait
                    <strong>{moneyTime(active.estimatedWaitMinutes)}</strong>
                  </span>
                </div>
                <Link className="btn dark full" to={`/track/${active.id}`}>
                  Track my ticket <ArrowRight size={16} />
                </Link>
              </>
            ) : (
              <>
                <div className="empty-ticket">
                  <Ticket size={38} />
                </div>
                <h4>Your day is wide open.</h4>
                <p>
                  No active tickets yet. Choose a service and we’ll save your
                  spot.
                </p>
                <a className="btn soft full" href="#services">
                  Find your service <ArrowRight size={16} />
                </a>
              </>
            )}
          </div>
          <div className="how-card">
            <span className="eyebrow">GOODBYE, GUESSWORK.</span>
            <h3>
              Three steps.
              <br />
              Zero standing around.
            </h3>
            {[
              ["01", "Pick your service", "Choose where you need to go."],
              ["02", "Grab a digital ticket", "Your place, saved in seconds."],
              ["03", "Show up on your turn", "We’ll keep you in the loop."],
            ].map(([n, t, d]) => (
              <div className="how-step" key={n}>
                <span>{n}</span>
                <div>
                  <strong>{t}</strong>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
      {(showcase || demoMode) && (
        <div className="demo-notice">
          <Zap size={17} />
          <span>
            <strong>You’re in the demo playground.</strong> Tickets and queues
            stay in this browser. Try the Admin dashboard to see wait times
            change.
          </span>
          <Link to="/admin">
            Try it <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
      {selected && (
        <Booking
          department={selected}
          onClose={() => setSelected(null)}
          notify={notify}
          refresh={refresh}
        />
      )}
    </>
  );
}
function Stat({label,value,icon:C,detail}){return <div className="stat"><span className="stat-icon"><C size={18}/></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>}
function ErrorBox({text}){return <div className="error" role="alert">{text}</div>}
function Booking({department:d,onClose,notify}){const [service,setService]=useState(d.services[0]),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const [key]=useState(()=>crypto.randomUUID());const navigate=useNavigate();async function submit(e){e.preventDefault();setBusy(true);try{const t=await api('/tokens','POST',{departmentId:d.id,service,displayName:name,requestId:key});notify('Your spot is saved. You’re good to go!');onClose();navigate(`/track/${t.id}`)}catch(e){setError(e.message)}finally{setBusy(false)}}return <div className="modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="booking-title" className="modal" onClick={e=>e.stopPropagation()}><button className="close icon-button" onClick={onClose} aria-label="Close"><X/></button><span className={`service-icon ${colors[d.id]}`}><Icon type={d.id}/></span><h2 id="booking-title">Save your spot.</h2><p>{d.name} · {d.branch}</p><form onSubmit={submit}><label>Service<select value={service} onChange={e=>setService(e.target.value)}>{d.services.map(s=><option key={s}>{s}</option>)}</select></label><label>Your name <span>(optional)</span><input autoFocus maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="What should we call you?"/></label><div className="booking-info"><Clock size={19}/><div>Estimated queue wait: <strong>{moneyTime(d.estimatedWait)}</strong><small>Estimates change as customers are served.</small></div></div>{error&&<ErrorBox text={error}/>}<Button kind="primary full" disabled={busy}>{busy?'Saving your spot…':'Generate my ticket'}<ArrowRight size={18}/></Button></form><div className="branch-qr"><QR value={`${import.meta.env.VITE_PUBLIC_ORIGIN||location.origin}/?service=${d.id}`} size={65}/><span>Branch check-in QR<small>Scan to open this service.</small></span></div></section></div>}
function Tickets({notify}){const {data,error,refresh}=useData(()=>api('/tokens'));return <><PageTitle eyebrow="YOUR POCKET-SIZED QUEUE" title="My tickets" subtitle="Every visit. Every update. Right here."/><div className="tickets-grid">{data?.slice().reverse().map(t=><Link key={t.id} to={`/track/${t.id}`} className="ticket-list-card"><span className={`badge ${t.status}`}>{pretty(t.status)}</span><h2>{t.tokenNumber}</h2><p>{t.service}</p><div><Clock size={15}/>{moneyTime(t.estimatedWaitMinutes)}<ArrowUpRight size={20}/></div></Link>)}</div>{error&&<ErrorBox text={error}/>} {data?.length===0&&<div className="empty"><Ticket size={40}/><h2>No tickets. No worries.</h2><p>Your first saved spot is one click away.</p><Link className="btn primary" to="/">Explore services <ArrowRight size={17}/></Link></div>}</>}
function Track({notify}){
 const {id}=useParams();const key=new URLSearchParams(location.hash.slice(1)).get('key')||'';
 const [share,setShare]=useState(''),[shareError,setShareError]=useState(''),[busy,setBusy]=useState(false),[owns,setOwns]=useState(false);
 const {data:t,error,refresh,updatedAt}=useData(async()=>{if(key)return publicApi(`/public/tokens/${id}`,key);const result=await api(`/tokens/${id}`);return result.ticket},[id,key]);
 useEffect(()=>{let active=true;setOwns(false);setShare(key?location.href:'');setShareError('');api(`/tokens/${id}`).then(async r=>{if(!active)return;setOwns(r.isOwner===true);if(r.isOwner&&!key){const result=await api(`/tokens/${id}/share`,'POST',{});if(active)setShare(result.url)}}).catch(e=>{if(active&&!key)setShareError(e.message)});return()=>{active=false}},[id,key]);
 useTicketAlerts(t,notify);
 const fmt=seconds=>seconds?new Intl.DateTimeFormat('en-PK',{dateStyle:'medium',timeStyle:'short',timeZone:t?.timezone||'Asia/Karachi'}).format(new Date(seconds*1000)):'—';
 async function cancel(){if(!confirm('Cancel this ticket and release your place?'))return;setBusy(true);try{await api(`/tokens/${id}/cancel`,'POST',{});await refresh();notify('Ticket cancelled.')}catch(e){notify(e.message)}finally{setBusy(false)}}
 async function renew(){setBusy(true);try{await api(`/tokens/${id}/revoke-share`,'POST',{});const result=await api(`/tokens/${id}/share`,'POST',{});setShare(result.url);notify('New QR ready. Previous QR links no longer work.')}catch(e){notify(e.message)}finally{setBusy(false)}}
 async function permit(){if(!('Notification' in window))return notify('Use the in-app alerts on this browser.');try{const p=await Notification.requestPermission();notify(p==='granted'?'Browser alerts enabled while TokenFlow is open.':'In-app alerts remain available.')}catch{notify('Browser permission is unavailable. In-app alerts remain active.')}}
 return <><PageTitle eyebrow="YOUR DIGITAL TICKET" title="Go live your day." subtitle="Your place and progress, in one view."/>{error&&<div className="error" role="alert">{t?'Connection interrupted. The ticket below may be outdated. ':''}{error}{!t&&<p><Link to="/">Sign in as the ticket owner to get a new QR.</Link></p>}</div>}{!t&&!error&&<div className="empty">Loading your ticket…</div>}{t&&<div className="track-layout"><div className="real-ticket"><div className="real-ticket-head"><div className="brand"><img src="/logo.svg" alt="TokenFlow"/>TokenFlow</div><span className={`badge ${t.status}`}>{pretty(t.status)}</span></div><span className="eyebrow">{t.category}</span><h2>{t.tokenNumber}</h2><h3>{t.service}</h3><p><strong>{t.displayName||'Guest visitor'}</strong> · {t.branch}</p><p>Issued {fmt(t.issueTime)} · {t.timezone||'Asia/Karachi'}</p><div className="ticket-dashes"/><div className="track-stats"><div><span>QUEUE POSITION</span><strong>{t.status==='waiting'?`#${t.position}`:['called','serving'].includes(t.status)?'Your turn':'—'}</strong>{t.status==='waiting'&&<small>{t.peopleAhead} people ahead</small>}</div><div><span>ESTIMATED WAIT</span><strong>{t.status==='waiting'?moneyTime(t.estimatedWaitMinutes):'—'}</strong></div></div><div className={`ticket-instruction ${t.status}`} role="status"><Bell size={20}/><strong>{t.message}</strong></div>{t.estimatedTurnTime&&<p className="estimated-turn">Approximate turn: <strong>{fmt(t.estimatedTurnTime)}</strong><br/><small>This is an estimate, not a fixed appointment.</small></p>}<NowServing items={t.nowServing||[]} branch={t.branch}/>{t.branchInstructions&&<div className="branch-instructions"><strong>Before your visit</strong><p>{t.branchInstructions}</p></div>}<div className="qr-section">{share?<QR value={share} size={180}/>:<div className="muted">{shareError||'Preparing your QR…'}</div>}<div><strong>Scan. Open. See your ticket.</strong><p>{showcase||demoMode?'Browser-only simulated data. Use connected API mode to share queue updates across devices.':'Scan with your camera, then tap the link. It opens these live details without a login.'}</p><small>Read-only link · Expires after 48 hours · In-app alerts active</small></div></div>{share&&<p className="qr-link"><a href={share} target="_blank" rel="noreferrer">Open the same link on another device <ExternalLink size={13}/></a></p>}{share&&/^https?:\/\/(localhost|127.0.0.1)(:|\/)/.test(share)&&<div className="error">This QR uses localhost and cannot open on another phone. Run <code>python run_demo.py</code> from the project root and use the printed LAN address, or configure PUBLIC_ORIGIN.</div>}<div className="ticket-actions"><Button kind="primary" onClick={()=>window.print()}><Download size={17}/> Print / save PDF</Button><Button kind="soft" disabled={!share} onClick={async()=>{try{await navigator.clipboard.writeText(share);notify('Tracking link copied.')}catch{prompt('Copy your tracking link',share)}}}><Copy size={17}/> Copy link</Button>{owns&&<Button kind="soft" disabled={busy} onClick={renew}>Replace QR link</Button>}</div><p className="connection-state"><span className={error?'':'live-dot'}/>{error?'Connection interrupted':`Updated ${updatedAt?new Date(updatedAt).toLocaleTimeString():''} · refreshes every 3 seconds`}</p></div><div><div className="how-card"><Bell className="purple-text" size={30}/><h2>We’ll give you a heads-up.</h2><p>Get an alert when three or fewer people are ahead, and another when your token is called. Keep TokenFlow open.</p><Button kind="dark full" onClick={permit}>Enable browser alerts <Bell size={16}/></Button></div><div className="track-note"><Clock size={20}/><p>Service times vary. Follow the live call and counter instructions. Keep your QR private: anyone with the link can view this ticket’s limited details.</p></div>{owns&&t.status==='waiting'&&<Button kind="danger full" onClick={cancel} disabled={busy}>Cancel my ticket</Button>}{owns&&<Link className="back-link" to="/tickets">My tickets <ArrowRight size={16}/></Link>}</div></div>}</>;
}

function PageTitle({ eyebrow, title, subtitle, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
function Admin({ notify, analyticsOnly = false }) {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(
    !!sessionStorage.getItem("tf-admin"),
  );
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);
  useEffect(() => {
    adminSetupAvailable()
      .then(setSetupAvailable)
      .catch(() => setSetupAvailable(false));
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await loginAdmin(email, password);
      setAuthorized(true);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function createAdmin() {
    setBusy(true);
    try {
      const key=showcase?"":prompt("Enter the setup key printed in the server terminal");
      if(key===null)return;
      setCredentials(await setupAdmin(key));
      setAuthorized(true);
      setSetupAvailable(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!authorized)
    return (
      <>
        <PageTitle
          eyebrow="ADMIN ACCESS"
          title="Good service starts here."
          subtitle="Sign in with your Admin credentials."
        />
        <div className="login-card">
          <span className="service-icon purple">
            <ShieldCheck />
          </span>
          <h2>Admin sign in</h2>
          {demoMode && (
            <p className="demo-login-note">
              Demo Mode accepts any valid email address and a non-empty password.
            </p>
          )}
          <form onSubmit={submit}>
            <label>
              Email
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Password
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <ErrorBox text={error} />}
            <Button kind="primary full" disabled={busy}>
              {busy ? "Signing in…" : "Log in as Admin"}
              <ArrowRight size={17} />
            </Button>
          </form>
          {setupAvailable && (
            <div className="account-setup">
              <p>No Admin account exists yet.</p>
              <Button kind="soft full" disabled={busy} onClick={createAdmin}>
                Create temporary Admin credentials
              </Button>
            </div>
          )}
        </div>
      </>
    );
  return (
    <>
      {credentials && (
        <div className="credentials-notice">
          <strong>Save these temporary Admin credentials</strong>
          <p>They are shown once. Keep them somewhere private.</p>
          <label>Email<code>{credentials.email}</code></label>
          <label>Password<code>{credentials.password}</code></label>
          <Button kind="soft" onClick={() => setCredentials(null)}>I saved them</Button>
        </div>
      )}
      <Dashboard
        notify={notify}
        analyticsOnly={analyticsOnly}
        signout={async () => {
          await logout();
          setAuthorized(false);
          navigate("/", { replace: true });
        }}
      />
    </>
  );
}
function Dashboard({ notify, analyticsOnly, signout }) {
  useEffect(()=>{const expired=()=>signout();addEventListener("tokenflow-auth-expired",expired);return()=>removeEventListener("tokenflow-auth-expired",expired)},[signout]);
  const { data: s, error, refresh } = useData(() => api("/dashboard"));
  const [dept, setDept] = useState("bank"),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("active");
  async function action(path, p = {}) {
    setBusy(true);
    try {
      await api(path, "POST", p);
      await refresh();
      notify("Queue updated.");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (s?.counters.length && !s.counters.some((c) => c.departmentId === dept))
      setDept(s.counters[0].departmentId);
  }, [s, dept]);
  const ds = s?.departments || [],
    cs = s?.counters.filter((c) => c.departmentId === dept) || [],
    ts = s?.tokens.filter((t) => t.departmentId === dept) || [],
    stats = s?.analytics;
  return (
    <>
      <PageTitle
        eyebrow="THE CONTROL ROOM"
        title={analyticsOnly ? "Numbers that matter." : "Keep things moving."}
        subtitle={
          analyticsOnly
            ? "Measured service activity, not guesswork."
            : "A better flow for your team and everyone in line."
        }
      >
        <Button kind="soft" onClick={signout}>
          <LogOut size={16} /> Sign out
        </Button>
      </PageTitle>
      {error && <ErrorBox text={error} />}{" "}
      {stats && (
        <>
          <div className="stats-row">
            <Stat
              label="Tickets issued"
              value={stats.issued}
              icon={Ticket}
              detail="Current dataset"
            />
            <Stat
              label="Currently waiting"
              value={stats.waiting}
              icon={Users}
              detail="Across your branches"
            />
            <Stat
              label="Completed visits"
              value={stats.completed}
              icon={CheckCircle2}
              detail="Finished service"
            />
            <Stat
              label="Avg. actual wait"
              value={stats.waitSampleCount?moneyTime(stats.averageWait):"—"}
              icon={Clock}
              detail={`${stats.waitSampleCount??0} recorded service starts`}
            />
          </div>
          {!analyticsOnly && (
            <>
              <div className="admin-toolbar">
                <label>
                  Manage service
                  <select
                    value={dept}
                    onChange={(e) => setDept(e.target.value)}
                  >
                    {ds
                      .filter((d) =>
                        s.counters.some((c) => c.departmentId === d.id),
                      )
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {d.branch}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="simulation">
                  <span>
                    <Zap size={15} /> Simulation
                  </span>
                  <Button
                    kind="soft"
                    disabled={busy}
                    onClick={() =>
                      action("/simulate", { departmentId: dept, count: 1 })
                    }
                  >
                    <Plus size={16} /> Add visitor
                  </Button>
                  <Button
                    kind="primary"
                    disabled={busy}
                    onClick={() =>
                      action("/simulate", { departmentId: dept, count: 5 })
                    }
                  >
                    Demand surge +5
                  </Button>
                </div>
              </div>
              <Recommendations items={s.recommendations||[]} departmentId={dept} onOpen={id=>action(`/counters/${id}/open`)} busy={busy}/>
              <NowServing items={(ds.find(d=>d.id===dept)?.nowServing)||[]}/>
              <div className="section-head">
                <h2>Counter lineup</h2>
                <span className="muted">
                  Closing a counter preserves active service.
                </span>
              </div>
              <div className="counter-grid">
                {cs.map((c) => {
                  const t = ts.find((t) => t.id === c.currentTokenId);
                  return (
                    <div className="counter-card" key={c.id}>
                      <div className="section-head">
                        <strong>{c.name}</strong>
                        <button
                          aria-label={`${c.isOpen ? "Close" : "Open"} ${c.name}`}
                          className={`toggle ${c.isOpen ? "on" : ""}`}
                          disabled={busy}
                          onClick={() =>
                            action(
                              `/counters/${c.id}/${c.isOpen ? "close" : "open"}`,
                            )
                          }
                        >
                          <span />
                        </button>
                      </div>
                      <span className="small-label">
                        {c.isOpen
                          ? "OPEN FOR SERVICE"
                          : t
                            ? "CLOSING AFTER CURRENT VISIT"
                            : "COUNTER CLOSED"}
                      </span>
                      <div className="counter-number">
                        {t?.tokenNumber || "—"}
                      </div>
                      <p>
                        {t
                          ? `${t.service} · ${pretty(t.status)}`
                          : c.isOpen
                            ? "Ready for the next visitor"
                            : "Taking a pause"}
                      </p>
                      {!t ? (
                        <Button
                          kind="dark full"
                          disabled={busy || !c.isOpen}
                          onClick={() => action(`/counters/${c.id}/next`)}
                        >
                          Call next <ArrowRight size={16} />
                        </Button>
                      ) : (
                        <div className="counter-actions">
                          <Button
                            kind="primary"
                            disabled={busy}
                            onClick={() =>
                              action(
                                `/tokens/${t.id}/${t.status === "called" ? "start" : "complete"}`,
                              )
                            }
                          >
                            {t.status === "called" ? (
                              <Play size={15} />
                            ) : (
                              <Check size={15} />
                            )}
                            {t.status === "called"
                              ? "Start service"
                              : "Complete"}
                          </Button>
                          {t.status === "called" && (
                            <Button
                              kind="soft"
                              disabled={busy}
                              onClick={() => action(`/tokens/${t.id}/skip`)}
                            >
                              No-show
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <section className="queue-table-panel">
                <div className="section-head">
                  <h2>
                    Live queue{" "}
                    <span className="count">
                      {ts.filter((t) => t.status === "waiting").length}
                    </span>
                  </h2>
                  <select
                    aria-label="Filter queue"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="active">Active tickets</option>
                    <option value="all">All tickets</option>
                    <option value="skipped">No-shows</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Visitor / service</th>
                        <th>Status</th>
                        <th>Position</th>
                        <th>Est. wait</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ts
                        .filter(
                          (t) =>
                            filter === "all" ||
                            (filter === "active"
                              ? ["waiting", "called", "serving"].includes(
                                  t.status,
                                )
                              : t.status === filter),
                        )
                        .sort((a, b) => a.queueSequence - b.queueSequence)
                        .map((t) => (
                          <tr key={t.id}>
                            <td className="token-cell">{t.tokenNumber}</td>
                            <td>
                              {t.displayName || "Guest"}
                              <small>{t.service}</small>
                            </td>
                            <td>
                              <span className={`badge ${t.status}`}>
                                {pretty(t.status)}
                              </span>
                            </td>
                            <td>{t.position || "—"}</td>
                            <td>{moneyTime(t.estimatedWaitMinutes)}</td>
                            <td>
                              {t.status === "skipped" ? (
                                <Button
                                  kind="soft"
                                  disabled={busy}
                                  onClick={() =>
                                    action(`/tokens/${t.id}/recall`)
                                  }
                                >
                                  Rejoin queue
                                </Button>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="admin-config">
                <Button
                  kind="soft"
                  disabled={busy}
                  onClick={() => {
                    const name = prompt("Name for the new counter");
                    if (name?.trim())
                      action("/counters", {
                        departmentId: dept,
                        name: name.trim(),
                      });
                  }}
                >
                  <Plus size={16} /> Add counter
                </Button>
                <Button
                  kind="soft"
                  disabled={busy}
                  onClick={() => {
                    const d = ds.find((d) => d.id === dept);
                    const name = prompt("Service name", d.name);
                    if (!name?.trim()) return;
                    const branch = prompt("Branch label", d.branch);
                    if (branch?.trim())
                      action("/departments", {
                        id: dept,
                        name: name.trim(),
                        branch: branch.trim(),
                      });
                  }}
                >
                  Edit branch details
                </Button>
                <Button kind="soft" disabled={busy} onClick={()=>{const d=ds.find(d=>d.id===dept);const instructions=prompt("Optional branch instructions (up to 500 characters)",d.instructions||"");if(instructions!==null)action("/departments",{id:dept,name:d.name,branch:d.branch,instructions})}}>Edit visitor instructions</Button>
              </div>
            </>
          )}
          <Comparison notify={notify}/>
          <div className="chart-grid">
            <div className="chart-card">
              <div className="section-head">
                <div>
                  <h3>Queue rhythm</h3>
                  <p>Waiting customers after each event</p>
                </div>
                <span className="tiny-label">LIVE</span>
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={stats.history}>
                  <defs>
                    <linearGradient id="purpleFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8056eb" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8056eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 5"
                    vertical={false}
                    stroke="#eceaf1"
                  />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(v) =>
                      new Date(v * 1000).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
                    tick={{ fontSize: 10 }}
                    minTickGap={45}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={25}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    labelFormatter={(v) =>
                      new Date(v * 1000).toLocaleTimeString()
                    }
                  />
                  <Area
                    type="stepAfter"
                    dataKey="waiting"
                    stroke="#8056eb"
                    fill="url(#purpleFill)"
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <h3>Completed by counter</h3>
              <p>Based on completed service records</p>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={stats.byCounter.filter((c) => c.completed > 0)}>
                  <CartesianGrid vertical={false} stroke="#eceaf1" />
                  <XAxis dataKey="id" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} width={25} />
                  <Tooltip />
                  <Bar
                    dataKey="completed"
                    fill="#b6d66a"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
              {!stats.completed && (
                <small className="muted">
                  Complete a visit to start building your service history.
                </small>
              )}
            </div>
          </div>
          <div className="metrics-note">
            Average service duration:{" "}
            <strong>{stats.serviceSampleCount?moneyTime(stats.averageService):"No completed visits yet"}</strong> · Historical
            averages use recorded service timestamps. Queue estimates are shown separately. {stats.predictionSampleCount>0&&<span> Initial-estimate mean absolute error: <strong>{stats.predictionMae} min</strong> across {stats.predictionSampleCount} started visits.</span>}
          </div>
        </>
      )}
    </>
  );
}
function SettingsPage({ notify }) {
  const navigate = useNavigate();
  const accountRole = sessionStorage.getItem("tf-admin") === "yes" ? "admin" : "customer";
  return (
    <>
      <PageTitle
        eyebrow="MAKE IT YOURS"
        title="Small settings. Better flow."
        subtitle="Your account preferences and demo tools."
      ><Button kind="soft" onClick={async () => { await logout(accountRole); navigate("/"); }}><LogOut size={16}/> Sign out</Button></PageTitle>
      <div className="settings-card">
        <Bell />
        <div>
          <h3>Browser notifications</h3>
          <p>Receive alerts while TokenFlow is open.</p>
        </div>
        <Button
          kind="soft"
          onClick={async () => {
            if (!("Notification" in window))
              return notify("Notifications are not supported by this browser.");
            notify(
              `Notification permission: ${await Notification.requestPermission()}`,
            );
          }}
        >
          Enable
        </Button>
      </div>
      <div className="settings-card">
        <ShieldCheck />
        <div>
          <h3>
            {showcase || demoMode
              ? "Browser demo mode"
              : mode === "firebase"
                ? "Firebase mode"
                : "Local backend mode"}
          </h3>
          <p>
            {showcase || demoMode
              ? "Synthetic data stays in this browser. No real appointments are booked."
              : "Your requests are handled by the configured Flask backend."}
          </p>
        </div>
        <span className="badge completed">Active</span>
      </div>
      {(showcase || demoMode) && (
        <div className="settings-card">
          <RefreshCw />
          <div>
            <h3>Fresh start</h3>
            <p>Clear all demo tickets and restore sample queues.</p>
          </div>
          <Button
            kind="danger"
            onClick={async () => {
              if (
                confirm(
                  "Delete all browser demo tickets and restore sample queues?",
                )
              ) {
                await api("/reset", "POST", {});
                notify("Demo reset. Ready for another run.");
              }
            }}
          >
            Reset demo
          </Button>
        </div>
      )}
      <div className="how-card">
        <h3>Built for everyday services.</h3>
        <p>
          TokenFlow handles routine bank, hospital, police, government, and
          utility visits. Queue position is updated live; estimated waits change
          with demand and counter availability.
        </p>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
