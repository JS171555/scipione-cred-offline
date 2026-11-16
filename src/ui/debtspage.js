import*as M from '../domain/money.js';import*as S from '../services/debts.js';import*as C from '../services/clients.js';import{form}from './debts.js';
import*as T from '../domain/due.js';import{getDueWindow}from '../services/settings.js';import{watch}from '../core/live.js';import{icon}from './icons.js';import{plural,pager}from './kit.js';
const dBR=s=>s.split('-').reverse().join('/'),PER=10;
export async function page(U,{home,open,reopen}){
  const{h}=U,st={sort:'new',status:'all',rate:'',client:'',page:1};let ds=[],cs=[],win=7;
  const err=h('p',{class:'error',role:'alert'}),out=h('div'),pg=h('div'),sum=h('p',{class:'summary',role:'status'}),fc=h('select',{id:'fc',onchange:e=>{st.client=e.target.value;st.page=1;paint()}}),nc=h('select',{id:'nc'});
  const sel=(id,l,o,k)=>h('div',{class:'field'},h('label',{for:id},l),h('select',{id,onchange:e=>{st[k]=e.target.value;st.page=1;paint()}},o.map(([v,t])=>h('option',{value:v},t))));
  const paint=()=>{
    const r=M.parseRate(st.rate),use=st.rate.trim()!=='';
    const rows=ds.filter(d=>(!st.client||d.clientId===st.client)&&(!use||(r>0&&d.rate===r))&&(st.status==='all'||T.status(d.due,win)===st.status)).sort((a,b)=>(st.sort==='new'?-1:1)*(a.date.localeCompare(b.date)||a.createdAt-b.createdAt));
    const pages=Math.max(1,Math.ceil(rows.length/PER));st.page=Math.min(Math.max(1,st.page),pages);
    const start=(st.page-1)*PER,visible=rows.slice(start,start+PER),sm=k=>rows.reduce((t,d)=>t+d[k],0);
    sum.replaceChildren(`${plural(rows.length,'dívida','dívidas')} · emprestado `,h('span',{class:'nowrap'},M.brl(sm('principal'))),' · juros no mês ',h('span',{class:'nowrap'},M.brl(sm('interest'))));
    out.replaceChildren(rows.length?h('ul',{class:'list'},visible.map(d=>{
      const n=T.daysUntil(d.due),s=T.status(d.due,win),dn=x=>`${x} ${x===1?'dia':'dias'}`,badge=s==='overdue'?`Vencida há ${dn(-n)}`:s==='soon'?(n?`Vence em ${dn(n)}`:'Vence hoje'):'',c=cs.find(x=>x.id===d.clientId);
      return h('li',{class:'doc'},h('div',{class:'doc-main'},
        h('div',{class:'doc-title'},`${d.clientName} · ${d.description}`,badge&&h('span',{class:'badge '+s},badge)),
        h('div',{class:'doc-line'},`${M.brl(d.principal)} a ${M.rate(d.rate)} ao mês · juros de ${M.brl(d.interest)}`),
        h('div',{class:'doc-meta'},`Registro ${dBR(d.date)} · vencimento ${dBR(d.due)}${d.notes?` · ${d.notes}`:''}`)),
        h('div',{class:'actions'},h('button',{class:'ghost',onclick:()=>open(d.clientId)},'Abrir perfil'),h('button',{class:'ghost',onclick:()=>form(U,c,d,reopen)},'Editar'),
          h('button',{class:'ghost',onclick:async()=>{err.textContent='';if(!confirm(`Excluir a dívida “${d.description}” (${M.brl(d.principal)})?`))return;try{await S.deleteDebt(d)}catch(x){err.textContent=x.message}}},'Excluir')))})):h('p',{class:'empty'},icon('wallet',26),ds.length?'Nenhuma dívida com esses filtros.':'Nenhuma dívida cadastrada.'));
    pg.replaceChildren(pager(h,{page:st.page,pages,total:rows.length,from:rows.length?start+1:0,to:start+visible.length,singular:'dívida',plural:'dívidas',label:'Paginação de dívidas',onPage:n=>{st.page=n;paint()}}));
  };
  U.render(U.top('debts','Dívidas',home),
    h('section',{class:'card'},h('h2',{},'Registrar dívida'),
      h('div',{class:'inline-form'},h('div',{class:'field'},h('label',{for:'nc'},'Registrar para o cliente'),nc),
        h('button',{class:'primary',onclick:()=>{const c=cs.find(x=>x.id===nc.value);c?form(U,c,null,reopen):err.textContent='Cadastre um cliente antes de registrar uma dívida.'}},'Nova dívida'))),
    h('section',{class:'card'},h('h2',{},'Filtros'),
      h('div',{class:'form-grid'},sel('so','Ordenar',[['new','Mais recentes'],['old','Mais antigas']],'sort'),sel('ss','Situação',[['all','Todas'],['overdue','Vencidas'],['soon','Prestes a vencer']],'status'),
        h('div',{class:'field'},h('label',{for:'fr'},'Taxa de juros (%)'),h('input',{id:'fr',inputmode:'decimal',placeholder:'Ex.: 12',oninput:e=>{st.rate=e.target.value;st.page=1;paint()}})),
        h('div',{class:'field'},h('label',{for:'fc'},'Cliente'),fc))),
    sum,out,pg,err);
  const load=async()=>{[ds,cs,win]=await Promise.all([S.listDebts(),C.listClients(),getDueWindow()]);cs.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    const names=new Map(cs.map(c=>[c.id,c.name]));ds=ds.map(d=>({...d,clientName:names.get(d.clientId)||'—'}));
    fc.replaceChildren(h('option',{value:''},'Todos os clientes'),...cs.map(c=>h('option',{value:c.id,selected:c.id===st.client},c.name)));nc.replaceChildren(...cs.map(c=>h('option',{value:c.id},c.name)));paint()};
  await load();watch(load);
}
