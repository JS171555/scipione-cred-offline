const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const startsWithLetter=(name,letter)=>!letter||norm(name).startsWith(norm(letter));
export const debtsAtRate=(debts,rate)=>debts.filter(d=>d.rate===rate);
export const sumDebtPrincipal=debts=>debts.reduce((total,d)=>total+d.principal,0);
