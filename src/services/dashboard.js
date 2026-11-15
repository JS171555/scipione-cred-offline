import{list}from './records.js';import{listClients}from './clients.js';import{listDebts}from './debts.js';import{getDueWindow}from './settings.js';import{status}from '../domain/due.js';
// Tudo calculado a partir do IndexedDB (nada fixo). "Ativas" = todas as dívidas cadastradas (não há quitação no escopo).
export async function stats(){
  const[cs,ds,hs,w]=await Promise.all([listClients(),listDebts(),list('history'),getDueWindow()]),names=new Map(cs.map(c=>[c.id,c.name])),sum=k=>ds.reduce((t,d)=>t+d[k],0);
  const st=ds.map(d=>status(d.due,w));
  return{principal:sum('principal'),interest:sum('interest'),clients:cs.length,debts:ds.length,overdue:st.filter(s=>s==='overdue').length,soon:st.filter(s=>s==='soon').length,
    latest:[...cs].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5),recent:hs.sort((a,b)=>b.createdAt-a.createdAt).slice(0,8).map(e=>({...e,client:names.get(e.clientId)||'—'}))}}
