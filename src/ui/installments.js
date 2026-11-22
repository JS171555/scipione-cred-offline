import*as M from'../domain/money.js';
import{addMonths,splitInstallments,validDate}from'../domain/installments.js';
import*as C from'../services/clients.js';
import*as D from'../services/debts.js';
import*as S from'../services/installments.js';
import{watch,unwatch}from'../core/live.js';
import{isUnlocked}from'../security/auth.js';
import{icon}from'./icons.js';

const today=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dBR=s=>String(s||'').split('-').reverse().join('/');

export async function installmentsView({h,show,home}){
  unwatch();
  const state={clientId:'',debtId:'',count:'6',startDate:today(),firstDueDate:addMonths(today(),1),autoDue:true};
  const err=h('p',{class:'error',role:'alert'}),balance=h('p',{class:'summary'}),debtSelect=h('select',{id:'installment-debt'}),preview=h('div'),plansOut=h('div');
  const clientSelect=h('select',{id:'installment-client',onchange:e=>{state.clientId=e.target.value;state.debtId='';paintForm()}});
  const countInput=h('input',{id:'installment-count',type:'number',min:'1',max:'60',step:'1',value:state.count,inputmode:'numeric',oninput:e=>{state.count=e.target.value;paintPreview()}});
  const startInput=h('input',{id:'installment-start',type:'date',value:state.startDate,onchange:e=>{state.startDate=e.target.value;if(state.autoDue){state.firstDueDate=validDate(state.startDate)?addMonths(state.startDate,1):'';dueInput.value=state.firstDueDate}paintPreview()}});
  const dueInput=h('input',{id:'installment-first-due',type:'date',value:state.firstDueDate,onchange:e=>{state.firstDueDate=e.target.value;state.autoDue=false;paintPreview()}});
  let clients=[],debts=[],plans=[];
  const field=(id,label,input)=>h('div',{class:'field'},h('label',{for:id},label),input);
  const planForm=h('form',{class:'card',novalidate:true,onsubmit:async e=>{
    e.preventDefault();err.textContent='';const button=planForm.querySelector('button[type=submit]');button.disabled=true;
    try{await S.createPlan({clientId:state.clientId,debtId:state.debtId,count:countInput.value,startDate:state.startDate,firstDueDate:state.firstDueDate});state.debtId='';await load()}
    catch(x){err.textContent=x.message}finally{if(button.isConnected)button.disabled=false}
  }});
  const debtDescription=d=>d?`${d.description} · ${M.brl(d.principal)}`:'';
  const eligible=()=>debts.filter(d=>d.clientId===state.clientId&&d.principal>0&&!plans.some(p=>p.debtId===d.id));
  const paintPreview=()=>{
    const debt=debts.find(d=>d.id===state.debtId),count=Number(countInput.value);
    balance.textContent=debt?`Saldo atual da dívida: ${M.brl(debt.principal)}`:'Selecione uma dívida para exibir o saldo atual.';
    if(!debt||!Number.isInteger(count)||count<1||count>60||!state.firstDueDate){preview.replaceChildren();return}
    try{
      const rows=splitInstallments(debt.principal,count,state.firstDueDate);
      preview.replaceChildren(h('h3',{class:'subhead'},'Prévia das parcelas'),h('p',{class:'muted'},`${count} parcela(s) · total ${M.brl(debt.principal)} · sem juros adicionais`),
        h('div',{class:'installment-table-wrap'},h('table',{class:'installment-table'},h('thead',{},h('tr',{},h('th',{},'Parcela'),h('th',{},'Valor'),h('th',{},'Vencimento'))),
          h('tbody',{},rows.map(x=>h('tr',{},h('td',{},String(x.number)),h('td',{},M.brl(x.amountCents)),h('td',{},dBR(x.dueDate))))))));
    }catch{preview.replaceChildren()}
  };
  const paintForm=()=>{
    const opts=eligible();
    debtSelect.replaceChildren(h('option',{value:''},state.clientId?'Selecione uma dívida':'Selecione primeiro um cliente'),...opts.map(d=>h('option',{value:d.id,selected:d.id===state.debtId},debtDescription(d))));
    if(!opts.some(d=>d.id===state.debtId))state.debtId='';
    debtSelect.onchange=e=>{state.debtId=e.target.value;paintPreview()};
    planForm.replaceChildren(h('h2',{},'Criar parcelamento'),
      h('div',{class:'form-grid'},field('installment-client','Cliente',clientSelect),field('installment-debt','Dívida do cliente',debtSelect),field('installment-count','Quantidade de parcelas (1 a 60)',countInput),field('installment-start','Início do parcelamento',startInput),field('installment-first-due','Vencimento da 1ª parcela',dueInput)),
      h('p',{class:'muted'},'As parcelas não incluem juros adicionais. Os juros da dívida continuam calculados sobre o principal restante.'),
      balance,preview,err,h('div',{class:'form-actions'},h('button',{type:'submit',class:'primary',disabled:!state.debtId},'Gerar parcelamento')));
    paintPreview();
  };
  const paintPlans=()=>{
    if(!plans.length){plansOut.replaceChildren(h('p',{class:'empty'},icon('wallet',26),'Nenhum parcelamento cadastrado.'));return}
    plansOut.replaceChildren(...plans.map(p=>{
      const debt=p.debt,rows=(p.items||[]).map(item=>h('tr',{},h('td',{},String(item.number)),h('td',{},M.brl(item.amountCents)),h('td',{},dBR(item.dueDate)),
        h('td',{},h('input',{type:'checkbox',checked:!!item.paidAt,disabled:!!item.paidAt,'aria-label':`Marcar parcela ${item.number} como paga`,onchange:async e=>{
          if(!e.target.checked)return;err.textContent='';e.target.disabled=true;
          try{await S.markPaid(p.id,item.number)}catch(x){err.textContent=x.message;await load()}
        }}))));
      return h('section',{class:'card installment-plan'},h('div',{class:'section-head'},h('div',{},h('h2',{},`${p.clientName} · ${debt?.description||'Dívida não encontrada'}`),h('p',{class:'muted'},`Saldo atual da dívida: ${M.brl(debt?.principal||0)}`)),
          h('span',{class:'badge'},`${p.count} ${p.count===1?'parcela':'parcelas'}`)),
        h('div',{class:'installment-table-wrap'},h('table',{class:'installment-table'},h('thead',{},h('tr',{},h('th',{},'Parcela'),h('th',{},'Valor'),h('th',{},'Vencimento'),h('th',{},'Marcar'))),h('tbody',{},rows))));
    }));
  };
  const load=async()=>{
    if(!isUnlocked())return;
    [clients,debts,plans]=await Promise.all([C.listClients(),D.listDebts(),S.listPlans()]);
    if(!isUnlocked())return;
    clients.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    clientSelect.replaceChildren(h('option',{value:''},'Selecione um cliente'),...clients.map(c=>h('option',{value:c.id,selected:c.id===state.clientId},c.name)));
    paintForm();paintPlans();
  };
  const top=h('header',{class:'top','data-page':'installments'},h('div',{class:'head'},h('button',{type:'button',class:'iconbtn back','aria-label':'Voltar ao início',onclick:home},icon('back',20)),h('h1',{},'Parcelamentos')));
  show(top,planForm,h('section',{class:'installment-section'},h('h2',{},'Parcelamentos registrados'),plansOut));
  watch(load);await load();
}
