// IndexedDB versionado: adicione uma função ao fim de MIGRATIONS para cada mudança de schema (nunca edite as antigas).
const MIGRATIONS=[db=>{
  db.createObjectStore('meta',{keyPath:'key'});      // cofre (salt, DEK cifrada), proteção de tentativas
  db.createObjectStore('settings',{keyPath:'key'});  // configurações gerais
  const idx=(s,...n)=>{const o=db.createObjectStore(s,{keyPath:'id'});n.forEach(x=>o.createIndex(x,x));};
  idx('clients','createdAt');idx('debts','clientId','createdAt');idx('documents','clientId');
  db.createObjectStore('blobs',{keyPath:'id'});      // fotos/documentos cifrados
  idx('history','clientId','at');
}];
export const DB_VERSION=MIGRATIONS.length;
let p;
export const openDB=()=>p||(p=new Promise((res,rej)=>{
  const r=indexedDB.open('scipione-cred',DB_VERSION);
  r.onupgradeneeded=e=>{for(let v=e.oldVersion;v<MIGRATIONS.length;v++)MIGRATIONS[v](r.result,r.transaction)};
  r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();p=null};res(r.result)};
  r.onerror=()=>{p=null;rej(r.error)};r.onblocked=()=>{p=null;rej(new Error('Feche as outras abas do SCIPIONE CRED e tente de novo.'))};
}));
// Só resolve em transaction.oncomplete: o dado está confirmado no disco.
const run=async(s,mode,fn)=>{const db=await openDB();return new Promise((res,rej)=>{
  let t,q;try{t=db.transaction(s,mode,mode==='readwrite'?{durability:'strict'}:undefined);q=fn(t)}catch(e){return rej(e)}
  t.oncomplete=()=>res(q&&q.result);t.onerror=t.onabort=()=>rej(t.error||new Error('Falha na operação do banco.'));});};
export const get=(s,k)=>run(s,'readonly',t=>t.objectStore(s).get(k));
export const getAll=s=>run(s,'readonly',t=>t.objectStore(s).getAll());
export const put=(s,v)=>run(s,'readwrite',t=>t.objectStore(s).put(v));
export const del=(s,k)=>run(s,'readwrite',t=>t.objectStore(s).delete(k));
// Várias operações em UMA transação (tudo ou nada). Cifre os dados antes: ops = [['put'|'delete', store, valor|chave]].
export const batch=async ops=>{if(!ops.length)return;const db=await openDB();return new Promise((res,rej)=>{
  const t=db.transaction([...new Set(ops.map(o=>o[1]))],'readwrite',{durability:'strict'});
  try{for(const[op,s,v]of ops)t.objectStore(s)[op](v)}catch(e){t.abort();return rej(e)}
  t.oncomplete=()=>{res();dispatchEvent(new Event('data-changed'))};t.onerror=t.onabort=()=>rej(t.error||new Error('Falha na gravação.'));});};
