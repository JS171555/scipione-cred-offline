import{validCPF,digits}from '../domain/validators.js';

const CACHE=new Map(),PENDING=new Map(),TTL=30*60*1000;
const fail=(code,message)=>Object.assign(new Error(message||code),{code});

export async function lookupCpf(value,{signal}={}){
  const cpf=digits(value);
  if(cpf.length!==11||!validCPF(cpf))throw fail('INVALID');
  if(!navigator.onLine)throw fail('OFFLINE');

  const hit=CACHE.get(cpf);
  if(hit&&Date.now()-hit.at<TTL)return hit.data;
  if(PENDING.has(cpf))return PENDING.get(cpf);

  const ctrl=new AbortController();
  let timedOut=false;
  const onAbort=()=>ctrl.abort();
  if(signal?.aborted)ctrl.abort();
  else signal?.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;ctrl.abort()},9000);

  const request=(async()=>{
    try{
      // POST com o CPF no corpo: o número não vai mais para a URL da nossa
      // função (log de intermediário, histórico do navegador, APM). 429 cai no
      // mesmo caminho silencioso de UNAVAILABLE que já existia, então a UI não
      // muda. GET continua aceito no servidor por causa dos bundles velhos.
      const r=await fetch('/api/cpf',{
        method:'POST',
        signal:ctrl.signal,
        headers:{Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({cpf}),
        cache:'no-store'
      });
      let body={};
      try{body=await r.json()}catch{}
      if(r.ok&&body?.ok&&body.data){
        const data={
          name:typeof body.data.name==='string'?body.data.name.trim():'',
          gender:['M','F','I'].includes(body.data.gender)?body.data.gender:'',
          birth:/^\d{4}-\d{2}-\d{2}$/.test(body.data.birth||'')?body.data.birth:''
        };
        CACHE.set(cpf,{at:Date.now(),data});
        return data;
      }
      if(r.status===422||body?.reason==='INVALID')throw fail('INVALID');
      throw fail(timedOut?'TIMEOUT':'UNAVAILABLE');
    }catch(x){
      if(x?.name==='AbortError'){
        if(timedOut)throw fail('TIMEOUT');
        throw x;
      }
      if(x?.code)throw x;
      throw fail('UNAVAILABLE');
    }finally{
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      PENDING.delete(cpf);
    }
  })();

  PENDING.set(cpf,request);
  return request;
}
