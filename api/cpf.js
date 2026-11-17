import{validCPF,digits}from '../src/domain/validators.js';

const ENDPOINT='https://apicpf.com/api/consulta';
const TIMEOUT=8000;

const send=(res,status,payload)=>{
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
};

export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false,reason:'METHOD'});
  const url=new URL(req.url||'/','https://local.invalid');
  const cpf=digits(url.searchParams.get('cpf'));
  if(cpf.length!==11||!validCPF(cpf))return send(res,422,{ok:false,reason:'INVALID'});

  const key=process.env.APICPF_API_KEY;
  if(!key)return send(res,503,{ok:false,reason:'UNAVAILABLE'});

  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),TIMEOUT);
  try{
    const r=await fetch(`${ENDPOINT}?cpf=${cpf}`,{
      headers:{'X-API-KEY':key,Accept:'application/json'},
      signal:ctrl.signal
    });
    let body={};
    try{body=await r.json()}catch{}
    if(r.ok&&body?.data){
      return send(res,200,{ok:true,data:{
        name:typeof body.data.nome==='string'?body.data.nome:'',
        gender:['M','F','I'].includes(body.data.genero)?body.data.genero:'',
        birth:typeof body.data.data_nascimento==='string'?body.data.data_nascimento:''
      }});
    }
    if(r.status===400||r.status===404||body?.code===400||body?.code===404){
      return send(res,422,{ok:false,reason:'INVALID'});
    }
    // 401/402/403/429, timeouts and upstream failures stay silent in the UI.
    return send(res,503,{ok:false,reason:'UNAVAILABLE'});
  }catch{
    return send(res,503,{ok:false,reason:'UNAVAILABLE'});
  }finally{
    clearTimeout(timer);
  }
}
