const cache={};
const load=(src,g)=>globalThis[g]?Promise.resolve(globalThis[g]):(cache[g]??=new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;
  s.onload=()=>globalThis[g]?res(globalThis[g]):rej(new Error('Biblioteca inválida: '+src));s.onerror=()=>{delete cache[g];rej(new Error('Não foi possível carregar '+src))};document.head.append(s)}));
export const fflate=()=>load('vendor/fflate.min.js','fflate');
export function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),6e4)}
