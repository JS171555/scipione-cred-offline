// Cofre: senha -> PBKDF2-SHA256 -> chave KEK; a KEK só protege a chave de dados (DEK, AES-GCM 256).
// A senha nunca é guardada; senha correta = DEK abre com sucesso (tag do GCM). DEK é não extraível.
const te=new TextEncoder(),td=new TextDecoder(),S=crypto.subtle;
export const ITER=600000;
export const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
const kek=async(pw,salt,iterations)=>S.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},await S.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,['wrapKey','unwrapKey']);
export async function createVault(pw){
  const salt=rnd(16),iv=rnd(12),k=await kek(pw,salt,ITER);
  const dek=await S.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const wrapped=new Uint8Array(await S.wrapKey('raw',dek,k,{name:'AES-GCM',iv}));
  return{meta:{salt,iv,wrapped,iter:ITER,kdf:'PBKDF2-SHA256',cipher:'AES-GCM-256',v:1}};
}
export async function openVault(pw,m){
  const k=await kek(pw,m.salt,m.iter);
  return S.unwrapKey('raw',m.wrapped,k,{name:'AES-GCM',iv:m.iv},{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function sealBytes(key,bytes){const iv=rnd(12),ct=new Uint8Array(await S.encrypt({name:'AES-GCM',iv},key,bytes));const o=new Uint8Array(12+ct.length);o.set(iv);o.set(ct,12);return o}
export const openBytes=async(key,b)=>new Uint8Array(await S.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12)));
export const sealJSON=(key,o)=>sealBytes(key,te.encode(JSON.stringify(o)));
export const openJSON=async(key,b)=>JSON.parse(td.decode(await openBytes(key,b)));
// Chave AES-GCM direta da senha (usada só no backup criptografado, com salt próprio).
export const deriveAesKey=async(pw,salt,iterations)=>S.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},await S.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
