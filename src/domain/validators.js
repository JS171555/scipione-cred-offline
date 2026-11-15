export const digits=s=>String(s||'').replace(/\D/g,'');
export function validCPF(v){const d=digits(v);if(d.length!==11||/^(\d)\1+$/.test(d))return false;
  for(const n of[9,10]){let s=0;for(let i=0;i<n;i++)s+=d[i]*(n+1-i);if((s*10%11)%10!=d[n])return false}return true}
export function validCNPJ(v){const d=digits(v);if(d.length!==14||/^(\d)\1+$/.test(d))return false;
  for(const n of[12,13]){let s=0,w=n-7;for(let i=0;i<n;i++){s+=d[i]*w--;if(w<2)w=9}if((s%11<2?0:11-s%11)!=d[n])return false}return true}
export const mask={
  cpf:v=>digits(v).slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'),
  cnpj:v=>digits(v).slice(0,14).replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2'),
  phone:v=>{const d=digits(v).slice(0,11);return d.length>10?d.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3'):d.length>6?d.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3'):d.length>2?d.replace(/(\d{2})(\d+)/,'($1) $2'):d}};
