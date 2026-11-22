// Formato do backup (formatVersion 1) = ZIP: manifest.json (contagens, versão, SHA-256 de cada arquivo), data/*.json (registros em claro),
// files/<id>.bin (fotos e documentos). Criptografado: ZIP externo só com manifest.json (salt/iterações) + payload.enc (AES-GCM do ZIP interno).
// A senha do cofre e as chaves NÃO fazem parte do backup. Migrações de versões antigas entram em MIGRATE[v](data) -> v+1.
import{fflate as F}from './lib.js';import{rnd,sealBytes,openBytes,deriveAesKey}from'../security/crypto.js';
import{validDate}from'../domain/installments.js';
export const FORMAT=1,ITER=600000,LISTS=['clients','debts','documents','history','installment_plans'];
const hex=u=>[...u].map(b=>b.toString(16).padStart(2,'0')).join(''),unhex=s=>Uint8Array.from(String(s).match(/../g)||[],h=>parseInt(h,16));
const sha=async b=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',b)));
const err=(code,msg)=>Object.assign(new Error(msg),{code});
const J=(f,o)=>f.strToU8(JSON.stringify(o)),P=(f,u,n)=>{try{return JSON.parse(f.strFromU8(u))}catch{throw err('INVALID','Arquivo corrompido: '+n)}};
export async function buildBackup(d,password){
  const f=await F(),z={},sums={},add=async(p,u)=>{z[p]=u;sums[p]=await sha(u)};
  for(const k of[...LISTS,'settings'])await add(`data/${k}.json`,J(f,k==='installment_plans'?(d[k]||[]):d[k]));
  for(const[id,b]of d.files)await add(`files/${id}.bin`,b);
  const createdAt=new Date().toISOString();
  z['manifest.json']=J(f,{app:'SCIPIONE CRED',formatVersion:FORMAT,createdAt,dbVersion:d.dbVersion,encrypted:false,counts:{...Object.fromEntries(LISTS.map(k=>[k,(d[k]||[]).length])),files:d.files.size},sha256:sums});
  const inner=f.zipSync(z);if(!password)return inner;
  const salt=rnd(16),payload=await sealBytes(await deriveAesKey(password,salt,ITER),inner);
  return f.zipSync({'manifest.json':J(f,{app:'SCIPIONE CRED',formatVersion:FORMAT,encrypted:true,kdf:'PBKDF2-SHA256',iter:ITER,salt:hex(salt),cipher:'AES-GCM-256',createdAt}),'payload.enc':payload},{level:0});
}
export function validate(d){
  const i=[];for(const k of LISTS)if(!Array.isArray(d[k]))i.push(`Lista ${k} inválida.`);if(i.length)return i;
  const ids=new Set(d.clients.map(c=>c.id)),debts=new Map(d.debts.map(x=>[x.id,x])),planDebts=new Set();
  for(const c of d.clients){if(!c.id||!c.name)i.push('Cliente sem id ou nome.');if(c.photoId&&!d.files.has(c.photoId))i.push(`Foto ausente de ${c.name}.`)}
  for(const x of d.debts){if(!ids.has(x.clientId))i.push(`Dívida sem cliente (${x.id}).`);if(!(x.principal>=0)||!(x.rate>0))i.push(`Dívida inválida (${x.id}).`)}
  for(const x of d.documents){if(!ids.has(x.clientId))i.push(`Documento sem cliente (${x.id}).`);if(!d.files.has(x.blobId))i.push(`Arquivo ausente: ${x.name}.`)}
  for(const x of d.history)if(!ids.has(x.clientId))i.push(`Histórico sem cliente (${x.id}).`);
  let versionedPlans=d.installment_plans||[];
  for(const p of versionedPlans){
    if(!p||typeof p!=='object'){i.push('Parcelamento inválido.');continue}
    const debt=debts.get(p.debtId),items=Array.isArray(p.items)?p.items:[],sum=items.reduce((t,x)=>t+(Number.isSafeInteger(x?.amountCents)&&x.amountCents>=0?x.amountCents:0),0),paid=items.filter(x=>x?.paidAt).reduce((t,x)=>t+x.amountCents,0);
    if(!Array.isArray(p.items))i.push(`Parcelas inválidas (${p.id}).`);
    if(!p.id||!ids.has(p.clientId)||!debt||debt.clientId!==p.clientId)i.push(`Parcelamento sem cliente ou dívida correspondente (${p.id}).`);
    if(planDebts.has(p.debtId))i.push(`Mais de um parcelamento para a mesma dívida (${p.debtId}).`);planDebts.add(p.debtId);
    if(!Number.isInteger(p.count)||p.count<1||p.count>60||items.length!==p.count||!Number.isSafeInteger(p.totalCents)||p.totalCents<=0||sum!==p.totalCents)i.push(`Parcelamento inválido (${p.id}).`);
    if(!validDate(p.startDate)||!validDate(p.firstDueDate)||p.firstDueDate<p.startDate)i.push(`Datas inválidas no parcelamento (${p.id}).`);
    if(items.some((x,n)=>!x||x.number!==n+1||!Number.isSafeInteger(x.amountCents)||x.amountCents<0||!validDate(x.dueDate)||(x.paidAt!=null&&!Number.isFinite(x.paidAt))))i.push(`Parcelas inválidas (${p.id}).`);
    if(debt&&paid+debt.principal!==p.totalCents)i.push(`Saldo e baixas não correspondem ao valor original (${p.id}).`);
  }
  return i}
export async function readBackup(bytes,password){
  const f=await F();let z;try{z=f.unzipSync(bytes)}catch{throw err('INVALID','O arquivo não é um ZIP válido.')}
  const m=z['manifest.json']&&P(f,z['manifest.json'],'manifest.json');
  if(!m||m.app!=='SCIPIONE CRED')throw err('INVALID','Este arquivo não é um backup do SCIPIONE CRED.');
  if(!(m.formatVersion>=1)||m.formatVersion>FORMAT)throw err('INVALID','Backup criado por uma versão mais nova (ou desconhecida) do sistema.');
  if(m.encrypted){
    if(!password)throw err('NEEDS_PASSWORD','Este backup é criptografado. Informe a senha do backup.');
    let inner;try{inner=await openBytes(await deriveAesKey(password,unhex(m.salt),m.iter),z['payload.enc'])}catch{throw err('BAD_PASSWORD','Senha do backup incorreta ou arquivo corrompido.')}
    return readBackup(inner);
  }
  const sums=m.sha256;if(!sums||typeof sums!=='object')throw err('INVALID','Backup sem verificação de integridade.');
  for(const p of Object.keys(z))if(p!=='manifest.json'&&!(p in sums))throw err('INVALID','Arquivo inesperado no backup: '+p);
  for(const[p,h]of Object.entries(sums))if(!z[p]||await sha(z[p])!==h)throw err('INVALID','Arquivo corrompido ou ausente: '+p);
  const data={files:new Map(Object.keys(z).filter(p=>p.startsWith('files/')).map(p=>[p.slice(6,-4),z[p]]))};
  for(const k of[...LISTS,'settings'])data[k]=z[`data/${k}.json`]?P(f,z[`data/${k}.json`],k):k==='installment_plans'?[]:null;
  const bad=validate(data);if(bad.length)throw err('INVALID','Backup inconsistente: '+bad.slice(0,5).join(' '));
  return{manifest:m,data};
}
