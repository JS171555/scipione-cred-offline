import{digits}from '../domain/validators.js';
import{maskCep,validCep}from '../domain/address.js';
const ENDPOINT='https://viacep.com.br/ws/';
const cache=new Map();
const fail=(message,code)=>Object.assign(new Error(message),{code});
export async function lookupCep(cep,{signal,timeout=8000}={}){
  const d=digits(cep);
  if(!validCep(d))throw fail('CEP inválido.','INVALID');
  if(cache.has(d))return cache.get(d);
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw fail('Sem conexão. Preencha o endereço manualmente.','OFFLINE');
  const ctrl=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;ctrl.abort()},timeout);
  const abort=()=>ctrl.abort();
  if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})}
  let res;
  try{
    res=await fetch(`${ENDPOINT}${d}/json/`,{signal:ctrl.signal,headers:{Accept:'application/json'},cache:'no-cache'});
  }catch(e){
    if(e?.name==='AbortError'){
      if(timedOut)throw fail('A consulta do CEP demorou demais. Preencha manualmente.','TIMEOUT');
      throw e;
    }
    throw fail('Não foi possível consultar o CEP agora. Preencha manualmente.','NETWORK');
  }finally{
    clearTimeout(timer);
    if(signal)signal.removeEventListener('abort',abort);
  }
  if(!res.ok)throw fail('Não foi possível consultar o CEP agora. Preencha manualmente.','UNAVAILABLE');
  let data;
  try{data=await res.json()}catch{throw fail('O ViaCEP retornou uma resposta inválida. Preencha manualmente.','INVALID_RESPONSE')}
  if(data?.erro===true||data?.erro==='true')throw fail('CEP não encontrado. Preencha manualmente.','NOT_FOUND');
  const out={cep:maskCep(data.cep||d),street:data.logradouro||'',district:data.bairro||'',city:data.localidade||'',state:(data.uf||'').toUpperCase()};
  cache.set(d,out);return out;
}
