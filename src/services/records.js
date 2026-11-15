// Registros cifrados: id/createdAt/clientId ficam em claro (índices); o restante vai cifrado em `data`.
import*as db from '../db/idb.js';import{getKey}from '../security/auth.js';import{sealJSON,openJSON,sealBytes,openBytes}from '../security/crypto.js';
export const uid=()=>crypto.randomUUID();
const dec=async r=>({...await openJSON(getKey(),r.data),id:r.id,createdAt:r.createdAt,clientId:r.clientId});
export const list=async s=>Promise.all((await db.getAll(s)).map(dec));
export const one=async(s,id)=>{const r=await db.get(s,id);return r&&dec(r)};
export const enc=async(s,o)=>{const{id,createdAt,clientId,...rest}=o;return['put',s,{id,createdAt,...(clientId?{clientId}:{}),data:await sealJSON(getKey(),rest)}]};
export const blobOp=async(id,bytes)=>['put','blobs',{id,data:await sealBytes(getKey(),bytes)}];
export const blobBytes=async id=>openBytes(getKey(),(await db.get('blobs',id)).data);
export const hist=(clientId,type,detail='')=>enc('history',{id:uid(),clientId,createdAt:Date.now(),type,detail});
