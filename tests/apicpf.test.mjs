import assert from 'node:assert/strict';
import handler from '../api/cpf.js';

const CPF='11144477735';
const makeRes=()=>({statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body},json(){return JSON.parse(this.body)}});
const call=async(url,key,method='GET')=>{
  process.env.APICPF_API_KEY=key;
  const res=makeRes();
  await handler({method,url},res);
  return {status:res.statusCode,body:res.json(),headers:res.headers};
};

const realFetch=globalThis.fetch;
try{
  let r=await call('/api/cpf?cpf='+CPF,undefined);
  assert.equal(r.status,503);
  assert.equal(r.body.ok,false);

  r=await call('/api/cpf?cpf=11111111111','test');
  assert.equal(r.status,422);
  assert.equal(r.body.reason,'INVALID');

  r=await call('/api/cpf','test');
  assert.equal(r.status,422);

  globalThis.fetch=async()=>new Response(JSON.stringify({code:200,data:{cpf:CPF,nome:'João da Silva',genero:'M',data_nascimento:'1985-07-15'}}),{status:200});
  r=await call('/api/cpf?cpf='+CPF,'test');
  assert.equal(r.status,200);
  assert.deepEqual(r.body.data,{name:'João da Silva',gender:'M',birth:'1985-07-15'});
  assert.equal(r.headers['Cache-Control'],'no-store');

  globalThis.fetch=async()=>new Response(JSON.stringify({code:404,message:'Pessoa não encontrada'}),{status:404});
  r=await call('/api/cpf?cpf='+CPF,'test');
  assert.equal(r.status,422);
  assert.equal(r.body.reason,'INVALID');

  for(const status of[401,402,403,429,500]){
    globalThis.fetch=async()=>new Response(JSON.stringify({code:status,message:'erro'}),{status});
    r=await call('/api/cpf?cpf='+CPF,'test');
    assert.equal(r.status,503);
    assert.equal(r.body.reason,'UNAVAILABLE');
    assert.equal(JSON.stringify(r.body).includes('message'),false);
  }

  globalThis.fetch=async()=>{throw new Error('offline')};
  r=await call('/api/cpf?cpf='+CPF,'test');
  assert.equal(r.status,503);

  r=await call('/api/cpf?cpf='+CPF,'test','POST');
  assert.equal(r.status,405);
  console.log('apicpf: ok');
}finally{
  globalThis.fetch=realFetch;
  delete process.env.APICPF_API_KEY;
}