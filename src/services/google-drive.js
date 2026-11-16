// Google Drive: OAuth 2.0 para navegador (Google Identity Services) + Drive API v3.
// O acesso usa o escopo mínimo drive.file: o app só enxerga os backups que ele
// próprio criou. Nenhum segredo do cliente é usado ou armazenado no navegador.
import{GOOGLE_OAUTH}from '../config/google.js';

const API='https://www.googleapis.com/drive/v3';
const UPLOAD='https://www.googleapis.com/upload/drive/v3';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const FOLDER='SCIPIONE CRED - Backups';
const APP='SCIPIONE CRED';
const STORE='scipione.google.oauth';
const encoder=new TextEncoder();

let gisPromise=null,token=null,tokenExpires=0,pending=null,folderId=null;

const now=()=>Date.now();
const fail=(message,code)=>Object.assign(new Error(message),{code});
const saved=()=>{try{const value=JSON.parse(localStorage.getItem(STORE)||'null');if(!value||!value.clientId)return null;if(value.type!=='web'){localStorage.removeItem(STORE);return null}return value}catch{return null}};
const resetAuth=()=>{token=null;tokenExpires=0;pending=null;folderId=null};

export function getConfig(){return saved()||{...GOOGLE_OAUTH,origins:Array.isArray(GOOGLE_OAUTH.origins)?GOOGLE_OAUTH.origins:[]}}
export function configState(){
  const c=getConfig(),origins=Array.isArray(c.origins)?c.origins:[],origin=location.origin;
  const originListed=origins.some(x=>{try{return new URL(x).origin===origin}catch{return x===origin}});
  return{...c,origins,origin,originListed,configured:c.type==='web'&&!!c.clientId};
}
export function status(){return{...configState(),connected:isConnected()}}
export function isConnected(){
  if(!token||now()>=tokenExpires){token=null;return false}
  return true;
}
export function parseClientJson(text){
  let raw;try{raw=JSON.parse(text)}catch{throw fail('O arquivo selecionado não é um JSON válido.','CONFIG')}
  const web=raw&&raw.web,installed=raw&&raw.installed,c=web||installed||raw;
  if(!c||typeof c.client_id!=='string'||!/\.apps\.googleusercontent\.com$/.test(c.client_id))
    throw fail('O JSON não contém um client_id válido do Google Cloud.','CONFIG');
  const type=web?'web':installed?'installed':'unknown';
  if(type!=='web')
    throw fail('Este JSON é de um cliente OAuth de aplicativo instalado, que o Google não aceita no navegador. Crie um cliente do tipo "Aplicativo da Web" e importe o JSON dele.','INSTALLED');
  return{clientId:c.client_id,projectId:c.project_id||'',type,origins:Array.isArray(c.javascript_origins)?c.javascript_origins:[]};
}
export function importConfig(text){
  const c=parseClientJson(text);
  try{localStorage.setItem(STORE,JSON.stringify(c))}catch{throw fail('Não foi possível salvar a configuração neste navegador.','CONFIG')}
  resetAuth();return c;
}
export function clearConfig(){try{localStorage.removeItem(STORE)}catch{}resetAuth()}

function loadGis(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(gisPromise)return gisPromise;
  gisPromise=new Promise((resolve,reject)=>{
    if(!navigator.onLine){reject(fail('Sem conexão com a internet. Conecte-se para autorizar o Google Drive.','OFFLINE'));return}
    const s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;
    s.onload=()=>window.google?.accounts?.oauth2?resolve():reject(fail('A biblioteca de autenticação do Google não foi carregada.','AUTH'));
    s.onerror=()=>{gisPromise=null;reject(fail('Não foi possível carregar a autenticação do Google. Verifique a conexão e tente novamente.','AUTH'))};
    document.head.append(s);
  });
  return gisPromise;
}
export function preload(){return configState().configured?loadGis().catch(()=>{}):Promise.resolve()}

function authMessage(e){
  const code=e?.type||e?.error||'auth';
  if(code==='popup_closed')return 'A autorização do Google não foi concluída. Verifique se o cliente é do tipo Aplicativo da Web, se a origem está autorizada e tente novamente.';
  if(code==='access_denied')return 'O Google bloqueou o acesso. Se o app OAuth está em modo de teste, adicione sua conta em “Usuários de teste” na tela de consentimento do Google Cloud e tente novamente.';
  if(code==='origin_mismatch'||/origin/i.test(code))return 'A origem deste site não está autorizada no cliente OAuth do Google Cloud.';
  if(code==='invalid_client')return 'O cliente OAuth não é válido para uso no navegador. Use um cliente do tipo "Aplicativo da Web".';
  return e?.message||'Não foi possível autorizar o acesso ao Google Drive.';
}
export async function connect(){
  const c=configState();
  if(!c.configured)throw fail('Configure um cliente OAuth do tipo "Aplicativo da Web" antes de conectar.','CONFIG');
  if(isConnected())return true;
  if(pending)return pending;
  if(!navigator.onLine)throw fail('Sem conexão com a internet. Conecte-se para autorizar o Google Drive.','OFFLINE');
  await loadGis();
  pending=new Promise((resolve,reject)=>{
    let done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);pending=null;err?reject(err):resolve(value)};
    const timer=setTimeout(()=>finish(fail('A autorização do Google demorou demais. Tente novamente.','AUTH')),120000);
    let client;
    try{
      client=google.accounts.oauth2.initTokenClient({
        client_id:c.clientId,
        scope:SCOPE,
        callback:r=>{
          if(r&&r.access_token){
            token=r.access_token;
            tokenExpires=now()+Math.max(60,(Number(r.expires_in)||3600)-60)*1000;
            finish(null,true);
          }else finish(fail(authMessage(r),'AUTH'));
        },
        error_callback:e=>finish(fail(authMessage(e),'AUTH'))
      });
      client.requestAccessToken({prompt:''});
    }catch(e){finish(e?.message?fail(e.message,'AUTH'):fail(authMessage(e),'AUTH'))}
  });
  return pending;
}
export function disconnect(){
  const old=token;resetAuth();
  if(old&&window.google?.accounts?.oauth2?.revoke){try{google.accounts.oauth2.revoke(old,()=>{})}catch{}}
}

async function responseError(res){
  let body=null;try{body=await res.json()}catch{}
  const raw=body?.error?.message||body?.error_description||'';
  if(res.status===403&&/drive api|disabled|has not been used|not been used in project/i.test(raw))
    return 'A Google Drive API não está ativada no projeto do Google Cloud. Ative-a e tente novamente.';
  if(res.status===403&&/insufficient|scope|permission/i.test(raw))
    return 'A conta Google não autorizou o acesso necessário ao Google Drive.';
  if(res.status===404)return 'O arquivo ou a pasta não foi encontrado no Google Drive.';
  return raw||`O Google Drive retornou o erro ${res.status}.`;
}
async function request(url,init={},timeout=90000){
  if(!isConnected())throw fail('Sua sessão do Google expirou. Conecte novamente ao Google Drive.','AUTH');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  let res;
  try{
    res=await fetch(url,{...init,headers:{...(init.headers||{}),Authorization:`Bearer ${token}`},signal:controller.signal});
  }catch(e){
    if(e?.name==='AbortError')throw fail('O Google Drive demorou demais para responder. Tente novamente.','NETWORK');
    throw fail('Não foi possível conectar ao Google Drive. Verifique sua internet e tente novamente.','NETWORK');
  }finally{clearTimeout(timer)}
  if(res.status===401){resetAuth();throw fail('Sua sessão do Google expirou. Conecte novamente ao Google Drive.','AUTH')}
  if(!res.ok)throw fail(await responseError(res),'DRIVE');
  return res;
}
const api=(path,init,timeout)=>request(API+path,init,timeout);
const escapeQ=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const json=res=>res.json();

async function folder(){
  if(folderId)return folderId;
  const q=`name = '${escapeQ(FOLDER)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found=await json(await api(`/files?spaces=drive&pageSize=10&fields=${encodeURIComponent('files(id,name)')}&q=${encodeURIComponent(q)}`));
  if(found.files?.length){folderId=found.files[0].id;return folderId}
  const created=await json(await api('/files?fields=id,name',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:FOLDER,mimeType:'application/vnd.google-apps.folder',appProperties:{app:APP}})
  }));
  if(!created.id)throw fail('O Google Drive não criou a pasta de backups.','DRIVE');
  folderId=created.id;return folderId;
}

export async function listBackups(){
  const parent=await folder();
  const q=`'${escapeQ(parent)}' in parents and trashed = false and mimeType = 'application/zip'`;
  let pageToken='',all=[];
  do{
    const params=new URLSearchParams({spaces:'drive',pageSize:'100',orderBy:'createdTime desc',
      fields:'nextPageToken,files(id,name,size,createdTime,modifiedTime,appProperties)',q});
    if(pageToken)params.set('pageToken',pageToken);
    const page=await json(await api('/files?'+params.toString()));
    all.push(...(page.files||[]));pageToken=page.nextPageToken||'';
  }while(pageToken);
  return all.filter(f=>f.appProperties?.app===APP);
}

const hex=bytes=>{let out='';for(const b of bytes)out+=b.toString(16).padStart(2,'0');return out};
export async function sha256(bytes){
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
}

export async function uploadBackup(bytes,{name,encrypted=false}={}){
  if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw fail('O backup está vazio.','INTEGRITY');
  const parent=await folder(),hash=await sha256(bytes);
  const boundary='scipione-'+hex(crypto.getRandomValues(new Uint8Array(12)));
  const filename=String(name||`scipione-cred-backup-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}${encrypted?'-criptografado':''}.zip`).replace(/[\\/]/g,'-').slice(0,180);
  const metadata={name:filename,parents:[parent],mimeType:'application/zip',
    appProperties:{app:APP,sha256:hash,encrypted:encrypted?'1':'0'}};
  const body=new Blob([
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Type: application/zip\r\n\r\n`),
    bytes,
    encoder.encode(`\r\n--${boundary}--`)
  ],{type:`multipart/related; boundary=${boundary}`});
  const res=await request(`${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,size,createdTime,appProperties')}`,{
    method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body
  },180000);
  const file=await res.json();
  if(!file.id)throw fail('O Google Drive não confirmou o envio do backup.','DRIVE');
  if(file.size!=null&&Number(file.size)!==bytes.byteLength){
    try{await api(`/files/${encodeURIComponent(file.id)}`,{method:'DELETE'})}catch{}
    throw fail('O Google Drive não confirmou o tamanho do arquivo. O envio foi cancelado.','INTEGRITY');
  }
  return{...file,sha256:hash};
}

export async function downloadBackup(file){
  if(!file?.id)throw fail('Selecione um backup do Google Drive.','DRIVE');
  const expected=String(file.appProperties?.sha256||'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected))
    throw fail('Este arquivo não tem a verificação de integridade do SCIPIONE CRED.','INTEGRITY');
  const res=await request(`${API}/files/${encodeURIComponent(file.id)}?alt=media`,{},180000);
  const bytes=new Uint8Array(await res.arrayBuffer());
  if(await sha256(bytes)!==expected)
    throw fail('A verificação de integridade falhou: o arquivo baixado está corrompido ou foi alterado.','INTEGRITY');
  return bytes;
}

export function formatSize(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)return '';
  if(n<1024)return `${n} B`;
  if(n<1024*1024)return `${(n/1024).toFixed(1).replace('.',',')} KB`;
  return `${(n/(1024*1024)).toFixed(1).replace('.',',')} MB`;
}
