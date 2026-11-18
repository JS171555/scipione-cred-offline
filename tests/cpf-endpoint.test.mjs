import test from 'node:test';import assert from 'node:assert/strict';
import handler from '../api/cpf.js';
const call=(headers={},url='/api/cpf?cpf=52998224725')=>new Promise(r=>{const res={headers:{},setHeader(k,v){this.headers[k]=v},end(b){r({status:this.statusCode,body:JSON.parse(b)})}};handler({method:'GET',url,headers},res)});
test('recusa chamadas de outros sites',async()=>{assert.equal((await call({'sec-fetch-site':'cross-site'})).status,403)});
test('limita a 20 consultas por minuto por IP',async()=>{delete process.env.APICPF_API_KEY;let last;for(let i=0;i<21;i++)last=await call({'x-forwarded-for':'9.9.9.9'});assert.equal(last.status,429)});
test('CPF inválido retorna 422',async()=>{assert.equal((await call({},'/api/cpf?cpf=111')).status,422)});
