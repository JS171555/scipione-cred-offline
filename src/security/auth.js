import * as db from '../db/idb.js';
import * as C from './crypto.js';
let key=null,timer=0,last=0,mins=5;const subs=new Set();
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
  ['pointerdown','keydown','touchstart','scroll'].forEach(e=>addEventListener(e,touch,{passive:true}));
  document.addEventListener('visibilitychange',check);touch();
}
export async function setIdle(m){await db.put('settings',{key:'idleMinutes',value:m});mins=m;touch()}
function touch(){if(!key)return;last=Date.now();clearTimeout(timer);timer=setTimeout(check,mins*60000)}
function check(){if(!key)return;Date.now()-last>=mins*60000?lock('idle'):touch()}
export function lock(reason='manual'){
  key=null;clearTimeout(timer);
  ['pointerdown','keydown','touchstart','scroll'].forEach(e=>removeEventListener(e,touch));
  document.removeEventListener('visibilitychange',check);subs.forEach(f=>f(reason));
}
