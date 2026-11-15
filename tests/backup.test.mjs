import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from 'node:fs';
const m={exports:{}};new Function('module','exports',readFileSync(new URL('../vendor/fflate.min.js',import.meta.url),'utf8'))(m,m.exports);globalThis.fflate=m.exports;
const{buildBackup,readBackup}=await import('../src/export/backup-format.js');const{buildXlsx}=await import('../src/export/xlsx.js');const R=await import('../src/export/reports.js');
const bytes=new Uint8Array(5000).map((_,i)=>i%251);
const mk=()=>({clients:[{id:'c1',name:'Ana',doc:'529.982.247-25',photoId:'p1',createdAt:1},{id:'c2',name:'Bia',doc:'11.222.333/0001-81',createdAt:2}],
  debts:[{id:'d1',clientId:'c1',principal:500000,rate:1500,date:'2026-11-06',due:'2026-12-06'}],documents:[{id:'x1',clientId:'c1',name:'RG',blobId:'b1',hash:'h'}],history:[{id:'h1',clientId:'c1',type:'Cadastro de cliente'}],
  settings:{dueWindow:7},files:new Map([['p1',bytes],['b1',bytes.slice(0,100)]]),dbVersion:1});
// ida e volta sem senha
let z=await buildBackup(mk(),null),r=await readBackup(z);
assert.equal(r.manifest.counts.clients,2);assert.deepEqual(r.data.debts[0].principal,500000);assert.deepEqual([...r.data.files.get('p1')],[...bytes]);
// criptografado
const e=await buildBackup(mk(),'senha-backup-1');
await assert.rejects(readBackup(e),x=>x.code==='NEEDS_PASSWORD');await assert.rejects(readBackup(e,'errada'),x=>x.code==='BAD_PASSWORD');
assert.equal((await readBackup(e,'senha-backup-1')).data.clients.length,2);
assert(!Buffer.from(e).includes(Buffer.from('Ana')),'nomes não podem aparecer em claro no backup criptografado');
// adulteração e inconsistência
const t=mk();t.debts[0].clientId='zzz';await assert.rejects(readBackup(await buildBackup(t,null)),x=>x.code==='INVALID');
const t2=mk();t2.files.delete('b1');await assert.rejects(readBackup(await buildBackup(t2,null)),x=>x.code==='INVALID');
const bad=Uint8Array.from(e);bad[Math.floor(bad.length/2)]^=1;await assert.rejects(readBackup(bad,'senha-backup-1'));
await assert.rejects(readBackup(new Uint8Array([1,2,3])),x=>x.code==='INVALID');
const fake=globalThis.fflate.zipSync({'manifest.json':globalThis.fflate.strToU8('{"app":"x"}')});await assert.rejects(readBackup(fake),x=>x.code==='INVALID');
// períodos
assert(R.inPeriod('2026-11-06',{mode:'month',value:'2026-11'}));assert(!R.inPeriod('2026-12-01',{mode:'month',value:'2026-11'}));assert(R.inPeriod('2026-11-06',{mode:'day',value:'2026-11-06'}));
assert.equal(R.label({mode:'month',value:'2026-03'}),'Março/2026');assert.equal(R.label({mode:'day',value:'2026-11-06'}),'Dia 06/11/2026');
// xlsx de amostra para validação externa
writeFileSync('/tmp/amostra.xlsx',buildXlsx(globalThis.fflate,[{name:'Dívidas',widths:[30,20,20,10,12,40],rows:[['Nome do cliente','Juros valor no mês','Valor emprestado','%','Data','Observações'].map(v=>({v,s:1})),
  ['Manoel Junior <&>',{v:750,s:2},{v:5000,s:2},{v:.15,s:3},'06/11/2026','Cliente tartaruga'],[{v:'TOTAL',s:4},{v:750,s:5},{v:5000,s:5},'','','']]},{name:'Movimentações',widths:[20],rows:[[{v:'Data',s:1}]]}]));
console.log('backup/relatórios: ok');
