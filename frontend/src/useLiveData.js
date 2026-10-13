import {useState,useEffect,useCallback,useRef} from 'react';
import {subscribe} from './api';
export function useData(loader,deps=[]){
 const [data,setData]=useState(null),[error,setError]=useState(''),[updatedAt,setUpdatedAt]=useState(null);
 const latest=useRef(loader);latest.current=loader;const lifecycle=useRef(0),pending=useRef(false);
 const refresh=useCallback(async()=>{const version=lifecycle.current;if(pending.current)return;pending.current=true;try{const next=await latest.current();if(version===lifecycle.current){setData(next);setError('');setUpdatedAt(Date.now())}}catch(e){if(version===lifecycle.current){setError(e.message);if([401,403,404,410].includes(e.status))setData(null)}}finally{if(version===lifecycle.current)pending.current=false}},deps);
 useEffect(()=>{lifecycle.current++;pending.current=false;setData(null);setError('');let active=true,unsub;refresh();const timer=setInterval(refresh,3000);const fn=()=>refresh();window.addEventListener('tokenflow-change',fn);window.addEventListener('storage',fn);window.addEventListener('online',fn);subscribe(refresh).then(u=>{if(active)unsub=u;else u()}).catch(()=>{});return()=>{active=false;lifecycle.current++;pending.current=false;clearInterval(timer);window.removeEventListener('tokenflow-change',fn);window.removeEventListener('storage',fn);window.removeEventListener('online',fn);unsub?.()}},[refresh]);
 return {data,error,refresh,updatedAt};
}
