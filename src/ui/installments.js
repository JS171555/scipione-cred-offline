import*as M from'../domain/money.js';
import{addMonths,splitInstallments,validDate}from'../domain/installments.js';
import*as C from'../services/clients.js';
import*as D from'../services/debts.js';
import*as S from'../services/installments.js';
import{match}from'../services/search.js';
import{watch,unwatch}from'../core/live.js';
import{isUnlocked}from'../security/auth.js';
import{icon}from'./icons.js';
import{clientAvatar}from'./avatar.js';

const today=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dBR=s=>String(s||'').split('-').reverse().join('/');

export async function installmentsView({h,show,home}){
  unwatch();
  const state={clientId:'',debtId:'',clientQuery:'',count:'6',startDate:today(),firstDueDate:addMonths(today(),1),autoDue:true};
  const err=h('p',{class:'error',role:'alert'}),balance=h('p',{class:'summary'}),debtSelect=h('select',{id:'installment-debt'}),preview=h('div'),plansOut=h('div');
  const clientResults=h('div',{id:'installment-client-results',class:'client-search-results',role:'listbox','aria-label':'Resultados da busca de clientes',hidden:true});
  const selectedClient=h('div',{class:'selected-client-row',hidden:true});
  const clientInput=h('input',{id:'installment-client-search',type:'search',autocomplete:'off',placeholder:'Buscar por nome, CPF/CNPJ, telefone ou e-mail','aria-label':'Buscar clientes para o parcelamento','aria-controls':'installment-client-results','aria-autocomplete':'list',onfocus:()=>{if(state.clientId)clientInput.select()},oninput:e=>{
    const hadClient=!!state.clientId;
    state.clientQuery=e.target.value;
    if(hadClient){state.clientId='';state.debtId=''}
    paintClientSearch();
    if(hadClient){syncDebtSelect();paintPreview()}
  }});
  const clientPicker=h('div',{class:'client-picker'},h('div',{class:'search'},icon('search',18),clientInput),clientResults,selectedClient);
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
  const clearClient=()=>{state.clientId='';state.debtId='';state.clientQuery='';clientInput.value='';paintClientSearch();paintForm();clientInput.focus()};
  const chooseClient=c=>{state.clientId=c.id;state.debtId='';state.clientQuery=c.name;clientInput.value=c.name;paintClientSearch();paintForm()};
  const paintClientSearch=()=>{
    const selected=clients.find(c=>c.id===state.clientId);
    if(selected){
      clientInput.value=selected.name;clientInput.setAttribute('aria-expanded','false');clientResults.hidden=true;
      selectedClient.hidden=false;
      selectedClient.replaceChildren(clientAvatar(h,selected),h('span',{class:'row-body'},h('span',{class:'row-title'},selected.name),h('span',{class:'row-sub'},selected.doc)),
        h('button',{type:'button',class:'ghost',onclick:clearClient},'Alterar'));
      return;
    }
    selectedClient.hidden=true;
    const query=clientInput.value.trim();state.clientQuery=clientInput.value;
    if(!query){clientResults.hidden=true;clientInput.setAttribute('aria-expanded','false');clientResults.replaceChildren();return}
    const found=clients.filter(c=>match(c,query)).slice(0,8);
    clientInput.setAttribute('aria-expanded','true');clientResults.hidden=false;
    clientResults.replaceChildren(found.length?h('ul',{class:'list'},found.map(c=>h('li',{},h('button',{type:'button',class:'row','role':'option','aria-selected':'false',onclick:()=>chooseClient(c)},clientAvatar(h,c),
      h('span',{class:'row-body'},h('span',{class:'row-title'},c.name),h('span',{class:'row-sub'},c.doc)),icon('chevron',18))))):h('p',{class:'empty'},icon('users',22),'Nenhum cliente encontrado.'));
  };
  const paintPreview=()=>{
    const debt=debts.find(d=>d.id===state.debtId),count=Number(countInput.value);
    balance.textContent=debt?`Saldo atual da dívida: ${M.brl(debt.principal)}`:'Selecione uma dívida para exibir o saldo atual.';
    if(!debt||!Number.isInteger(count)||count<1||count>60||!validDate(state.firstDueDate)){preview.replaceChildren();return}
    try{
      const rows=splitInstallments(debt.principal,count,state.firstDueDate);
      preview.replaceChildren(h('h3',{class:'subhead'},'Prévia das parcelas'),h('p',{class:'muted'},`${count} parcela(s) · total ${M.brl(debt.principal)} · sem juros adicionais`),
        h('div',{class:'installment-table-wrap'},h('table',{class:'installment-table'},h('thead',{},h('tr',{},h('th',{},'Parcela'),h('th',{},'Valor'),h('th',{},'Vencimento'))),
          h('tbody',{},rows.map(x=>h('tr',{},h('td',{},String(x.number)),h('td',{},M.brl(x.amountCents)),h('td',{},dBR(x.dueDate))))))));
    }catch{preview.replaceChildren()}
  };
  const syncDebtSelect=()=>{
    const opts=eligible();
    debtSelect.replaceChildren(h('option',{value:''},state.clientId?'Selecione uma dívida':'Selecione primeiro um cliente'),...opts.map(d=>h('option',{value:d.id,selected:d.id===state.debtId},debtDescription(d))));
    if(!opts.some(d=>d.id===state.debtId))state.debtId='';
    const submit=planForm.querySelector('button[type=submit]');
    if(submit)submit.disabled=!state.debtId;
    debtSelect.onchange=e=>{state.debtId=e.target.value;if(submit)submit.disabled=!state.debtId;paintPreview()};
  };
  const paintForm=()=>{
    syncDebtSelect();
    const submit=h('button',{type:'submit',class:'primary',disabled:!state.debtId},'Gerar parcelamento');
    debtSelect.onchange=e=>{state.debtId=e.target.value;submit.disabled=!state.debtId;paintPreview()};
    planForm.replaceChildren(h('h2',{},'Criar parcelamento'),
      h('div',{class:'form-grid'},field('installment-client-search','Cliente',clientPicker),field('installment-debt','Dívida do cliente',debtSelect),field('installment-count','Quantidade de parcelas (1 a 60)',countInput),field('installment-start','Início do parcelamento',startInput),field('installment-first-due','Vencimento da 1ª parcela',dueInput)),
      h('p',{class:'muted'},'As parcelas não incluem juros adicionais. Os juros da dívida continuam calculados sobre o principal restante.'),
      balance,preview,err,h('div',{class:'form-actions'},submit));
    paintClientSearch();paintPreview();
  };
  const paintPlans=()=>{
    if(!plans.length){plansOut.replaceChildren(h('p',{class:'empty'},icon('wallet',26),'Nenhum parcelamento cadastrado.'));return}
    plansOut.replaceChildren(...plans.map(p=>{
      const debt=p.debt,rows=(p.items||[]).map(item=>h('tr',{},h('td',{},String(item.number)),h('td',{},M.brl(item.amountCents)),h('td',{},dBR(item.dueDate)),
        h('td',{},h('input',{type:'checkbox',checked:!!item.paidAt,'aria-label':`${item.paidAt?'Desmarcar':'Marcar'} parcela ${item.number} ${item.paidAt?'como não paga':'como paga'}`,onchange:async e=>{
          const checkbox=e.currentTarget;checkbox.disabled=true;err.textContent='';
          try{await S.setPaid(p.id,item.number,checkbox.checked);await load()}
          catch(x){err.textContent=x.message;await load()}
          finally{if(checkbox.isConnected)checkbox.disabled=false}
        }}))));
      const remove=h('button',{type:'button',class:'danger',onclick:async e=>{
        const current=debt?M.brl(debt.principal):'não disponível';
        if(!globalThis.confirm(`Excluir o parcelamento de ${p.clientName} · ${debt?.description||'dívida'}?\n\nO saldo atual da dívida (${current}) será mantido exatamente como está. Valores de parcelas já marcadas como pagas continuarão descontados.`))return;
        const button=e.currentTarget;button.disabled=true;err.textContent='';
        try{await S.deletePlan(p.id);await load()}
        catch(x){err.textContent=x.message;await load()}
        finally{if(button.isConnected)button.disabled=false}
      }},'Excluir parcelamento');
      return h('section',{class:'card installment-plan'},h('div',{class:'section-head'},h('div',{},h('h2',{},`${p.clientName} · ${debt?.description||'Dívida não encontrada'}`),h('p',{class:'muted'},`Saldo atual da dívida: ${M.brl(debt?.principal||0)}`)),
          h('div',{class:'installment-plan-actions'},h('span',{class:'badge'},`${p.count} ${p.count===1?'parcela':'parcelas'}`),remove)),
        h('div',{class:'installment-table-wrap'},h('table',{class:'installment-table'},h('thead',{},h('tr',{},h('th',{},'Parcela'),h('th',{},'Valor'),h('th',{},'Vencimento'),h('th',{},'Marcar'))),h('tbody',{},rows))));
    }));
  };
  const load=async()=>{
    if(!isUnlocked())return;
    [clients,debts,plans]=await Promise.all([C.listClients(),D.listDebts(),S.listPlans()]);
    if(!isUnlocked())return;
    clients.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    paintForm();paintPlans();
  };
  const top=h('header',{class:'top','data-page':'installments'},h('div',{class:'head'},h('button',{type:'button',class:'iconbtn back','aria-label':'Voltar ao início',onclick:home},icon('back',20)),h('h1',{},'Parcelamentos')));
  show(top,planForm,h('section',{class:'installment-section'},h('h2',{},'Parcelamentos registrados'),plansOut));
  watch(load);await load();
}
