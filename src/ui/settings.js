import * as A from '../security/auth.js';
import * as db from '../db/idb.js';
import * as P from '../pwa.js';
import {sealJSON,openJSON} from '../security/crypto.js';
import {getDueWindow,setDueWindow} from '../services/settings.js';
import {unwatch} from '../core/live.js';
import {icon} from './icons.js';

// Apresentação da tela de configurações. Os handlers são os mesmos usados
// anteriormente na página inicial e em Dívidas; nenhuma regra foi alterada.
const mb=n=>{if(n==null)return'indisponível';const m=n/1048576;return m>=1024?(m/1024).toFixed(1).replace('.',',')+' GB':m.toFixed(1).replace('.',',')+' MB'};
const top=(h,t,back)=>h('header',{class:'top','data-page':'settings'},
  h('div',{class:'head'},h('button',{type:'button',class:'iconbtn back','aria-label':'Voltar',onclick:back},icon('back',20)),h('h1',{},t)));

export async function settingsView(X){
  unwatch();
  const{h,show,home,fmt}=X;
  const[st,off,win0]=await Promise.all([P.storageInfo(),P.offlineReady(),getDueWindow()]);
  if(!A.isUnlocked())return;
  const toast=h('div',{class:'toast',role:'status','aria-live':'polite','aria-atomic':'true',hidden:true});
  let toastTimer=0,toastOutTimer=0;
  const hideToast=()=>{clearTimeout(toastTimer);toast.classList.add('is-out');toastOutTimer=setTimeout(()=>{toast.hidden=true;toast.classList.remove('is-out')},240)};
  const flash=(t,bad)=>{clearTimeout(toastTimer);clearTimeout(toastOutTimer);toast.hidden=false;toast.className='toast'+(bad?' bad':'');toast.textContent=t;
    toast.style.animation='none';void toast.offsetWidth;toast.style.animation='';
    toastTimer=setTimeout(hideToast,bad?5000:3400)};
  const row=(k,v)=>h('div',{},h('dt',{},k),h('dd',{},v));

  const idle=h('select',{id:'idle',onchange:async e=>{try{await A.setIdle(+e.target.value);flash('Bloqueio automático salvo.')}catch(x){flash(fmt(x),true)}}},
    [1,5,15,30].map(m=>h('option',{value:m,selected:m===A.getIdle()},`${m} min`)));
  const test=h('button',{onclick:async()=>{test.disabled=true;try{
    const probe={at:Date.now(),n:[...crypto.getRandomValues(new Uint8Array(8))]},k=A.getKey();
    await db.put('meta',{key:'probe',data:await sealJSON(k,probe)});
    const back=await openJSON(k,(await db.get('meta','probe')).data);
    if(JSON.stringify(back)!==JSON.stringify(probe))throw new Error('Os dados lidos diferem dos gravados.');
    flash('Gravação criptografada e leitura confirmadas.');
  }catch(x){flash(fmt(x),true)}finally{test.disabled=false}}},'Testar gravação e leitura');

  const inst=h('div');
  const paintInst=()=>inst.replaceChildren(P.isStandalone()?h('p',{class:'muted'},'O aplicativo já está instalado.'):P.canInstall()?h('button',{onclick:async()=>{await P.install();paintInst()}},'Instalar aplicativo'):h('p',{class:'muted'},P.isIOS()?'No iPhone: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.':'Use o menu do navegador e escolha “Instalar aplicativo” (Chrome/Edge no Android e Windows).'));
  paintInst();P.onInstallable(paintInst);

  const wd=h('input',{id:'wd',type:'number',min:1,max:365,value:win0});
  const saveWin=async()=>{const n=Math.round(+wd.value);if(!(n>=1&&n<=365)){flash('Informe de 1 a 365 dias.',true);return}
    try{await setDueWindow(n);flash('Janela de vencimentos salva.')}catch(x){flash(fmt(x),true)}};

  show(top(h,'Configurações',home),
    h('div',{class:'cols settings-grid'},
      h('div',{class:'col'},
        h('section',{class:'card'},h('h2',{},'Sistema'),
          h('dl',{class:'meta'},row('Banco local',`versão ${db.DB_VERSION}`),row('Armazenamento persistente',st.persisted?'Concedido':'Não concedido'),
            row('Espaço usado',`${mb(st.usage)} de ${mb(st.quota)}`),row('Funciona offline',off?'Sim':'Após o primeiro carregamento'))),
        h('section',{class:'card'},h('h2',{},'Segurança'),
          h('div',{class:'field'},h('label',{for:'idle'},'Bloquear após inatividade de'),idle),
          h('div',{class:'actions'},h('button',{onclick:()=>A.lock('manual')},'Bloquear agora')),
          h('h3',{class:'subhead'},'Integridade'),
          h('div',{class:'actions'},test))),
      h('div',{class:'col'},
        h('section',{class:'card install'},h('h2',{},'Instalação'),inst),
        h('section',{class:'card due-settings'},h('h2',{},'Vencimentos'),
          h('p',{class:'muted'},'Define quantos dias antes do vencimento uma dívida passa a ser sinalizada como “prestes a vencer”.'),
          h('div',{class:'inline-form'},h('div',{class:'field'},h('label',{for:'wd'},'Janela em dias'),wd),
            h('button',{class:'ghost',onclick:saveWin},'Salvar janela'))))),
    toast);
}
