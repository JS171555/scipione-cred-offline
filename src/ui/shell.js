// Camada visual: navegação persistente (barra inferior no celular, trilho no tablet, menu lateral no desktop),
// ícones nos botões, utilidades do cabeçalho e destaque de ações destrutivas.
// NÃO altera nenhuma regra: apenas observa a tela renderizada e chama as mesmas funções de navegação.
import{icon}from './icons.js';
const MAP=[[/^Voltar/,'back'],[/^(Novo cliente|Nova dívida|Adicionar documento)/,'plus'],[/^(Editar|Salvar alterações)/,'edit'],
  [/^Substituir fotografia/,'refresh'],[/^Adicionar fotografia/,'camera'],[/^(Excluir|Remover)/,'trash'],[/^(Abrir|Visualizar|Pré-visualizar)/,'eye'],
  [/^(Baixar|Exportar|Gerar backup|Instalar)/,'download'],[/^(Pesquisar|Buscar)/,'search'],[/^Juros em lote/,'percent'],
  [/^Imprimir/,'print'],[/^Bloquear/,'lock'],[/^Sair/,'logout'],[/^Testar/,'shield'],[/^(Verificar|Restaurar)/,'upload'],
  [/^Confirmar/,'check'],[/^Salvar janela/,'check'],[/^Relatórios/,'file']];
export function initShell({ctx,home,clients,debts,reports,backup,lock}){
  const{h}=ctx(),nav=document.getElementById('nav'),root=document.getElementById('app');
  let navBusy=null,navTimer=0,navStarted=0;
  const navClear=()=>{if(navBusy){navBusy.classList.remove('is-loading');navBusy.removeAttribute('aria-busy');navBusy=null}root.removeAttribute('aria-busy');clearTimeout(navTimer)};
  const navStop=()=>{if(!navBusy)return;const wait=Math.max(0,320-(performance.now()-navStarted));if(wait){clearTimeout(navTimer);navTimer=setTimeout(navStop,wait);return}navClear()};
  const navStart=btn=>{navClear();navBusy=btn;navStarted=performance.now();btn.classList.add('is-loading');btn.setAttribute('aria-busy','true');root.setAttribute('aria-busy','true');navTimer=setTimeout(navStop,1800)};
  const item=(k,l,i,fn,c='')=>{const b=h('button',{type:'button','data-k':k,'data-i':'1',class:c,'aria-label':l},icon(i,21),h('span',{},l));
    b.addEventListener('click',()=>{navStart(b);try{const r=fn();if(r&&typeof r.then==='function')r.then(navStop,navStop)}catch(e){navStop();throw e}});return b};
  const busyButtons=new Set(),busyStarted=new WeakMap(),busyTimers=new WeakMap();
  const busyClear=btn=>{if(!busyButtons.has(btn))return;busyButtons.delete(btn);busyStarted.delete(btn);clearTimeout(busyTimers.get(btn));busyTimers.delete(btn);btn.classList.remove('is-loading');btn.removeAttribute('aria-busy')};
  const busyStop=btn=>{if(!busyButtons.has(btn))return;const wait=Math.max(0,340-(performance.now()-(busyStarted.get(btn)||0)));if(wait){if(!busyTimers.has(btn))busyTimers.set(btn,setTimeout(()=>{busyTimers.delete(btn);busyClear(btn)},wait));return}busyClear(btn)};
  const busyStart=btn=>{if(!btn||busyButtons.has(btn))return;busyButtons.add(btn);busyStarted.set(btn,performance.now());btn.classList.add('is-loading');btn.setAttribute('aria-busy','true');
    const obs=new MutationObserver(()=>{if(!btn.disabled){busyStop(btn);obs.disconnect()}});obs.observe(btn,{attributes:true,attributeFilter:['disabled']});
    setTimeout(()=>{busyStop(btn);obs.disconnect()},4500)};
  const asyncTarget=b=>b&&!b.closest('#nav')&&!b.classList.contains('row')&&!b.classList.contains('iconbtn');
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(!asyncTarget(b))return;setTimeout(()=>{if(b.isConnected&&b.disabled)busyStart(b)},0)});
  document.addEventListener('submit',e=>{const b=e.target.querySelector('button[type="submit"]');if(!b)return;setTimeout(()=>{if(b.isConnected&&b.disabled)busyStart(b)},0)},true);
  addEventListener('data-changed',()=>setTimeout(()=>{for(const b of[...busyButtons])if(b.type!=='submit')busyStop(b)},650));
  nav.replaceChildren(
    h('div',{class:'nb'},h('span',{class:'mark','aria-hidden':'true'},h('img',{src:'assets/img/hat.webp',alt:''})),
      h('span',{class:'brandtext'},h('span',{class:'word'},'SCIPIONE CRED'),h('span',{class:'sub'},'Gestão de crédito'))),
    item('home','Início','home',()=>home()),item('clients','Clientes','users',()=>clients(ctx())),
    item('debts','Dívidas','wallet',()=>debts(ctx())),item('reports','Relatórios','file',()=>reports(ctx())),
    item('backup','Backup','db',()=>backup(ctx())),
    h('div',{class:'sp'}),
    item('lock','Bloquear','lock',()=>lock('manual'),'lock'),item('out','Sair','logout',()=>lock('logout'),'out'));
  const util=()=>{
    for(const hd of root.querySelectorAll('header.top')){
      if(hd.querySelector(':scope > .util'))continue;
      hd.append(h('div',{class:'util'},
        h('button',{type:'button',class:'iconbtn','aria-label':'Bloquear cofre',title:'Bloquear',onclick:()=>lock('manual')},icon('lock',20)),
        h('button',{type:'button',class:'iconbtn','aria-label':'Sair da conta',title:'Sair',onclick:()=>lock('logout')},icon('logout',20))));
    }
  };
  const sync=()=>{
    navStop();
    const auth=!!root.querySelector('.auth,.brand');
    nav.hidden=auth;document.body.classList.toggle('shell',!auth);
    if(!auth){
      const page=root.querySelector('header.top')?.dataset.page||'';
      const k=/^client/.test(page)?'clients':/^debt/.test(page)?'debts':page==='bulk'?'clients':page||'home';
      nav.querySelectorAll('[data-k]').forEach(b=>k===b.dataset.k?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
      util();
    }
    root.querySelectorAll('button:not([data-i])').forEach(b=>{
      b.dataset.i='1';if(b.classList.contains('iconbtn'))return;
      const t=b.textContent.trim(),m=t&&MAP.find(([r])=>r.test(t));
      if(m)b.prepend(icon(m[1],18));if(/^(Excluir|Remover)/.test(t))b.classList.add('danger');
    });
  };
  let q=0;new MutationObserver(()=>{if(!q)q=requestAnimationFrame(()=>{q=0;sync()})}).observe(root,{childList:true,subtree:true});sync();
}
