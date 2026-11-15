import*as V from '../domain/validators.js';import*as S from '../services/clients.js';import*as A from '../security/auth.js';import*as D from './debts.js';import*as CL from './clientlist.js';import*as P from './debtspage.js';import{unwatch}from '../core/live.js';import{icon}from './icons.js';import{initials,when,plural,filePicker}from './kit.js';
let X;const h=(...a)=>X.h(...a),urls=[];
const clean=()=>{unwatch();urls.splice(0).forEach(u=>URL.revokeObjectURL(u));document.querySelectorAll('dialog.viewer').forEach(d=>d.close())};
const render=(...n)=>{clean();X.show(...n)};A.onLock(clean);
const url=(b,t)=>{const u=URL.createObjectURL(new Blob([b],{type:t}));urls.push(u);return u};
const kb=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const top=(page,t,back,...a)=>h('header',{class:'top','data-page':page},
  h('div',{class:'head'},h('button',{type:'button',class:'iconbtn back','aria-label':'Voltar',onclick:back},icon('back',20)),h('h1',{},t)),
  a.length?h('div',{class:'actions'},...a):null);
const U={h:(...a)=>h(...a),render:(...a)=>render(...a),top:(...a)=>top(...a)};
export function clientsView(ctx,q){X=ctx;list(q)}
export const debtsPageView=ctx=>{X=ctx;P.page(U,{home:X.home,open:profile,reopen:()=>debtsPageView(X)})};
export const openProfile=(ctx,id)=>{X=ctx;profile(id)};
function list(q){return CL.clientList(U,{home:X.home,open:profile,newClient:()=>form(),bulk:()=>D.bulk(U,list)},typeof q==='string'?q:'')}
function form(c={}){
  let photo;const err=h('p',{class:'error',role:'alert'}),fe={},prev=h('div',{class:'avatar avatar--lg'},icon('camera',26));
  const fld=(id,label,type='text',ac,full=false)=>{const e=h('small',{class:'error'});fe[id]=e;return h('div',{class:'field'+(full?' field--full':''),id:'f-'+id},h('label',{for:id},label),h('input',{id,type,autocomplete:ac,value:c[id]||''}),e)};
  const paint=async()=>{let u=null;if(photo?.file){u=URL.createObjectURL(photo.file);urls.push(u)}else if(!photo?.remove&&c.photoId)u=url(await S.blobBytes(c.photoId),c.photoType);
    prev.replaceChildren(u?h('img',{src:u,alt:'Fotografia do cliente'}):icon('camera',26))};
  const btn=h('button',{class:'primary',type:'submit'},c.id?'Salvar alterações':'Cadastrar cliente');
  const f=h('form',{class:'card',novalidate:true,onsubmit:async e=>{e.preventDefault();err.textContent='';Object.values(fe).forEach(x=>x.textContent='');btn.disabled=true;
    const g=k=>f.elements[k].value.trim(),t=g('type');
    try{profile(await S.saveClient({type:t,name:g('name'),doc:g('doc'),rg:t==='PF'?g('rg'):'',phone:g('phone'),mobile:g('mobile'),email:g('email'),address:g('address')},c.id?c:null,photo))}
    catch(x){for(const[k,m]of Object.entries(x.errs||{}))fe[k].textContent=m;err.textContent=x.message}finally{btn.disabled=false}}},
    h('h2',{},'Dados do cliente'),
    h('div',{class:'form-grid'},
      h('div',{class:'field field--full'},h('label',{for:'photo'},'Fotografia'),
        h('div',{class:'media-field'},prev,h('div',{class:'media-body'},
          filePicker(h,h('input',{id:'photo',type:'file',accept:'image/*',onchange:e=>{if(e.target.files[0]){photo={file:e.target.files[0]};paint()}}}),'Escolher foto'),
          h('div',{class:'actions'},h('button',{type:'button',class:'ghost',onclick:()=>{photo={remove:true};f.elements.photo.value='';paint()}},'Remover fotografia'))))),
      fld('name','Nome completo','text','name',true),
      h('div',{class:'field'},h('label',{for:'type'},'Tipo de cliente'),h('select',{id:'type'},h('option',{value:'PF',selected:c.type!=='PJ'},'Pessoa Física'),h('option',{value:'PJ',selected:c.type==='PJ'},'Pessoa Jurídica'))),
      fld('doc','CPF'),fld('rg','RG'),fld('phone','Telefone','tel','tel'),fld('mobile','Celular','tel','tel'),fld('email','E-mail','email','email'),
      fld('address','Endereço completo','text','street-address',true)),
    err,
    h('div',{class:'form-actions'},btn,h('button',{type:'button',onclick:()=>c.id?profile(c.id):list()},'Cancelar')));
  const kind=()=>f.elements.type.value==='PJ'?'cnpj':'cpf',sync=()=>{const pj=kind()==='cnpj';f.querySelector('label[for=doc]').textContent=pj?'CNPJ':'CPF';f.querySelector('#f-rg').hidden=pj;f.elements.doc.value=V.mask[kind()](f.elements.doc.value)};
  f.elements.type.onchange=sync;f.elements.doc.addEventListener('input',e=>e.target.value=V.mask[kind()](e.target.value));
  ['phone','mobile'].forEach(k=>f.elements[k].addEventListener('input',e=>e.target.value=V.mask.phone(e.target.value)));
  render(top(c.id?'edit-client':'new-client',c.id?'Editar cliente':'Novo cliente',()=>c.id?profile(c.id):list()),f);sync();paint();
}
const EXT={'image/webp':'.webp','image/jpeg':'.jpg','image/png':'.png','application/pdf':'.pdf'};
const fname=d=>EXT[d.type]?d.name.replace(/\.[a-z0-9]{2,5}$/i,'')+EXT[d.type]:d.orig;
function viewImg(u,name){const d=h('dialog',{class:'viewer'},h('img',{src:u,alt:name}),h('button',{class:'ghost',onclick:()=>d.close()},icon('close',18),'Fechar'));d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal()}
async function profile(id){
  const c=await S.getClient(id);if(!c)return list();
  const[docs,hist,cnt]=await Promise.all([S.listDocs(id),S.listHistory(id),S.counts(id)]);
  const dsec=await D.section(U,c,()=>profile(id));
  const err=h('p',{class:'error',role:'alert'}),run=fn=>async(...a)=>{err.textContent='';try{await fn(...a);profile(id)}catch(x){err.textContent=x.message}};
  const av=h('div',{class:'avatar avatar--lg'},h('span',{class:'muted'},initials(c.name)));
  if(c.photoId)S.blobBytes(c.photoId).then(b=>av.replaceChildren(h('img',{src:url(b,c.photoType),alt:'Fotografia de '+c.name})));
  const rep=h('input',{type:'file',accept:'image/*',hidden:true,onchange:run(e=>e.target.files[0]&&S.changePhoto(c,{file:e.target.files[0]}))});
  const row=(k,v,wide)=>h('div',{class:wide?'wide':''},h('dt',{},k),h('dd',{},v||'—')),pj=c.type==='PJ';
  const cat=h('select',{id:'cat'},S.CATS.map(x=>h('option',{value:x},x))),nm=h('input',{id:'dn'}),fl=h('input',{id:'df',type:'file',accept:'image/*,application/pdf,.doc,.docx'});
  const open=async d=>{err.textContent='';const pdf=d.type==='application/pdf',w=pdf?window.open('about:blank','_blank'):null;
    try{const b=await S.docBytes(d);if(pdf){if(!w)throw new Error('Permita pop-ups para abrir o PDF ou use Baixar.');const u=URL.createObjectURL(new Blob([b],{type:d.type}));w.location.href=u;setTimeout(()=>URL.revokeObjectURL(u),12e4)}else viewImg(url(b,d.type),d.name)}catch(x){w?.close();err.textContent=x.message}};
  const dl=async d=>{try{const u=URL.createObjectURL(new Blob([await S.docBytes(d)],{type:d.type})),a=h('a',{href:u,download:fname(d)});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),6e4)}catch(x){err.textContent=x.message}};
  render(top('client',c.name,list),
    err,
    h('section',{class:'card'},
      h('div',{class:'profile-head'},av,h('div',{class:'who'},
        h('span',{class:'badge badge--type'},pj?'Pessoa jurídica':'Pessoa física'),
        h('p',{},`${pj?'CNPJ':'CPF'} ${c.doc} · ${plural(cnt.debts,'dívida','dívidas')} · ${plural(cnt.docs,'documento','documentos')}`))),
      h('dl',{class:'meta'},row('Telefone',c.phone),row('Celular',c.mobile),row('E-mail',c.email),...(pj?[]:[row('RG',c.rg)]),row('Endereço',c.address,true)),
      h('div',{class:'actions'},h('button',{class:'primary',onclick:()=>form(c)},'Editar perfil'),rep,
        h('button',{onclick:()=>rep.click()},c.photoId?'Substituir fotografia':'Adicionar fotografia'),
        c.photoId&&h('button',{class:'ghost',onclick:run(()=>S.changePhoto(c,{remove:true}))},'Remover fotografia'),
        h('button',{class:'danger',onclick:async()=>{if(!confirm(`Excluir ${c.name}?\n\nTambém serão removidos ${cnt.docs} documento(s), ${cnt.debts} dívida(s) e todo o histórico deste cliente. Não é possível desfazer.`))return;try{await S.deleteClient(id);list()}catch(x){err.textContent=x.message}}},'Excluir cliente'))),
    h('section',{class:'card'},h('h2',{},'Documentos'),
      h('div',{class:'form-grid'},
        h('div',{class:'field'},h('label',{for:'cat'},'Categoria'),cat),
        h('div',{class:'field'},h('label',{for:'dn'},'Nome do documento (opcional)'),nm),
        h('div',{class:'field field--full'},h('label',{for:'df'},'Arquivo'),filePicker(h,fl,'Escolher arquivo'))),
      h('div',{class:'actions'},h('button',{class:'primary',onclick:run(()=>{if(!fl.files[0])throw new Error('Selecione um arquivo.');return S.addDoc(id,fl.files[0],cat.value,nm.value.trim())})},'Adicionar documento')),
      docs.length?h('ul',{class:'list'},docs.map(d=>h('li',{class:'doc'},
        h('span',{class:'doc-ico'},icon(d.type==='application/pdf'?'file':d.type.startsWith('image/')?'image':'file',18)),
        h('div',{class:'doc-main'},h('div',{class:'doc-title'},d.name),
          h('div',{class:'doc-meta'},`${d.category} · ${d.type==='application/pdf'?'PDF':d.type.startsWith('image/')?d.type.slice(6).toUpperCase():'Arquivo'} · ${kb(d.size)}${d.converted?` (original ${kb(d.originalSize)})`:''} · ${when(d.createdAt)}`)),
        h('div',{class:'actions'},(d.type==='application/pdf'||d.type.startsWith('image/'))&&h('button',{class:'ghost',onclick:()=>open(d)},'Abrir'),
          h('button',{class:'ghost',onclick:()=>dl(d)},'Baixar'),
          h('button',{class:'ghost',onclick:run(()=>confirm(`Remover “${d.name}”?`)&&S.removeDoc(d))},'Remover'))))):h('p',{class:'empty'},icon('file',26),'Nenhum documento anexado.')),
    dsec,
    h('section',{class:'card'},h('h2',{},'Histórico'),
      hist.length?h('ul',{class:'events'},hist.map(e=>h('li',{class:'event'},h('span',{class:'ev-ico'},icon('clock',16)),
        h('div',{class:'ev-body'},h('strong',{},e.type),e.detail&&h('p',{},e.detail),h('time',{},when(e.createdAt)))))):h('p',{class:'empty'},icon('clock',26),'Nenhuma atividade registrada.')));
}
