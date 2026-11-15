// Avatar de cliente com iniciais e fotografia carregada sob demanda.
import*as S from '../services/clients.js';
import*as A from '../security/auth.js';
import{initials}from './kit.js';
const urls=new Map(),pending=new Map();
let epoch=0;
export function clearClientPhotos(){
  epoch++;
  for(const u of urls.values())URL.revokeObjectURL(u);
  urls.clear();pending.clear();
}
A.onLock(clearClientPhotos);
export function clientAvatar(h,c){
  const el=h('span',{class:'avatar','aria-hidden':'true'},initials(c.name));
  if(!c.photoId)return el;
  const id=c.photoId,type=c.photoType||'image/jpeg',my=epoch;
  let p=pending.get(id);
  if(!p){
    p=S.blobBytes(id).then(b=>URL.createObjectURL(new Blob([b],{type}))).catch(()=>null);
    pending.set(id,p);
  }
  p.then(u=>{
    if(!u)return;
    if(my!==epoch){URL.revokeObjectURL(u);return}
    urls.set(id,u);
    el.replaceChildren(h('img',{src:u,alt:'',decoding:'async'}));
  });
  return el;
}
