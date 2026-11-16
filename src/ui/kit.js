// Utilidades de apresentação (sem regra de negócio): iniciais para avatar, datas legíveis, seletor de arquivo e paginação.
import{icon}from './icons.js';
export const initials=n=>String(n||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
export const when=t=>new Date(t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
export const day=t=>new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
export const longDay=d=>d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
export const plural=(n,s,p)=>`${n} ${n===1?s:p}`;
export function filePicker(h,input,text='Escolher arquivo',glyph='upload'){
  input.classList.add('file-input');
  const name=h('span',{class:'file-name'},text);
  const box=h('label',{class:'file-pick',for:input.id},input,
    h('span',{class:'file-ico','aria-hidden':'true'},icon(glyph,40)),name);
  const sync=()=>{const f=input.files[0];name.textContent=f?f.name:text;box.classList.toggle('has-file',!!f)};
  input.addEventListener('change',sync);sync();
  return box;
}
// Paginação de exibição: os dados completos permanecem no estado e só a fatia visível é renderizada.
export function pager(h,{page,pages,total,from,to,singular='registro',plural='registros',label='Paginação',onPage}){
  const noun=total===1?singular:plural;
  const status=total?`Mostrando ${from}–${to} de ${total} ${noun}`:`0 ${plural}`;
  const statusEl=h('p',{class:'pager-status',role:'status','aria-live':'polite'},status);
  if(total===0||pages<=1)return statusEl;
  const nums=[],add=n=>{if(nums[nums.length-1]!==n)nums.push(n)};
  if(pages<=7){for(let i=1;i<=pages;i++)add(i)}
  else{
    add(1);
    const a=Math.max(2,page-1),b=Math.min(pages-1,page+1);
    if(a>2)nums.push('…');
    for(let i=a;i<=b;i++)add(i);
    if(b<pages-1)nums.push('…');
    add(pages);
  }
  const numBtn=n=>h('button',{type:'button',class:'pager-btn'+(n===page?' is-current':''),'aria-label':`Página ${n}`,'aria-current':n===page?'page':false,onclick:()=>{if(n!==page)onPage(n)}},String(n));
  const nav=h('div',{class:'pager-nav'},
    h('button',{type:'button',class:'pager-btn pager-step pager-prev',disabled:page<=1,'aria-label':'Página anterior',onclick:()=>onPage(page-1)},icon('back',16),h('span',{},'Anterior')),
    h('div',{class:'pager-nums'},nums.map(n=>n==='…'?h('span',{class:'pager-gap','aria-hidden':'true'},'…'):numBtn(n))),
    h('button',{type:'button',class:'pager-btn pager-step pager-next',disabled:page>=pages,'aria-label':'Próxima página',onclick:()=>onPage(page+1)},h('span',{},'Próxima'),icon('chevron',16)));
  return h('nav',{class:'pager','aria-label':label},statusEl,nav);
}
