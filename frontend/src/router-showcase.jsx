// Small offline showcase router; the full app uses React Router.
import React,{createContext,useContext,useState,useEffect} from 'react';
const Context=createContext({});
export function BrowserRouter({children}){const [loc,setLoc]=useState(location.pathname+location.search);useEffect(()=>{const change=()=>setLoc(location.pathname+location.search);addEventListener('popstate',change);return()=>removeEventListener('popstate',change)},[]);const navigate=(to,opts={})=>{history[opts.replace?'replaceState':'pushState']({},'',to);setLoc(location.pathname+location.search);if(!to.includes('#'))window.scrollTo(0,0)};return <Context.Provider value={{loc,navigate}}>{children}</Context.Provider>}
export const useNavigate=()=>useContext(Context).navigate;
export function Link({to,children,onClick,...props}){const go=useNavigate();return <a href={to} {...props} onClick={e=>{onClick?.(e);if(!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){e.preventDefault();go(to);if(to.includes('#'))setTimeout(()=>document.getElementById(to.split('#')[1])?.scrollIntoView(),0)}}}>{children}</a>}
export function NavLink({to,end,children,...props}){const {loc}=useContext(Context);return <Link to={to} {...props} className={(end?loc.split('?')[0]===to:loc.startsWith(to))?'active':''}>{children}</Link>}
export function Routes({children}){const {loc}=useContext(Context);const path=loc.split('?')[0];let fallback;for(const c of React.Children.toArray(children)){if(c.props.path==='*'){fallback=c.props.element;continue}const expr=new RegExp('^'+c.props.path.replace(/:[^/]+/g,'[^/]+')+'$');if(expr.test(path))return c.props.element}return fallback}
export function Route(){return null}
export function useParams(){const {loc}=useContext(Context);return {id:loc.split('?')[0].split('/')[2]}}
export function useSearchParams(){const {loc,navigate}=useContext(Context);return [new URLSearchParams(loc.split('?')[1]||''),(values,options)=>navigate(location.pathname+(Object.keys(values).length?'?'+new URLSearchParams(values):''),options)]}
