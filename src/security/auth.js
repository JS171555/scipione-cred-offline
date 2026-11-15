import * as db from '../db/idb.js';
import * as C from './crypto.js';
// A chave de dados não é exportável: fica no IndexedDB como CryptoKey e só é reutilizada
// quando a mesma aba (sessionStorage) continua ativa. Fechar a aba encerra a sessão.
const SS_SID='sc.sid',SS_LAST='sc.last';
let key=null,timer=0,last=0,mins=5,sid='',saveAt=0,markAt=0;const subs=new Set();
const read=k=>{try{return sessionStorage.getItem(k)}catch{return null}};
const store=(k,v)=>{try{sessionStorage.setItem(k,v)}catch{}};
const drop=k=>{try{sessionStorage.removeItem(k)}catch{}};
const newSid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const bind=()=>{['pointerdown','keydown','touchstart','scroll'].forEach(e=>addEventListener(e,touch,{passive:true}));document.addEventListener('visibilitychange',check)};
const unbind=()=>{['pointerdown','keydown','touchstart','scroll'].forEach(e=>removeEventListener(e,touch));document.removeEventListener('visibilitychange',check)};
export const isUnlocked=()=>!!key;
export const getKey=()=>{if(!key)throw new Error('Sessão bloqueada.');return key};
export const getIdle=()=>mins;
export const onLock=f=>subs.add(f);
export const hasVault=async()=>!!(await db.get('meta','vault'));
export async function setup(pw){
  if(await hasVault())throw new Error('Já existe uma senha cadastrada.');
  const{meta}=await C.createVault(pw);
  await db.put('meta',{key:'vault',...meta});await db.put('settings',{key:'idleMinutes',value:5});
  return unlock(pw);
}
export async function unlock(pw){
  const m=await db.get('meta','vault');if(!m)throw new Error('Nenhuma senha cadastrada.');
  const g=(await db.get('meta','guard'))||{key:'guard',fails:0,until:0};
  const w=g.until-Date.now();if(w>0)throw new Error(`Aguarde ${Math.ceil(w/1000)} s para tentar novamente.`);
  try{key=await C.openVault(pw,m)}catch{
    g.fails++;if(g.fails>=5)g.until=Date.now()+Math.min(5000*2**(g.fails-5),300000);
    await db.put('meta',g);throw new Error('Senha incorreta.');
  }
  if(g.fails){g.fails=0;g.until=0;await db.put('meta',g)}
  mins=(await db.get('settings','idleMinutes'))?.value||5;
  sid=newSid();store(SS_SID,sid);last=Date.now();store(SS_LAST,String(last));
  bind();touch();await saveSession(true);
}
// Reabre a sessão somente na mesma aba e dentro do prazo de bloqueio automático.
export async function restoreSession(){
  const id=read(SS_SID);
  if(!id)return false;
  let s;try{s=await db.get('meta','session')}catch{return false}
  const valid=!!s&&s.sid===id&&s.dek&&s.dek.algorithm?.name==='AES-GCM';
  if(!valid){drop(SS_SID);drop(SS_LAST);await db.del('meta','session').catch(()=>{});return false}
  const m=await db.get('settings','idleMinutes');mins=m?.value||5;
  const seen=Number(read(SS_LAST)||s.last||0);
  if(!seen||Date.now()-seen>=mins*60000){drop(SS_SID);drop(SS_LAST);await db.del('meta','session').catch(()=>{});return false}
  key=s.dek;sid=id;last=Date.now();bind();touch();await saveSession(true);return true;
}
export async function setIdle(m){await db.put('settings',{key:'idleMinutes',value:m});mins=m;touch();await saveSession(true)}
async function saveSession(force=false){
  if(!key||!sid)return;
  const now=Date.now();store(SS_LAST,String(now));
  if(!force&&now-saveAt<1800)return;
  saveAt=now;const k=key,s=sid;
  try{await db.put('meta',{key:'session',sid:s,dek:k,last:now,mins})}catch{}
  if(key!==k||sid!==s)await db.del('meta','session').catch(()=>{});
}
function touch(){
  if(!key)return;
  last=Date.now();clearTimeout(timer);timer=setTimeout(check,mins*60000);
  if(last-markAt>1000){markAt=last;store(SS_LAST,String(last))}
  saveSession();
}
function check(){if(!key)return;Date.now()-last>=mins*60000?lock('idle'):touch()}
export function lock(reason='manual'){
  key=null;clearTimeout(timer);sid='';drop(SS_SID);drop(SS_LAST);unbind();
  db.del('meta','session').catch(()=>{});
  subs.forEach(f=>f(reason));
}
