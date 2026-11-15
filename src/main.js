import * as A from './security/auth.js';
import * as db from './db/idb.js';
import*as P from './pwa.js';
import{clientsView,debtsPageView,openProfile}from './ui/clients.js';import*as Dash from './ui/dashboard.js';import{reportsView,backupView}from './ui/tools.js';import{initShell}from './ui/shell.js';import{unwatch}from './core/live.js';import{longDay}from './ui/kit.js';
import{sealJSON,openJSON}from './security/crypto.js';
const root=document.getElementById('app');
const h=(t,a={},...k)=>{const e=document.createElement(t);for(const[n,v]of Object.entries(a)){if(n.startsWith('on'))e.addEventListener(n.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(n,v===true?'':v)}e.append(...k.flat().filter(x=>x!=null&&x!==false));return e};
const show=(...n)=>root.replaceChildren(...n);
const ctx=()=>({h,show,fmt,home:appView});
const fmt=e=>e?.name==='QuotaExceededError'?'Sem espaço de armazenamento no aparelho. Libere espaço e tente de novo.':(e?.message||'Erro inesperado.');
const mb=n=>{if(n==null)return'indisponível';const m=n/1048576;return m>=1024?(m/1024).toFixed(1).replace('.',',')+' GB':m.toFixed(1).replace('.',',')+' MB'};
const field=(id,label,ac)=>h('div',{class:'field'},h('label',{for:id},label),h('input',{id,type:'password',autocomplete:ac,required:true}));

function authView(setup,notice){
  document.body.classList.add('authing');
  const err=h('p',{class:'error',role:'alert'}),btn=h('button',{class:'primary',type:'submit'},setup?'Criar cofre':'Desbloquear');
  const form=h('form',{class:'card auth',novalidate:true,onsubmit:async e=>{
    e.preventDefault();err.textContent='';btn.disabled=true;const f=form.elements;
    try{
      if(setup){
        if(f.pw.value.length<8)throw new Error('Use ao menos 8 caracteres.');
        if(f.pw.value!==f.pw2.value)throw new Error('As senhas não coincidem.');
        if(!f.ack.checked)throw new Error('Confirme que entendeu que a senha não pode ser recuperada.');
        await A.setup(f.pw.value);
      }else await A.unlock(f.pw.value);
      form.reset();appView();
    }catch(x){err.textContent=fmt(x)}finally{btn.disabled=false}}},
    h('h2',{},setup?'Crie a senha do cofre':'Acesso ao cofre'),
    notice&&h('p',{class:'info',role:'status'},notice),
    setup&&h('p',{class:'muted'},'Os dados ficam só neste aparelho, criptografados com esta senha.'),
    field('pw',setup?'Senha':'Senha do cofre',setup?'new-password':'current-password'),
    setup&&field('pw2','Repita a senha','new-password'),
    setup&&h('label',{class:'check'},h('input',{type:'checkbox',id:'ack'}),'Entendo que, se eu esquecer a senha, os dados não poderão ser recuperados.'),
    err,btn,
    h('p',{class:'foot'},'Criptografia AES-GCM · chave derivada com PBKDF2 · nada sai do aparelho'));
  const brand=h('div',{class:'brand'},
    h('span',{class:'mark brand-mark','aria-hidden':'true'},h('img',{src:'assets/img/hat.webp',alt:''})),
    h('h1',{},'SCIPIONE CRED'),h('p',{class:'tag'},'Gestão de clientes e dívidas'));
  const visual=h('section',{class:'auth-visual','aria-hidden':'true'},
    h('img',{class:'auth-photo',src:'assets/img/office.webp',alt:''}),
    h('div',{class:'auth-quote'},h('p',{class:'eyebrow'},'Cofre privado'),
      h('p',{class:'quote-line'},'Seu crédito,',h('br'),'em ordem.')));
  show(h('div',{class:'auth-shell'},visual,h('section',{class:'auth-panel'},brand,form)));
}
async function appView(){
  document.body.classList.remove('authing');
  unwatch();P.requestPersist();
  const toast=h('div',{class:'toast',role:'status','aria-live':'polite','aria-atomic':'true',hidden:true});
  let toastTimer=0,toastOutTimer=0;
  const hideToast=()=>{clearTimeout(toastTimer);toast.classList.add('is-out');toastOutTimer=setTimeout(()=>{toast.hidden=true;toast.classList.remove('is-out')},240)};
  const flash=(t,bad)=>{clearTimeout(toastTimer);clearTimeout(toastOutTimer);toast.hidden=false;toast.className='toast'+(bad?' bad':'');toast.textContent=t;
    toast.style.animation='none';void toast.offsetWidth;toast.style.animation='';
    toastTimer=setTimeout(hideToast,bad?5000:3400)};
  const[st,off]=await Promise.all([P.storageInfo(),P.offlineReady()]);
  const dash=await Dash.card({h,search:q=>clientsView(ctx(),q),openClient:id=>openProfile(ctx(),id),openDebts:()=>debtsPageView(ctx()),openClients:()=>clientsView(ctx())});
  const row=(k,v)=>h('div',{},h('dt',{},k),h('dd',{},v));
  const idle=h('select',{id:'idle',onchange:async e=>{try{await A.setIdle(+e.target.value);flash('Bloqueio automático salvo.')}catch(x){flash(fmt(x),true)}}},[1,5,15,30].map(m=>h('option',{value:m,selected:m===A.getIdle()},`${m} min`)));
  const test=h('button',{onclick:async()=>{test.disabled=true;try{
    const probe={at:Date.now(),n:[...crypto.getRandomValues(new Uint8Array(8))]},k=A.getKey();
    await db.put('meta',{key:'probe',data:await sealJSON(k,probe)});
    const back=await openJSON(k,(await db.get('meta','probe')).data);
    if(JSON.stringify(back)!==JSON.stringify(probe))throw new Error('Os dados lidos diferem dos gravados.');
    flash('Gravação criptografada e leitura confirmadas.');
  }catch(x){flash(fmt(x),true)}finally{test.disabled=false}}},'Testar gravação e leitura');
  const inst=h('div');const paintInst=()=>inst.replaceChildren(P.isStandalone()?h('p',{class:'muted'},'O aplicativo já está instalado.'):P.canInstall()?h('button',{onclick:async()=>{await P.install();paintInst()}},'Instalar aplicativo'):h('p',{class:'muted'},P.isIOS()?'No iPhone: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.':'Use o menu do navegador e escolha “Instalar aplicativo” (Chrome/Edge no Android e Windows).'));
  paintInst();P.onInstallable(paintInst);
  const hoje=longDay(new Date());
  show(
    h('header',{class:'top brandbar','data-page':'home'},
      h('div',{class:'head'},h('span',{class:'mark','aria-hidden':'true'},h('img',{src:'assets/img/hat.webp',alt:''})),
        h('span',{class:'brandtext'},h('span',{class:'word'},'SCIPIONE CRED')))),
    h('section',{class:'hero'},h('p',{class:'eyebrow'},'Visão geral'),h('h1',{},'Seu crédito, em ordem'),
      h('p',{},hoje.charAt(0).toUpperCase()+hoje.slice(1))),
    ...dash,
    h('div',{class:'cols'},
      h('div',{class:'col'},
        h('section',{class:'card'},h('h2',{},'Relatórios e backup'),
          h('p',{class:'muted'},'Exporte planilhas, imprima relatórios e mantenha cópias de segurança dos seus dados.'),
          h('div',{class:'actions'},h('button',{onclick:()=>reportsView(ctx())},'Relatórios e Excel'),h('button',{onclick:()=>backupView(ctx())},'Backup e restauração'))),
        h('section',{class:'card'},h('h2',{},'Sistema'),
          h('dl',{class:'meta'},row('Banco local',`versão ${db.DB_VERSION}, aberto`),row('Armazenamento persistente',st.persisted?'Concedido':'Não concedido'),
            row('Espaço usado',`${mb(st.usage)} de ${mb(st.quota)}`),row('Funciona offline',off?'Sim':'Após o primeiro carregamento')))),
      h('div',{class:'col'},
        h('section',{class:'card'},h('h2',{},'Segurança'),
          h('div',{class:'field'},h('label',{for:'idle'},'Bloquear após inatividade de'),idle),
          h('div',{class:'actions'},h('button',{onclick:()=>A.lock('manual')},'Bloquear agora')),
          h('h3',{class:'subhead'},'Integridade'),
          h('div',{class:'actions'},test)))),
    h('section',{class:'card install'},h('h2',{},'Instalação'),inst),
    toast);
}
A.onLock(r=>authView(false,r==='idle'?'Bloqueado por inatividade.':r==='logout'?'Sessão encerrada.':null));
P.registerSW();
(async()=>{try{const has=await A.hasVault();if(has&&await A.restoreSession()){await appView();return}authView(!has)}catch(e){show(h('div',{class:'card auth'},h('h2',{},'Não foi possível abrir o banco local'),h('p',{class:'error'},fmt(e))))}})();

initShell({ctx,home:()=>appView(),clients:clientsView,debts:debtsPageView,reports:reportsView,backup:backupView,lock:A.lock});
