import*as db from '../db/idb.js';import*as V from '../domain/validators.js';import{toStored}from '../files/process.js';
import{uid,list,one,enc,blobOp,blobBytes,hist}from './records.js';
export{blobBytes};
export const CATS=['Identificação','Comprovante de endereço','Comprovante de transferência','Outro'];
const LABEL={type:'Tipo',name:'Nome',doc:'CPF/CNPJ',rg:'RG',phone:'Telefone',mobile:'Celular',email:'E-mail',address:'Endereço'};
export const listClients=()=>list('clients'),getClient=id=>one('clients',id);
export function validate(d,old,all){
  const e={},pj=d.type==='PJ';
  if(!d.name)e.name=pj?'Informe a razão social.':'Informe o nome completo.';
  if(!(pj?V.validCNPJ:V.validCPF)(d.doc))e.doc=pj?'CNPJ inválido.':'CPF inválido.';
  else{const x=all.find(c=>c.id!==old?.id&&V.digits(c.doc)===V.digits(d.doc));if(x)e.doc=`Já cadastrado para ${x.name}.`}
  for(const k of['phone','mobile']){const n=V.digits(d[k]).length;if(d[k]&&(n<10||n>11))e[k]='Informe DDD e número.'}
  if(d.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))e.email='E-mail inválido.';
  return e}
// photo: undefined | {file} | {remove:true}
export async function saveClient(d,old,photo){
  const errs=validate(d,old,await listClients());
  if(Object.keys(errs).length)throw Object.assign(new Error('Corrija os campos destacados.'),{errs});
  const id=old?.id||uid(),ops=[],now=Date.now();let photoId=old?.photoId||null,photoType=old?.photoType||null,ph='';
  if(photo?.file){const f=await toStored(photo.file,{force:true,maxSide:512}),bid=uid();ops.push(await blobOp(bid,f.bytes));
    if(photoId)ops.push(['delete','blobs',photoId]);ph=photoId?'Fotografia alterada':'Fotografia incluída';photoId=bid;photoType=f.type}
  else if(photo?.remove&&photoId){ops.push(['delete','blobs',photoId]);photoId=photoType=null;ph='Fotografia removida'}
  ops.push(await enc('clients',{...d,id,photoId,photoType,createdAt:old?.createdAt||now,updatedAt:now}));
  if(!old)ops.push(await hist(id,'Cadastro de cliente'));
  else{const ch=Object.keys(LABEL).filter(k=>(old[k]||'')!==(d[k]||''));if(ch.length)ops.push(await hist(id,'Alteração de dados',ch.map(k=>LABEL[k]).join(', ')))}
  if(ph)ops.push(await hist(id,ph));
  await db.batch(ops);return id}
export const changePhoto=(c,p)=>saveClient(c,c,p);
const rel=async(s,id)=>(await db.getAll(s)).filter(r=>r.clientId===id);
export const counts=async id=>({docs:(await rel('documents',id)).length,debts:(await rel('debts',id)).length});
export async function deleteClient(id){
  const c=await getClient(id);if(!c)return;const ops=[];
  for(const d of await listDocs(id))ops.push(['delete','documents',d.id],['delete','blobs',d.blobId]);
  for(const s of['debts','history'])for(const r of await rel(s,id))ops.push(['delete',s,r.id]);
  if(c.photoId)ops.push(['delete','blobs',c.photoId]);ops.push(['delete','clients',id]);await db.batch(ops)}
export const listDocs=async id=>(await list('documents')).filter(d=>d.clientId===id).sort((a,b)=>b.createdAt-a.createdAt);
export const listHistory=async id=>(await list('history')).filter(h=>h.clientId===id).sort((a,b)=>b.createdAt-a.createdAt);
export async function addDoc(clientId,file,category,name){
  const f=await toStored(file);
  if((await listDocs(clientId)).some(d=>d.hash===f.hash))throw new Error('Este arquivo já está anexado a este cliente.');
  const nm=name||file.name,bid=uid();
  await db.batch([await blobOp(bid,f.bytes),await enc('documents',{id:uid(),clientId,createdAt:Date.now(),name:nm,orig:file.name,category,type:f.type,size:f.size,originalSize:f.originalSize,converted:f.converted,hash:f.hash,blobId:bid}),await hist(clientId,'Documento incluído',`${nm} (${category})`)])}
export async function removeDoc(d){await db.batch([['delete','blobs',d.blobId],['delete','documents',d.id],await hist(d.clientId,'Documento removido',d.name)])}
export const docBytes=d=>blobBytes(d.blobId);
