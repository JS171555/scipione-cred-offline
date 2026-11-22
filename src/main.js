import * as A from './security/auth.js';
import*as P from './pwa.js';
import{clientsView,debtsPageView,openProfile}from './ui/clients.js';import{installmentsView}from'./ui/installments.js';import*as Dash from './ui/dashboard.js';import{reportsView,backupView}from './ui/tools.js';import{settingsView}from './ui/settings.js';import{initShell}from './ui/shell.js';import{unwatch}from './core/live.js';import{longDay}from './ui/kit.js';
const root=document.getElementById('app');
const h=(t,a={},...k)=>{const e=document.createElement(t);for(const[n,v]of Object.entries(a)){if(n.startsWith('on'))e.addEventListener(n.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(n,v===true?'':v)}e.append(...k.flat().filter(x=>x!=null&&x!==false));return e};
const show=(...n)=>root.replaceChildren(...n);
const ctx=()=>({h,show,fmt,home:appView});
const fmt=e=>e?.name==='QuotaExceededError'?'Sem espaço de armazenamento no aparelho. Libere espaço e tente de novo.':(e?.message||'Erro inesperado.');
const field=(id,label,ac)=>h('div',{class:'field'},h('label',{for:id},label),h('input',{id,type:'password',autocomplete:ac,required:true}));

function authView(setup,notice){
  unwatch();
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
  const brand=h('div',{class:'brand brand--login'},
    h('img',{class:'brand-logo',src:'assets/img/scipione-cred-logo.png',alt:'SCIPIONE Cred'}),
    h('p',{class:'tag'},'Gestão de clientes e dívidas'));
  const visual=h('section',{class:'auth-visual','aria-hidden':'true'},
    h('img',{class:'auth-photo',src:'assets/img/office.webp',alt:''}),
    h('img',{class:'auth-photo alt',src:'assets/img/office-desk.webp',alt:''}),
    h('div',{class:'auth-quote'},h('p',{class:'eyebrow'},'Cofre privado'),
      h('p',{class:'quote-line'},'Seu crédito,',h('br'),'em ordem.')));
  show(h('div',{class:'auth-shell'},visual,h('section',{class:'auth-panel'},brand,form)));
}
async function appView(){
  document.body.classList.remove('authing');
  unwatch();P.requestPersist();
  const dash=await Dash.card({h,search:q=>clientsView(ctx(),q),openClient:id=>openProfile(ctx(),id),openDebts:()=>debtsPageView(ctx()),openClients:()=>clientsView(ctx())});
  if(!A.isUnlocked())return;
  const hoje=longDay(new Date());
  show(
    h('header',{class:'top brandbar','data-page':'home'},
      h('div',{class:'head'},h('span',{class:'mark','aria-hidden':'true'},h('img',{src:'assets/img/hat.webp',alt:''})),
        h('span',{class:'brandtext'},h('span',{class:'word'},'SCIPIONE CRED')))),
    h('section',{class:'hero'},h('p',{class:'eyebrow'},'Visão geral'),h('h1',{},'Seu crédito, em ordem'),
      h('p',{},hoje.charAt(0).toUpperCase()+hoje.slice(1))),
    ...dash,
    h('section',{class:'card'},h('h2',{},'Relatórios e backup'),
      h('p',{class:'muted'},'Exporte planilhas, imprima relatórios e mantenha cópias de segurança dos seus dados.'),
      h('div',{class:'actions'},h('button',{onclick:()=>reportsView(ctx())},'Relatórios e Excel'),h('button',{onclick:()=>backupView(ctx())},'Backup e restauração'))));
}
A.onLock(r=>authView(false,r==='idle'?'Bloqueado por inatividade.':r==='logout'?'Sessão encerrada.':null));
P.registerSW();
(async()=>{try{const has=await A.hasVault();if(has&&await A.restoreSession()){await appView();return}authView(!has)}catch(e){show(h('div',{class:'card auth'},h('h2',{},'Não foi possível abrir o banco local'),h('p',{class:'error'},fmt(e))))}})();

initShell({ctx,home:()=>appView(),clients:clientsView,debts:debtsPageView,installments:installmentsView,reports:reportsView,backup:backupView,settings:settingsView,lock:A.lock});
