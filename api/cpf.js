import{validCPF,digits}from '../src/domain/validators.js';

// Proxy da APICPF. Já foi um oráculo público: qualquer pessoa podia chamar
// /api/cpf?cpf=... e queimar a cota paga do mantenedor, com CPF de terceiro
// aparecendo em URL (log de proxy intermediário, histórico do navegador, APM).
// O teto de custo real mora na WAF da Vercel (docs/SECURITY.md, S-02 — ação fora
// do repositório). O que dá para fechar aqui, sem dependência nenhuma, é:
// transporte no corpo da requisição, origem controlada e cota por IP/instância.
// O CPF continua na URL SOMENTE da chamada de saída para o provedor, porque o
// contrato da APICPF é GET com query string e não é nosso para mudar.
const ENDPOINT='https://apicpf.com/api/consulta';
const TIMEOUT=8000;
const MAX_BODY=1024;

const envInt=(name,dflt)=>{const v=Number.parseInt(process.env[name],10);return Number.isFinite(v)&&v>0?v:dflt};
const limits=()=>({window:envInt('CPF_QUOTA_WINDOW_MS',60000),perIp:envInt('CPF_QUOTA_PER_IP',30),perInstance:envInt('CPF_QUOTA_PER_INSTANCE',300)});
const extraOrigins=()=>(process.env.SCIPIONE_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

// Janela fixa, em memória, por instância aquecida. NÃO é limite distribuído:
// cada região/instância conta o próprio teto, e um IP novo a cada requisição
// circorna. Serve para encarecer raspagem trivial e para o próprio app não se
// auto-negar em loop; `perInstance` é o trava-custos quando o IP é rotacionado.
const MAX_KEYS=2000;
const hits=new Map();
let instCount=0,instWindow=0;

const send=(res,status,payload)=>{
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
};

// `req.headers` é sempre objeto no runtime da Vercel, mas nada neste módulo
// deve depender disso para não virar erro 500 por um header ausente.
const hd=req=>req.headers||{};
const clientIp=req=>{
  const xff=String(hd(req)['x-forwarded-for']||'').split(',')[0].trim();
  return xff||String(hd(req)['x-real-ip']||'').trim()||'desconhecido';
};

const hostOf=v=>{try{return new URL(v).host.toLowerCase()}catch{return null}};

// `Origin`/`Referer` são controlados pelo cliente: isto NÃO é autenticação, é
// recusa de uso embarcado em outro site. Sem header nenhum (curl, ou GET do
// próprio navegador, que não envia Origin em requisição same-origin) não há o
// que comparar — nesses casos a única barreira efetiva é a cota.
function originAllowed(req){
  const raw=String(hd(req).origin||hd(req).referer||'');
  if(!raw)return true;
  const u=hostOf(raw);if(!u)return false;
  const allowed=new Set(extraOrigins().map(a=>a.replace(/^https?:\/\//,'').replace(/\/.*$/,'')));
  const host=String(hd(req).host||'').split(',')[0].trim().toLowerCase();
  if(host)allowed.add(host);
  return allowed.has(u);
}

function consume(ip,now){
  const L=limits();
  if(now-instWindow>=L.window){instWindow=now;instCount=0}
  const b=hits.get(ip);
  if(!b||now-b.from>=L.window)hits.set(ip,{from:now,n:0});
  const bucket=hits.get(ip);bucket.n+=1;instCount+=1;
  if(hits.size>MAX_KEYS)hits.delete(hits.keys().next().value);
  const retry=Math.max(1,Math.ceil((L.window-(now-bucket.from))/1000));
  if(bucket.n>L.perIp)return{scope:'ip',retry};
  if(instCount>L.perInstance)return{scope:'instancia',retry};
  return null;
}

// GET continua aceito: bundles pré-cacheados em aparelhos já instalados chamam
// a forma antiga até o Service Worker atualizar (regra dos 4 toques, sw.js:2).
async function readCpf(req){
  if(req.method==='GET'||req.method===undefined||req.method===null){
    const u=new URL(req.url||'/','https://local.invalid');
    return{cpf:digits(u.searchParams.get('cpf'))};
  }
  let raw;
  if(typeof req.body==='string')raw=req.body;
  else if(req.body&&typeof req.body==='object'){
    return typeof req.body.cpf==='string'||typeof req.body.cpf==='number'
      ?{cpf:digits(String(req.body.cpf))}:{bad:'INVALID'};
  }else{
    const parts=[];let size=0;
    for await(const c of req){size+=c.length;if(size>MAX_BODY)return{bad:'TOO_BIG'};parts.push(c)}
    raw=Buffer.concat(parts).toString('utf8');
  }
  let j;try{j=JSON.parse(raw||'')}catch{return{bad:'INVALID'}}
  if(!j||typeof j!=='object')return{bad:'INVALID'};
  return typeof j.cpf==='string'||typeof j.cpf==='number'?{cpf:digits(String(j.cpf))}:{bad:'INVALID'};
}

export default async function handler(req,res){
  if(req.method!=='GET'&&req.method!=='POST')return send(res,405,{ok:false,reason:'METHOD'});
  if(req.method==='POST'&&!(String(hd(req)['content-type']||'').toLowerCase().includes('application/json')))
    return send(res,415,{ok:false,reason:'TYPE'});

  if(!originAllowed(req))return send(res,403,{ok:false,reason:'ORIGIN'});
  const blocked=consume(clientIp(req),Date.now());
  if(blocked){res.setHeader('Retry-After',String(blocked.retry));return send(res,429,{ok:false,reason:'RATE_LIMITED'})}

  const got=await readCpf(req);
  if(got.bad==='TOO_BIG')return send(res,413,{ok:false,reason:'TOO_BIG'});
  if(got.bad==='INVALID')return send(res,422,{ok:false,reason:'INVALID'});
  const cpf=got.cpf;
  if(cpf.length!==11||!validCPF(cpf))return send(res,422,{ok:false,reason:'INVALID'});

  const key=process.env.APICPF_API_KEY;
  if(!key)return send(res,503,{ok:false,reason:'UNAVAILABLE'});

  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),TIMEOUT);
  try{
    const r=await fetch(`${ENDPOINT}?cpf=${cpf}`,{headers:{'X-API-KEY':key,Accept:'application/json'},signal:ctrl.signal});
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
    // 401/402/403/429, timeouts e falha do provedor continuam silenciosos na UI.
    return send(res,503,{ok:false,reason:'UNAVAILABLE'});
  }catch{
    return send(res,503,{ok:false,reason:'UNAVAILABLE'});
  }finally{
    clearTimeout(timer);
  }
}

// Gancho de teste: a cota é estado de módulo por design (instância aquecida),
// então os casos isolam contadores sem reiniciar o processo.
export const __quota={reset(){hits.clear();instCount=0;instWindow=0},size(){return hits.size},ip:clientIp};
