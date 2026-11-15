// Utilidades de apresentação (sem regra de negócio): iniciais para avatar, datas legíveis e seletor de arquivo.
import{icon}from './icons.js';
export const initials=n=>String(n||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
export const when=t=>new Date(t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
export const day=t=>new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
export const longDay=d=>d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
export const plural=(n,s,p)=>`${n} ${n===1?s:p}`;
export function filePicker(h,input,text='Escolher arquivo'){
  input.classList.add('file-input');
  const name=h('span',{class:'file-name'},'Nenhum arquivo selecionado');
  input.addEventListener('change',()=>{const f=input.files[0];name.textContent=f?f.name:'Nenhum arquivo selecionado'});
  return h('label',{class:'file-pick',for:input.id},input,h('span',{class:'file-btn'},icon('upload',18),text),name);
}
