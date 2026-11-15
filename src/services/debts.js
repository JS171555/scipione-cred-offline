import*as db from '../db/idb.js';import*as M from '../domain/money.js';import{uid,list,enc,hist}from './records.js';import{listClients}from './clients.js';
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s));
const LABEL={description:'Descrição',principal:'Valor',date:'Data do registro',due:'Vencimento',notes:'Observações'};
const rec=d=>({id:d.id,clientId:d.clientId,createdAt:d.createdAt,description:d.description,principal:d.principal,rate:d.rate,date:d.date,due:d.due,notes:d.notes||'',updatedAt:d.updatedAt});
const withI=d=>({...d,interest:M.interest(d.principal,d.rate)}); // juros sempre derivados: uma única fonte da verdade
export const listDebts=async cid=>(await list('debts')).filter(d=>!cid||d.clientId===cid).map(withI).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
export function validate(d){const e={};
  if(!d.description)e.description='Informe a descrição.';
  if(!(d.principal>0&&d.principal<=1e13))e.principal='Informe um valor maior que zero.';
  if(!(d.rate>0&&d.rate<=M.MAXR))e.rate='Informe uma taxa entre 0,01% e 1000%.';
  if(!iso(d.date))e.date='Data inválida.';
  if(!iso(d.due))e.due='Informe o vencimento.';else if(!e.date&&d.due<d.date)e.due='O vencimento não pode ser anterior ao registro.';
  return e}
export async function saveDebt(clientId,d,old){
  const errs=validate(d);if(Object.keys(errs).length)throw Object.assign(new Error('Corrija os campos destacados.'),{errs});
  const now=Date.now(),r=rec({...d,id:old?.id||uid(),clientId,createdAt:old?.createdAt||now,updatedAt:now}),ops=[await enc('debts',r)];
  if(!old)ops.push(await hist(clientId,'Dívida cadastrada',`${r.description}: ${M.brl(r.principal)} a ${M.rate(r.rate)} ao mês`));
  else{
    const ch=Object.keys(LABEL).filter(k=>String(old[k]??'')!==String(r[k]??''));
    if(ch.length)ops.push(await hist(clientId,'Dívida alterada',`${r.description}: ${ch.map(k=>LABEL[k]).join(', ')}`));
    if(old.rate!==r.rate)ops.push(await hist(clientId,'Juros alterados',`${r.description}: ${M.rate(old.rate)} → ${M.rate(r.rate)}`));
  }
  await db.batch(ops);return r.id}
export const deleteDebt=async d=>db.batch([['delete','debts',d.id],await hist(d.clientId,'Dívida excluída',`${d.description}: ${M.brl(d.principal)}`)]);
export async function findByRate(r){const cs=new Map((await listClients()).map(c=>[c.id,c.name]));
  return(await listDebts()).filter(d=>d.rate===r).map(d=>({...d,clientName:cs.get(d.clientId)||'—'})).sort((a,b)=>a.clientName.localeCompare(b.clientName,'pt-BR'))}
// Aplica a prévia inteira em UMA transação; recusa se algo mudou desde a busca.
export async function applyBulk(plan){
  if(!plan.length||plan.some(p=>!p.ok))throw new Error('Há taxas inválidas na prévia.');
  const cur=new Map((await list('debts')).map(d=>[d.id,d]));
  if(plan.some(p=>cur.get(p.d.id)?.rate!==p.d.rate))throw new Error('Os dados mudaram desde a busca. Busque novamente.');
  const ops=[],now=Date.now();
  for(const{d,nr}of plan)ops.push(await enc('debts',rec({...d,rate:nr,updatedAt:now})),await hist(d.clientId,'Juros alterados em lote',`${d.description}: ${M.rate(d.rate)} → ${M.rate(nr)}`));
  await db.batch(ops)}
