import*as db from '../db/idb.js';import{list,enc,blobOp,blobBytes}from '../services/records.js';import{digits}from '../domain/validators.js';
import{buildBackup,LISTS}from './backup-format.js';
export{readBackup}from './backup-format.js';
export async function createBackup(password){
  const[clients,debts,documents,history,installment_plans]=await Promise.all(LISTS.map(list));
  const files=new Map();
  for(const id of[...clients.map(c=>c.photoId),...documents.map(d=>d.blobId)].filter(Boolean)){try{files.set(id,await blobBytes(id))}catch{throw new Error('Um arquivo anexado está ausente ou ilegível; o backup foi cancelado para não ficar incompleto.')}}
  const settings={dueWindow:(await db.get('settings','dueWindow'))?.value??7};
  return buildBackup({clients,debts,documents,history,installment_plans,settings,files,dbVersion:db.DB_VERSION},password);
}
// Tudo é preparado (e cifrado) ANTES de tocar no banco; a troca acontece em UMA transação: ou tudo ou nada.
export async function restore(d,mode){
  const ops=[],S=Object.fromEntries(LISTS.map(k=>[k,0]));
  if(mode==='replace'){
    for(const s of[...LISTS,'blobs'])for(const r of await db.getAll(s))ops.push(['delete',s,r.id]);
    for(const k of LISTS){for(const r of d[k])ops.push(await enc(k,r));S[k]=d[k].length}
    for(const[id,b]of d.files)ops.push(await blobOp(id,b));
    ops.push(['put','settings',{key:'dueWindow',value:d.settings?.dueWindow??7}]);
  }else{
    const cur=Object.fromEntries(await Promise.all(LISTS.map(async k=>[k,await list(k)]))),ids=Object.fromEntries(LISTS.map(k=>[k,new Set(cur[k].map(r=>r.id))]));
    const byDoc=new Map(cur.clients.map(c=>[digits(c.doc),c.id])),map=new Map();
    const targetDebts=new Map(cur.debts.map(d=>[d.id,d])),plannedDebts=new Set(cur.installment_plans.map(p=>p.debtId));
    for(const c of d.clients){const t=ids.clients.has(c.id)?c.id:byDoc.get(digits(c.doc));if(t){map.set(c.id,t);continue}   // mesmo id ou mesmo CPF/CNPJ: cliente existente prevalece
      map.set(c.id,c.id);ops.push(await enc('clients',c));if(c.photoId)ops.push(await blobOp(c.photoId,d.files.get(c.photoId)));S.clients++}
    for(const x of d.debts){if(!ids.debts.has(x.id)){const debt={...x,clientId:map.get(x.clientId)};ops.push(await enc('debts',debt));S.debts++;targetDebts.set(x.id,debt)}}
    const seen=new Set(cur.documents.map(x=>x.clientId+x.hash));
    for(const x of d.documents){const c=map.get(x.clientId);if(ids.documents.has(x.id)||seen.has(c+x.hash))continue;seen.add(c+x.hash);ops.push(await enc('documents',{...x,clientId:c}),await blobOp(x.blobId,d.files.get(x.blobId)));S.documents++}
    for(const x of d.history)if(!ids.history.has(x.id)){ops.push(await enc('history',{...x,clientId:map.get(x.clientId)}));S.history++}
    for(const p of d.installment_plans||[]){const clientId=map.get(p.clientId);if(ids.installment_plans.has(p.id)||plannedDebts.has(p.debtId))continue;
      const debt=targetDebts.get(p.debtId),paid=(p.items||[]).filter(x=>x.paidAt).reduce((sum,x)=>sum+x.amountCents,0);
      if(!debt||debt.clientId!==clientId||paid+debt.principal!==p.totalCents)throw new Error(`Não foi possível mesclar o parcelamento ${p.id}: o saldo da dívida no aparelho não corresponde ao saldo do backup. Use a restauração por substituição ou resolva a divergência antes.`);
      ops.push(await enc('installment_plans',{...p,clientId}));S.installment_plans++;plannedDebts.add(p.debtId)}
  }
  await db.batch(ops);return S;
}
