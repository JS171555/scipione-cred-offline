// Enquadramento da fotografia do cliente (telas “Novo cliente” e “Editar cliente”).
// A prévia circular vira uma área de arraste: toque no celular e no tablet, mouse no computador e
// setas no teclado. A posição é uma fração 0..1 do percurso livre de cada eixo — o mesmo conceito do
// object-position — então não depende do tamanho da tela nem do tamanho do arquivo.
// O arraste não corta e não re-encodifica nada: a fotografia enviada continua intacta no cofre e a
// posição fica como dado do cliente (photoFrame). Toda tela que mostra a foto aplica a mesma fração,
// por isso o enquadramento aparece igual no cadastro, no perfil, na lista e em qualquer aparelho.
// Nada é gravado antes de salvar; se o enquadramento não for mexido, o comportamento é o de sempre.

const clamp=v=>v<0?0:v>1?1:v;

export const centerFrame=()=>({x:.5,y:.5});
export const resetFrame=f=>{f.x=.5;f.y=.5;return f};
export const frameMoved=f=>!!f&&(Math.abs(f.x-.5)>.001||Math.abs(f.y-.5)>.001);

// Valor de object-position que reproduz o enquadramento escolhido; vazio = centralizada (padrão).
export function framePos(f){
  return f&&Number.isFinite(f.x)&&Number.isFinite(f.y)?`${(clamp(f.x)*100).toFixed(2)}% ${(clamp(f.y)*100).toFixed(2)}%`:'';
}

// Posição vinda do banco (ou de um backup): sempre válida e dentro da imagem; vazio = padrão.
export function readFrame(f){
  return f&&Number.isFinite(f.x)&&Number.isFinite(f.y)?{x:clamp(f.x),y:clamp(f.y)}:null;
}

// Percurso livre da imagem ampliada por object-fit:cover dentro da prévia. Negativo = existe sobra de
// imagem para arrastar naquele eixo; zero = a imagem já preenche o eixo e não há o que mover.
// `img` é {naturalWidth,naturalHeight} e `box` é {width,height}, então dá para conferir sem DOM.
export function panRoom(img,box){
  const w=img&&img.naturalWidth,h=img&&img.naturalHeight;
  if(!w||!h||!box||!box.width||!box.height)return{rx:0,ry:0};
  const s=Math.max(box.width/w,box.height/h);
  return{rx:box.width-w*s,ry:box.height-h*s};
}

// Tem sobra em algum eixo? Sem sobra não faz sentido oferecer o arraste.
export function canFrame(img,box){
  const o=panRoom(img,box.getBoundingClientRect());
  return o.rx<-2||o.ry<-2;
}

// Liga o arraste na prévia `box` (a imagem mostrada nela é `img`), escrevendo a posição em `f`.
// `onChange` é chamado a cada movimento, para a tela atualizar a dica e o botão centralizar.
// Devolve {apply, stop}.
export function attachFraming(img,box,f,onChange){
  const room=()=>panRoom(img,box.getBoundingClientRect());
  const apply=()=>{img.style.objectPosition=framePos(f)};
  // Desloca a imagem por frações do percurso do eixo; cada eixo trava no próprio limite.
  const pan=(dx,dy)=>{
    const o=room();
    if(o.rx<-2)f.x=clamp(f.x+dx);
    if(o.ry<-2)f.y=clamp(f.y+dy);
    apply();
  };
  const moveTo=(dx,dy)=>{
    const o=room(),rx=o.rx<-2,ry=o.ry<-2;
    if(rx)f.x=clamp(f.x+dx/o.rx);
    if(ry)f.y=clamp(f.y+dy/o.ry);
    apply();
    return rx||ry;
  };
  let start=null,pid=null;
  const down=e=>{
    if(e.button>0)return;                             // só o botão principal / toque primário
    const o=room();
    if(o.rx>=-2&&o.ry>=-2)return;                     // imagem já cabe na prévia: nada a arrastar
    start={x:e.clientX,y:e.clientY,fx:f.x,fy:f.y};pid=e.pointerId;
    box.classList.add('is-dragging');
    try{box.setPointerCapture(pid)}catch{}
    e.preventDefault();
  };
  const drag=e=>{
    if(!start||e.pointerId!==pid)return;
    e.preventDefault();
    f.x=start.fx;f.y=start.fy;                        // sempre a partir de onde o gesto começou
    moveTo(e.clientX-start.x,e.clientY-start.y);
    onChange();
  };
  const end=e=>{
    if(!start||(e&&e.pointerId!=null&&e.pointerId!==pid))return;
    box.classList.remove('is-dragging');
    try{box.releasePointerCapture(pid)}catch{}
    start=null;pid=null;
  };
  const key=e=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const step=e.shiftKey?.02:.08;
    const d={ArrowLeft:[step,0],ArrowRight:[-step,0],ArrowUp:[0,step],ArrowDown:[0,-step]}[e.key];
    // Enter e Espaço centralizam em vez de enviar o formulário (a prévia fica dentro dele).
    if(d){if(!canFrame(img,box))return;e.preventDefault();pan(d[0],d[1])}
    else if(e.key==='Home'||e.key==='Enter'||e.key===' '){e.preventDefault();resetFrame(f);apply()}
    else return;
    onChange();
  };
  box.addEventListener('pointerdown',down);
  box.addEventListener('pointermove',drag);
  box.addEventListener('pointerup',end);
  box.addEventListener('pointercancel',end);
  box.addEventListener('lostpointercapture',end);
  box.addEventListener('dragstart',e=>e.preventDefault());
  box.addEventListener('keydown',key);
  apply();
  return{apply,pan,stop(){
    end();
    box.removeEventListener('pointerdown',down);box.removeEventListener('pointermove',drag);
    box.removeEventListener('pointerup',end);box.removeEventListener('pointercancel',end);
    box.removeEventListener('lostpointercapture',end);box.removeEventListener('keydown',key);
    box.classList.remove('is-dragging');
  }};
}
