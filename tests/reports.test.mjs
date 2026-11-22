import assert from'node:assert/strict';
import{test}from'node:test';
import{installmentsInPeriod}from'../src/export/reports.js';

import{installmentsXlsxBytes}from'../src/export/reports.js';

test('exporta abas de parcelamentos e parcelas com os dados persistidos',async()=>{
  const previous=globalThis.fflate;
  globalThis.fflate={strToU8:value=>value,zipSync:files=>files};
  const plan={clientName:'Ana Souza',debt:{description:'Crédito pessoal'},count:2,totalCents:10000,startDate:'2026-11-22',firstDueDate:'2026-12-05',items:[
    {number:1,amountCents:5000,dueDate:'2026-12-05',paidAt:123},
    {number:2,amountCents:5000,dueDate:'2027-01-05',paidAt:null}
  ]};
  const original=structuredClone(plan);
  try{
    const files=await installmentsXlsxBytes({plans:[plan]});
    assert.match(files['xl/workbook.xml'],/sheet name="Parcelamentos"/);
    assert.match(files['xl/workbook.xml'],/sheet name="Parcelas"/);
    assert.match(files['xl/worksheets/sheet1.xml'],/Ana Souza/);
    assert.match(files['xl/worksheets/sheet2.xml'],/Paga/);
    assert.match(files['xl/worksheets/sheet2.xml'],/Em aberto/);
    assert.deepEqual(plan,original);
  }finally{
    if(previous===undefined)delete globalThis.fflate;else globalThis.fflate=previous;
  }
});

test('filtra parcelamentos pelo início no mês ou no dia sem alterar os registros',()=>{
  const plans=[
    {id:'a',startDate:'2026-11-22',items:[{number:1,paidAt:null}]},
    {id:'b',startDate:'2026-11-03',items:[{number:1,paidAt:123}]},
    {id:'c',startDate:'2026-12-01',items:[{number:1,paidAt:null}]}
  ];
  const original=structuredClone(plans);
  assert.deepEqual(installmentsInPeriod(plans,{mode:'month',value:'2026-11'}).map(p=>p.id),['a','b']);
  assert.deepEqual(installmentsInPeriod(plans,{mode:'day',value:'2026-11-22'}).map(p=>p.id),['a']);
  assert.deepEqual(plans,original);
});
