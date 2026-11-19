// Enquadramento da fotografia: as funções puras que garantem que arrastar só mostra imagem de verdade.
import assert from 'node:assert/strict';
import{centerFrame,resetFrame,frameMoved,framePos,readFrame,panRoom}from '../src/ui/photoFrame.js';

// Posição padrão e detecção de ajuste.
assert.deepEqual(centerFrame(),{x:.5,y:.5});
assert.equal(frameMoved(centerFrame()),false);
assert.equal(frameMoved({x:.5,y:.51}),true);
assert.equal(frameMoved({x:.5,y:.5005}),false,'diferença mínima não conta como ajuste');
assert.equal(frameMoved(null),false);
assert.deepEqual(resetFrame({x:.1,y:.9}),{x:.5,y:.5});

// Leitura do que está salvo: aceita só número, e sempre dentro da imagem.
assert.equal(readFrame(null),null);
assert.equal(readFrame({x:'a',y:2}),null);
assert.deepEqual(readFrame({x:1.7,y:-.4}),{x:1,y:0});
assert.deepEqual(readFrame({x:.25,y:.75}),{x:.25,y:.75});

// object-position reproduz a fração escolhida; centro não escreve nada (é o padrão do CSS).
assert.equal(framePos(null),'');
assert.equal(framePos({x:.5,y:.5}),'50.00% 50.00%');
assert.equal(framePos({x:0,y:1}),'0.00% 100.00%');
assert.equal(framePos({x:-2,y:3}),'0.00% 100.00%','fora de 0..1 é preso antes de virar estilo');

// Vertical na prévia quadrada: sobra só no eixo Y. Horizontal: sobra só no X.
const vert=panRoom({naturalWidth:1200,naturalHeight:2000},{width:200,height:200});
assert.equal(vert.rx,0,'imagem vertical não tem o que arrastar na horizontal');
assert.ok(Math.abs(vert.ry+400/3)<1e-9,'a sobra vertical é a altura coberta menos a prévia');
assert.ok(vert.ry<-1,'há folga para arrastar no eixo Y');
assert.ok(panRoom({naturalWidth:2000,naturalHeight:1200},{width:200,height:200}).rx<0);
assert.equal(panRoom({naturalWidth:2000,naturalHeight:1200},{width:200,height:200}).ry,0);
// Imagem que cabe inteira na prévia não tem percurso nenhum.
assert.deepEqual(panRoom({naturalWidth:100,naturalHeight:100},{width:200,height:200}),{rx:0,ry:0});
assert.deepEqual(panRoom({naturalWidth:0,naturalHeight:0},{width:200,height:200}),{rx:0,ry:0});

// Invariante: com object-fit:cover a imagem sempre cobre a prévia, e qualquer fração 0..1 mantém a
// janela visível dentro da imagem — arrastar nunca revela borda vazia.
const boxes=[{width:44,height:44},{width:88,height:88},{width:152,height:152},{width:216,height:216},{width:320,height:240}];
const imgs=[{naturalWidth:1200,naturalHeight:2000},{naturalWidth:2000,naturalHeight:1200},{naturalWidth:800,naturalHeight:800},
  {naturalWidth:640,naturalHeight:360},{naturalWidth:3000,naturalHeight:4000},{naturalWidth:40,naturalHeight:60}];
for(const img of imgs)for(const box of boxes){
  const s=Math.max(box.width/img.naturalWidth,box.height/img.naturalHeight);
  const covW=img.naturalWidth*s,covH=img.naturalHeight*s,o=panRoom(img,box);
  assert.ok(covW>=box.width-1e-6&&covH>=box.height-1e-6,`${img.naturalWidth}x${img.naturalHeight} não cobre ${box.width}x${box.height}`);
  assert.ok(Math.abs(o.rx)<=1e-6||o.rx<0&&Math.abs(o.rx-(box.width-covW))<1e-6,'percurso X bate com a sobra');
  assert.ok(Math.abs(o.ry)<=1e-6||o.ry<0&&Math.abs(o.ry-(box.height-covH))<1e-6,'percurso Y bate com a sobra');
  for(const t of[0,.17,.5,.83,1]){
    const x=t*o.rx,y=t*o.ry;
    assert.ok(x<=1e-6&&x>=box.width-covW-1e-6,`eixo X fora da imagem em ${t}`);
    assert.ok(y<=1e-6&&y>=box.height-covH-1e-6,`eixo Y fora da imagem em ${t}`);
    assert.ok(x+covW>=box.width-1e-6&&y+covH>=box.height-1e-6,`bordas vazias em ${t}`);
  }
}

console.log('photo-frame: ok');
