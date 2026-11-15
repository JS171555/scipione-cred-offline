import*as R from '../export/reports.js';import*as B from '../export/backup.js';import*as M from '../domain/money.js';import{save}from '../export/lib.js';import{unwatch}from '../core/live.js';import{todayISO}from '../domain/due.js';import{icon}from './icons.js';import{filePicker}from './kit.js';
const dBR=s=>s?s.split('-').reverse().join('/'):'—';
const top=(h,page,t,back)=>h('header',{class:'top','data-page':page},
  h('div',{class:'head'},h('button',{type:'button',class:'iconbtn back','aria-label':'Voltar',onclick:back},icon('back',20)),h('h1',{},t)));
const fld=(h,id,l,el,full)=>h('div',{class:'field'+(full?' field--full':'')},h('label',{for:id},l),el);
export function reportsView(X){
  unwatch();const{h,show,home}=X;let mode='month';
  const err=h('p',{class:'error',role:'alert'}),paper=h('div',{class:'report port',role:'region','aria-label':'Pré-visualização do relatório'});
  const dayI=h('input',{id:'pd',type:'date',value:todayISO()}),monI=h('input',{id:'pn',type:'month',value:todayISO().slice(0,7)}),dv=fld(h,'pd','Data',dayI),mv=fld(h,'pn','Mês',monI);dv.hidden=true;
  const pm=h('select',{id:'pm',onchange:e=>{mode=e.target.value;dv.hidden=mode!=='day';mv.hidden=mode!=='month'}},h('option',{value:'month'},'Movimentações do mês'),h('option',{value:'day'},'Movimentações do dia'));
  const po=h('select',{id:'po'},h('option',{value:'port'},'Retrato (A4)'),h('option',{value:'land'},'Paisagem (A4)'));
  const period=()=>{const value=mode==='day'?dayI.value:monI.value;if(!value)throw new Error('Selecione o período.');return{mode,value}};
  const run=fn=>async()=>{err.textContent='';try{await fn()}catch(x){err.textContent=x.message}};
  const report=(p,d)=>[h('h1',{},'SCIPIONE CRED'),h('p',{},h('strong',{},'Relatório de dívidas'),` — ${R.label(p)}`),h('p',{},`Gerado em ${new Date().toLocaleString('pt-BR')}`),
    d.debts.length?h('div',{},h('p',{class:'report-hint'},'Deslize a tabela para o lado para ver todas as colunas.'),h('div',{class:'tw'},h('table',{},
      h('colgroup',{},...['client','interest','principal','rate','date','notes'].map(c=>h('col',{class:'c-'+c}))),
      h('thead',{},h('tr',{},...[['Nome do cliente',''],['Juros valor no mês','n'],['Valor emprestado','n'],['%','n'],['Data',''],['Observações','']].map(([t,c])=>h('th',{class:c},t)))),
      h('tbody',{},d.debts.map(x=>h('tr',{},h('td',{},x.client),h('td',{class:'n'},M.brl(x.interest)),h('td',{class:'n'},M.brl(x.principal)),h('td',{class:'n'},M.rate(x.rate)),h('td',{},dBR(x.due)),h('td',{},x.notes||x.description)))),
      h('tfoot',{},h('tr',{},h('td',{},`Total (${d.debts.length})`),h('td',{class:'n'},M.brl(d.interest)),h('td',{class:'n'},M.brl(d.principal)),h('td',{colspan:3})))))):h('p',{},'Nenhuma dívida registrada neste período.'),
    h('p',{},'Data: vencimento de cada dívida.')];
  show(top(h,'reports','Relatórios',home),
    h('section',{class:'card'},h('h2',{},'Período e formato'),
      h('div',{class:'form-grid'},fld(h,'pm','Período',pm),dv,mv,fld(h,'po','Orientação da impressão',po,true)),
      h('div',{class:'actions actions--grid'},
        h('button',{class:'primary span-2',onclick:run(async()=>{const p=period();paper.className='report '+po.value;paper.replaceChildren(...report(p,await R.load(p)))})},'Visualizar relatório'),
        h('button',{onclick:run(async()=>{const p=period(),d=await R.load(p);if(!d.debts.length&&!d.moves.length)throw new Error('Nenhum registro neste período.');
          save(new Blob([await R.xlsxBytes(d)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`scipione-cred-${p.value}.xlsx`)})},'Exportar Excel'),
        h('button',{onclick:run(async()=>{if(!paper.childElementCount)throw new Error('Visualize o relatório antes de imprimir.');paper.className='report '+po.value;print()})},'Imprimir')),
      err),paper);
}
export function backupView(X){
  unwatch();const{h,show,home}=X;let parsed=null;
  const err=h('p',{class:'error',role:'alert'}),ok=h('p',{class:'info',role:'status'}),clear=()=>{err.textContent=ok.textContent=''};
  const enc=h('input',{id:'be',type:'checkbox',checked:true}),pw=h('input',{id:'bp',type:'password',autocomplete:'new-password'}),pw2=h('input',{id:'bp2',type:'password',autocomplete:'new-password'});
  const bp=fld(h,'bp','Senha do backup',pw),bp2=fld(h,'bp2','Repita a senha do backup',pw2);
  enc.onchange=()=>{bp.hidden=bp2.hidden=!enc.checked};
  const gen=h('button',{class:'primary',onclick:async()=>{clear();try{let pass=null;
    if(enc.checked){if(pw.value.length<8)throw new Error('A senha do backup deve ter ao menos 8 caracteres.');if(pw.value!==pw2.value)throw new Error('As senhas do backup não coincidem.');pass=pw.value}
    else if(!confirm('Este backup NÃO será criptografado: conterá todos os dados e documentos em formato legível. Continuar?'))return;
    gen.disabled=true;const z=await B.createBackup(pass),st=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    save(new Blob([z],{type:'application/zip'}),`scipione-cred-backup-${st}${pass?'-criptografado':''}.zip`);pw.value=pw2.value='';
    ok.textContent=pass?'Backup criptografado gerado. Sem a senha do backup não é possível restaurá-lo.':'Backup gerado, sem criptografia.'}catch(x){err.textContent=x.message}finally{gen.disabled=false}}},'Gerar backup');
  const file=h('input',{id:'rf',type:'file',accept:'.zip,application/zip'}),rpw=h('input',{id:'rp',type:'password',autocomplete:'off'}),info=h('div');
  const check=h('button',{onclick:async()=>{clear();parsed=null;info.replaceChildren();check.disabled=true;try{const f=file.files[0];if(!f)throw new Error('Selecione o arquivo de backup.');
    parsed=await B.readBackup(new Uint8Array(await f.arrayBuffer()),rpw.value||undefined);const c=parsed.manifest.counts,mode=h('select',{id:'rm'},h('option',{value:'merge'},'Mesclar com os dados atuais'),h('option',{value:'replace'},'Substituir tudo'));
    const go=h('button',{class:'primary',onclick:async()=>{clear();const rep=mode.value==='replace';
      if(!confirm(rep?'ATENÇÃO: todos os clientes, dívidas, documentos e histórico atuais serão APAGADOS e substituídos pelo backup. Se necessário, gere um backup do estado atual antes. Continuar?':'Os dados do backup serão adicionados. Clientes com o mesmo CPF/CNPJ não serão duplicados. Continuar?'))return;
      go.disabled=true;try{const s=await B.restore(parsed.data,mode.value);ok.textContent=`Restauração concluída: ${s.clients} cliente(s), ${s.debts} dívida(s), ${s.documents} documento(s), ${s.history} registro(s) de histórico.`;info.replaceChildren();parsed=null}catch(x){err.textContent='Nada foi alterado. '+x.message;go.disabled=false}}},'Restaurar');
    info.replaceChildren(h('p',{},`Backup de ${new Date(parsed.manifest.createdAt).toLocaleString('pt-BR')}: ${c.clients} cliente(s), ${c.debts} dívida(s), ${c.documents} documento(s), ${c.history} registro(s) de histórico. Integridade verificada.`),fld(h,'rm','Modo de restauração',mode),h('div',{class:'actions'},go))}
    catch(x){err.textContent=x.message}finally{check.disabled=false}}},'Verificar arquivo');
  show(top(h,'backup','Backup e restauração',home),
    h('section',{class:'card'},h('h2',{},'Gerar backup'),
      h('label',{class:'check'},enc,'Criptografar com senha (recomendado)'),
      h('div',{class:'form-grid'},bp,bp2),
      h('p',{class:'muted'},'Esta senha é independente da senha do cofre e é necessária para restaurar. Backup sem criptografia contém tudo em formato legível.'),
      h('div',{class:'actions'},gen)),
    h('section',{class:'card'},h('h2',{},'Restaurar ou importar'),
      h('div',{class:'form-grid'},fld(h,'rf','Arquivo de backup (.zip)',filePicker(h,file,'Escolher arquivo'),true),fld(h,'rp','Senha do backup (se criptografado)',rpw,true)),
      h('div',{class:'actions'},check),info),err,ok);
}
