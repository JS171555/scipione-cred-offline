import*as S from '../services/clients.js';import*as DS from '../services/debts.js';import*as M from '../domain/money.js';import{startsWithLetter,debtsAtRate,sumDebtPrincipal}from'../domain/client-filters.js';import{match}from'../services/search.js';import{watch}from '../core/live.js';import{icon}from './icons.js';import{pager}from './kit.js';import{clientAvatar}from './avatar.js';
import{isUnlocked}from '../security/auth.js';
const PER=20;
export async function clientList(U,{home,open,newClient,bulk},q0=''){
  const{h}=U,st={q:q0,sort:'az',rate:'',letter:'',page:1};let cs=[],ds=[];const out=h('div'),pg=h('div'),cnt=h('p',{class:'count',role:'alert',hidden:true}),rateTotal=h('p',{class:'rate-total',role:'status','aria-live':'polite',hidden:true});
  const paint=()=>{
    const r=M.parseRate(st.rate),use=st.rate.trim()!=='',byC=new Map();
    for(const d of ds){if(!byC.has(d.clientId))byC.set(d.clientId,[]);byC.get(d.clientId).push(d)}
    const cmp={az:(a,b)=>a.name.localeCompare(b.name,'pt-BR'),za:(a,b)=>b.name.localeCompare(a.name,'pt-BR'),old:(a,b)=>a.createdAt-b.createdAt,new:(a,b)=>b.createdAt-a.createdAt}[st.sort];
    const rows=cs.filter(c=>match(c,st.q)&&startsWithLetter(c.name,st.letter)&&(!use||(r>0&&(byC.get(c.id)||[]).some(d=>d.rate===r)))).sort(st.letter?((a,b)=>a.name.localeCompare(b.name,'pt-BR')):cmp);
    const pages=Math.max(1,Math.ceil(rows.length/PER));st.page=Math.min(Math.max(1,st.page),pages);
    const start=(st.page-1)*PER,visible=rows.slice(start,start+PER);
    const matchedDebts=use&&r>0?rows.flatMap(c=>debtsAtRate(byC.get(c.id)||[],r)):[];
    rateTotal.hidden=!(use&&r>0);
    if(!rateTotal.hidden)rateTotal.replaceChildren(h('span',{},`Soma do principal das dívidas filtradas por ${M.rate(r)}:`),h('strong',{},M.brl(sumDebtPrincipal(matchedDebts))));
    cnt.textContent=use&&!(r>0)?'Taxa inválida. Informe, por exemplo, 20 ou 12,5%.':'';
    cnt.hidden=!cnt.textContent;
    out.replaceChildren(rows.length?h('ul',{class:'list list--grid'},visible.map(c=>h('li',{},
      h('button',{class:'row',onclick:()=>open(c.id)},clientAvatar(h,c),
        h('span',{class:'row-body'},h('span',{class:'row-title'},c.name),h('span',{class:'row-sub'},c.doc)),icon('chevron',18)),
      use&&r>0?h('ul',{class:'sub'},debtsAtRate(byC.get(c.id)||[],r).map(d=>h('li',{},`${d.description}: ${M.brl(d.principal)} a ${M.rate(d.rate)}`))):null))):
      h('p',{class:'empty'},icon('users',26),cs.length?'Nenhum cliente encontrado com esses filtros.':'Nenhum cliente ainda. Cadastre o primeiro em “Novo cliente”.'));
    pg.replaceChildren(use&&!(r>0)?'':pager(h,{page:st.page,pages,total:rows.length,from:rows.length?start+1:0,to:start+visible.length,singular:'cliente',plural:'clientes',label:'Paginação de clientes',onPage:n=>{st.page=n;paint()}}));
  };
  const fld=(id,l,el)=>h('div',{class:'field'},h('label',{for:id},l),el);
  const q=h('input',{id:'cq',type:'search',value:st.q,'aria-label':'Buscar clientes',placeholder:'Buscar clientes',oninput:e=>{st.q=e.target.value;st.page=1;paint()}}),
    rt=h('input',{id:'cr',inputmode:'decimal',placeholder:'Ex.: 20 ou 12,5%',oninput:e=>{st.rate=e.target.value;st.page=1;paint()}});
  const so=h('select',{id:'cs',onchange:e=>{st.sort=e.target.value;st.page=1;paint()}},[['az','Ordem A–Z'],['za','Ordem Z–A'],['old','Mais antigos'],['new','Mais recentes']].map(([v,t])=>h('option',{value:v},t))),
    letter=h('select',{id:'cl',onchange:e=>{st.letter=e.target.value;st.page=1;if(st.letter){st.sort='az';so.value='az';so.disabled=true}else so.disabled=false;paint()}},h('option',{value:''},'Todas as letras'),...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ',v=>h('option',{value:v},v)));
  U.render(U.top('clients','Clientes',home),
    h('section',{class:'card'},
      h('div',{class:'search'},h('label',{class:'sr',for:'cq'},'Pesquisar por nome, CPF, CNPJ, RG, telefone ou e-mail'),icon('search',18),q),
      h('div',{class:'form-grid filters'},fld('cs','Ordenar',so),fld('cl','Filtrar por inicial do nome',letter),fld('cr','Filtrar por taxa de juros (%)',rt)),
      h('div',{class:'actions'},h('button',{class:'primary',onclick:newClient},'Novo cliente'),h('button',{onclick:bulk},'Juros em lote'))),
    cnt,out,rateTotal,pg);
  const load=async()=>{if(!isUnlocked())return;[cs,ds]=await Promise.all([S.listClients(),DS.listDebts()]);if(!isUnlocked())return;paint()};
  watch(load);await load();
}
