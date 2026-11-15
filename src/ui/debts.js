import*as M from '../domain/money.js';import*as S from '../services/debts.js';import{icon}from './icons.js';
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
const dBR=s=>s?s.split('-').reverse().join('/'):'—';
export async function section(U,c,reload){
  const{h}=U,ds=await S.listDebts(c.id);
  return h('section',{class:'card'},
    h('div',{class:'section-head'},h('h2',{},'Dívidas'),h('button',{class:'primary',onclick:()=>form(U,c,null,reload)},'Nova dívida')),
    ds.length?h('ul',{class:'list'},ds.map(d=>h('li',{class:'doc'},
      h('div',{class:'doc-main'},h('div',{class:'doc-title'},d.description),
        h('div',{class:'doc-line'},h('span',{class:'nowrap'},M.brl(d.principal)),` a ${M.rate(d.rate)} ao mês · juros de `,h('span',{class:'nowrap'},M.brl(d.interest))),
        h('div',{class:'doc-meta'},`Registro ${dBR(d.date)} · vencimento ${dBR(d.due)}${d.notes?` · ${d.notes}`:''}`)),
      h('div',{class:'actions'},h('button',{class:'ghost',onclick:()=>form(U,c,d,reload)},'Editar'),
        h('button',{class:'ghost',onclick:async()=>{if(confirm(`Excluir a dívida “${d.description}” (${M.brl(d.principal)})?`)){await S.deleteDebt(d);reload()}}},'Excluir'))))):h('p',{class:'empty'},icon('wallet',26),'Nenhuma dívida cadastrada.'));
}
export function form(U,c,d,back){
  const{h}=U,fe={},err=h('p',{class:'error',role:'alert'});
  const fld=(id,label,a,full)=>{const e=h('small',{class:'error'});fe[id]=e;return h('div',{class:'field'+(full?' field--full':'')},h('label',{for:id},label),h('input',{id,...a}),e)};
  const btn=h('button',{class:'primary',type:'submit'},d?'Salvar alterações':'Cadastrar dívida');
  const f=h('form',{class:'card',novalidate:true,onsubmit:async e=>{e.preventDefault();err.textContent='';Object.values(fe).forEach(x=>x.textContent='');btn.disabled=true;
    const g=k=>f.elements[k].value.trim();
    try{await S.saveDebt(c.id,{description:g('description'),principal:M.cents(g('principal')),rate:M.parseRate(g('rate')),date:g('date'),due:g('due'),notes:g('notes')},d);back()}
    catch(x){for(const[k,m]of Object.entries(x.errs||{}))fe[k].textContent=m;err.textContent=x.message}finally{btn.disabled=false}}},
    h('h2',{},'Dados da dívida'),
    h('div',{class:'form-grid'},
      fld('description','Descrição ou motivo',{value:d?.description||''},true),
      fld('principal','Valor principal (R$)',{inputmode:'numeric',value:d?M.num(d.principal):''}),
      fld('rate','Juros ao mês (%)',{inputmode:'decimal',value:d?M.rate(d.rate).replace('%',''):''}),
      h('div',{class:'field field--full'},h('label',{for:'interest'},'Juros por mês (calculado)'),h('input',{id:'interest',readonly:true})),
      fld('date','Data do registro',{type:'date',value:d?.date||today()}),
      fld('due','Vencimento',{type:'date',value:d?.due||''}),
      h('div',{class:'field field--full'},h('label',{for:'notes'},'Observações'),h('textarea',{id:'notes',rows:3},d?.notes||''))),
    err,
    h('div',{class:'form-actions'},btn,h('button',{type:'button',onclick:back},'Cancelar')));
  const upd=()=>{const p=M.cents(f.elements.principal.value),r=M.parseRate(f.elements.rate.value);f.elements.interest.value=p&&r?M.brl(M.interest(p,r)):'—'};
  f.elements.principal.addEventListener('input',e=>{e.target.value=e.target.value?M.num(M.cents(e.target.value)):'';upd()});f.elements.rate.addEventListener('input',upd);
  U.render(U.top('edit-debt',d?'Editar dívida':'Nova dívida',back),f);upd();
}
// Alteração de juros em lote: buscar por taxa, selecionar, prévia, confirmar.
export function bulk(U,back){
  const{h}=U;let rows=[],sel=new Set(),plan=[];
  const err=h('p',{class:'error',role:'alert'}),ok=h('p',{class:'info',role:'status'}),res=h('div'),prev=h('div');
  const rate=h('input',{id:'br',inputmode:'decimal',placeholder:'Ex.: 12'}),val=h('input',{id:'bv',inputmode:'decimal',placeholder:'Ex.: 1 ou 13,5'}),
    act=h('select',{id:'ba'},h('option',{value:'add'},'Aumentar (pontos percentuais)'),h('option',{value:'sub'},'Diminuir (pontos percentuais)'),h('option',{value:'set'},'Substituir pela taxa'));
  const clear=()=>{err.textContent=ok.textContent='';prev.replaceChildren()};
  const paint=()=>res.replaceChildren(rows.length?h('div',{},
    h('label',{class:'check'},h('input',{type:'checkbox',checked:sel.size===rows.length,onchange:e=>{sel=new Set(e.target.checked?rows.map(x=>x.id):[]);clear();paint()}}),'Selecionar todos'),
    h('ul',{class:'list'},rows.map(d=>h('li',{},h('label',{class:'check'},h('input',{type:'checkbox',checked:sel.has(d.id),onchange:e=>{e.target.checked?sel.add(d.id):sel.delete(d.id);clear()}}),
      h('span',{},h('strong',{},d.clientName),` · ${d.description} — ${M.brl(d.principal)}, juros ${M.brl(d.interest)} por mês`)))))):h('p',{class:'empty'},icon('search',26),'Nenhuma dívida com essa taxa.'));
  const find=async()=>{clear();const r=M.parseRate(rate.value);if(!(r>0)){err.textContent='Informe a taxa atual, por exemplo 12.';return}rows=await S.findByRate(r);sel=new Set();paint()};
  const preview=()=>{clear();const chosen=rows.filter(d=>sel.has(d.id)),v=M.parseRate(val.value);
    if(!chosen.length){err.textContent='Selecione ao menos uma dívida.';return}
    if(!(v>0)){err.textContent='Informe o valor da alteração, por exemplo 1 ou 13,5.';return}
    plan=M.planRate(chosen,act.value,v);const bad=plan.some(p=>!p.ok);
    const go=h('button',{class:'primary',disabled:bad,onclick:async()=>{go.disabled=true;try{await S.applyBulk(plan);const n=plan.length;await find();ok.textContent=`${n} dívida(s) atualizada(s).`}catch(x){err.textContent=x.message;go.disabled=false}}},'Confirmar alteração');
    prev.replaceChildren(h('h3',{class:'subhead'},'Prévia da alteração'),h('ul',{class:'list'},plan.map(p=>h('li',{class:'doc'},h('div',{class:'doc-main'},
      h('div',{class:'doc-title'},`${p.d.clientName} · ${p.d.description}`),
      h('div',{class:'doc-line'},p.ok?`${M.rate(p.d.rate)} → ${M.rate(p.nr)} · juros ${M.brl(p.d.interest)} → ${M.brl(p.ni)}`:h('span',{class:'error'},'taxa inválida (0,01% a 1000%)')))))),
      h('p',{class:'muted'},'Somente as dívidas selecionadas serão alteradas.'),h('div',{class:'actions'},go))};
  U.render(U.top('bulk','Juros em lote',back),
    h('section',{class:'card'},h('h2',{},'Dívidas com a taxa atual'),
      h('div',{class:'inline-form'},h('div',{class:'field'},h('label',{for:'br'},'Taxa atual (%)'),rate),h('button',{onclick:find},'Buscar dívidas')),
      res),
    h('section',{class:'card'},h('h2',{},'Aplicar alteração'),
      h('div',{class:'form-grid'},h('div',{class:'field'},h('label',{for:'ba'},'Alteração'),act),h('div',{class:'field'},h('label',{for:'bv'},'Valor (%)'),val)),
      h('div',{class:'actions'},h('button',{onclick:preview},'Pré-visualizar')),err,ok,prev));
}
