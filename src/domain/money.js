// Dinheiro em CENTAVOS inteiros; taxa em centésimos de ponto percentual (15% = 1500). Juros simples mensais.
export const MAXR=100000; // 1000%
export const num=c=>{const s=String(Math.abs(c)).padStart(3,'0');return(c<0?'-':'')+s.slice(0,-2).replace(/\B(?=(\d{3})+$)/g,'.')+','+s.slice(-2)};
export const brl=c=>'R$ '+num(c);
export const cents=s=>Number(String(s).replace(/\D/g,'')||0);
export const rate=b=>{const f=b%100;return Math.floor(b/100)+(f?','+String(f).padStart(2,'0').replace(/0$/,''):'')+'%'};
export const parseRate=s=>{const t=String(s).trim().replace('%','').replace(',','.');return/^\d+(\.\d{1,2})?$/.test(t)?Math.round(parseFloat(t)*100):null};
// juros do mês = principal × taxa / 100, arredondado ao centavo (meio para cima), sem ponto flutuante
export const interest=(p,b)=>Number((BigInt(p)*BigInt(b)+5000n)/10000n);
// mode: 'add' | 'sub' (pontos percentuais) | 'set' (nova taxa)
export const planRate=(ds,mode,v)=>ds.map(d=>{const nr=mode==='add'?d.rate+v:mode==='sub'?d.rate-v:v,ok=nr>0&&nr<=MAXR;return{d,nr,ok,ni:ok?interest(d.principal,nr):null}});
