import*as M from '../domain/money.js';import{stats}from '../services/dashboard.js';import{watch}from '../core/live.js';import{icon}from './icons.js';import{initials,when,plural}from './kit.js';
export async function card({h,search,openClient,openDebts,openClients}){
  const box=h('div'),q=h('input',{id:'gq',type:'search',autocomplete:'off','aria-label':'Buscar clientes',placeholder:'Buscar clientes'});
  const tile=(label,value,ico,sub,mods='')=>h('div',{class:'tile '+mods},
    h('span',{class:'tile-ico'},icon(ico,24)),
    h('div',{class:'tile-body'},h('span',{class:'label'},label),h('strong',{},value),sub&&h('span',{class:'sub'},sub)));
  const draw=async()=>{
    const s=await stats();
    const bits=[];
    if(s.overdue)bits.push(plural(s.overdue,'vencida','vencidas'));
    if(s.soon)bits.push(`${s.soon} a vencer`);
    const alert=(s.overdue||s.soon)?h('div',{class:'alert'+(s.overdue?' bad':'')},icon('alert',20),
      h('p',{},bits.join(' · ')),h('button',{class:'ghost',onclick:openDebts},'Ver dívidas',icon('chevron',16))):null;
    const latest=s.latest.length?h('ul',{class:'list'},s.latest.map(c=>h('li',{},
      h('button',{class:'row',onclick:()=>openClient(c.id)},
        h('span',{class:'avatar','aria-hidden':'true'},initials(c.name)),
        h('span',{class:'row-body'},h('span',{class:'row-title'},c.name),h('span',{class:'row-sub'},`Cliente desde ${when(c.createdAt)}`)),
        icon('chevron',18))))):h('p',{class:'empty'},icon('users',26),'Nenhum cliente cadastrado.');
    const recent=s.recent.length?h('ul',{class:'events'},s.recent.slice(0,4).map(e=>h('li',{class:'event'},
      h('span',{class:'ev-ico'},icon('activity',16)),
      h('div',{class:'ev-body'},h('strong',{},e.type),h('p',{},`${e.client}${e.detail?` · ${e.detail}`:''}`),h('time',{},when(e.createdAt)))))):h('p',{class:'empty'},icon('activity',26),'Nenhuma atividade ainda.');
    const parts=[
      h('div',{class:'stats'},
        tile('Saldo total de dívidas',M.brl(s.principal),'wallet',plural(s.debts,'dívida registrada','dívidas registradas'),'tile--accent'),
        tile('Juros mensais',M.brl(s.interest),'percent','Projeção mensal'),
        tile('Clientes',String(s.clients),'users','Base ativa')),
      alert,
      h('div',{class:'split'},
        h('section',{class:'card'},h('div',{class:'section-head'},h('h2',{},'Últimos clientes')),latest,
          s.latest.length?h('div',{class:'card-foot'},h('button',{class:'ghost',onclick:openClients},'Ver todos os clientes',icon('chevron',16))):null),
        h('section',{class:'card'},h('div',{class:'section-head'},h('h2',{},'Atividades recentes')),recent))];
    box.replaceChildren(...parts.filter(Boolean));
  };
  await draw();watch(draw);
  return[
    h('form',{class:'search search--page',role:'search',onsubmit:e=>{e.preventDefault();search(q.value.trim())}},
      h('label',{class:'sr',for:'gq'},'Pesquisar clientes por nome, CPF, CNPJ, RG, telefone ou e-mail'),
      icon('search',20),q,h('button',{type:'submit','aria-label':'Pesquisar clientes'},icon('arrow',18))),
    box];
}
