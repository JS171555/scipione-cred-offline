import*as S from '../services/clients.js';import*as DS from '../services/debts.js';import*as M from '../domain/money.js';import{match}from '../services/search.js';import{watch}from '../core/live.js';import{icon}from './icons.js';import{initials,plural}from './kit.js';
export async function clientList(U,{home,open,newClient,bulk},q0=''){
  const{h}=U,st={q:q0,sort:'az',rate:''};let cs=[],ds=[];const out=h('div'),cnt=h('p',{class:'count',role:'status'});
  const paint=()=>{
    const r=M.parseRate(st.rate),use=st.rate.trim()!=='',byC=new Map();
    for(const d of ds){if(!byC.has(d.clientId))byC.set(d.clientId,[]);byC.get(d.clientId).push(d)}
    const cmp={az:(a,b)=>a.name.localeCompare(b.name,'pt-BR'),za:(a,b)=>b.name.localeCompare(a.name,'pt-BR'),old:(a,b)=>a.createdAt-b.createdAt,new:(a,b)=>b.createdAt-a.createdAt}[st.sort];
    const rows=cs.filter(c=>match(c,st.q)&&(!use||(r>0&&(byC.get(c.id)||[]).some(d=>d.rate===r)))).sort(cmp);
    cnt.textContent=use&&!(r>0)?'Taxa inválida. Use por exemplo 6 ou 12,5.':plural(rows.length,'cliente','clientes');
    out.replaceChildren(rows.length?h('ul',{class:'list list--grid'},rows.map(c=>h('li',{},
      h('button',{class:'row',onclick:()=>open(c.id)},h('span',{class:'avatar','aria-hidden':'true'},initials(c.name)),
        h('span',{class:'row-body'},h('span',{class:'row-title'},c.name),h('span',{class:'row-sub'},c.doc)),icon('chevron',18)),
      use&&r>0?h('ul',{class:'sub'},(byC.get(c.id)||[]).filter(d=>d.rate===r).map(d=>h('li',{},`${d.description}: ${M.brl(d.principal)} a ${M.rate(d.rate)}`))):null))):
      h('p',{class:'empty'},icon('users',26),cs.length?'Nenhum cliente encontrado com esses filtros.':'Nenhum cliente ainda. Cadastre o primeiro em “Novo cliente”.'));
  };
  const fld=(id,l,el)=>h('div',{class:'field'},h('label',{for:id},l),el);
  const q=h('input',{id:'cq',type:'search',value:st.q,'aria-label':'Buscar clientes',placeholder:'Buscar clientes',oninput:e=>{st.q=e.target.value;paint()}}),
    rt=h('input',{id:'cr',inputmode:'decimal',placeholder:'Ex.: 6 ou 12,5',oninput:e=>{st.rate=e.target.value;paint()}});
  const so=h('select',{id:'cs',onchange:e=>{st.sort=e.target.value;paint()}},[['az','Ordem A–Z'],['za','Ordem Z–A'],['old','Mais antigos'],['new','Mais recentes']].map(([v,t])=>h('option',{value:v},t)));
  U.render(U.top('clients','Clientes',home),
    h('section',{class:'card'},
      h('div',{class:'search'},h('label',{class:'sr',for:'cq'},'Pesquisar por nome, CPF, CNPJ, RG, telefone ou e-mail'),icon('search',18),q),
      h('div',{class:'form-grid filters'},fld('cs','Ordenar',so),fld('cr','Filtrar por taxa de juros (%)',rt)),
      h('div',{class:'actions'},h('button',{class:'primary',onclick:newClient},'Novo cliente'),h('button',{onclick:bulk},'Juros em lote'))),
    cnt,out);
  const load=async()=>{[cs,ds]=await Promise.all([S.listClients(),DS.listDebts()]);paint()};
  await load();watch(load);
}
