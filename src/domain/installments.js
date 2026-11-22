const isISODate=s=>{
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||''));
  if(!m)return false;
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  return mo>=1&&mo<=12&&d>=1&&d<=new Date(Date.UTC(y,mo,0)).getUTCDate();
};

export const validDate=isISODate;

export function addMonths(date,months){
  if(!isISODate(date)||!Number.isInteger(months))throw new Error('Data inválida.');
  const[y,m,d]=date.split('-').map(Number),index=y*12+(m-1)+months,year=Math.floor(index/12),month=index%12+1;
  const day=Math.min(d,new Date(Date.UTC(year,month,0)).getUTCDate());
  return`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export function splitInstallments(totalCents,count,firstDueDate){
  if(!Number.isSafeInteger(totalCents)||totalCents<=0)throw new Error('A dívida precisa ter um saldo maior que zero.');
  if(!Number.isInteger(count)||count<1||count>60)throw new Error('Informe de 1 a 60 parcelas.');
  if(!isISODate(firstDueDate))throw new Error('Informe uma data de vencimento válida.');
  const base=Math.floor(totalCents/count),remainder=totalCents%count;
  return Array.from({length:count},(_,i)=>({number:i+1,amountCents:base+(i<remainder?1:0),dueDate:addMonths(firstDueDate,i),paidAt:null}));
}

export function principalAfterInstallment(principalCents,amountCents,paid){
  if(typeof paid!=='boolean')throw new Error('Informe o status da parcela.');
  if(!Number.isSafeInteger(principalCents)||principalCents<0)throw new Error('Saldo da dívida inválido.');
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('Valor da parcela inválido.');
  const next=principalCents+(paid?-amountCents:amountCents);
  if(!Number.isSafeInteger(next))throw new Error('O saldo da dívida excede o limite seguro.');
  if(next<0)throw new Error('O saldo da dívida mudou e não cobre esta parcela. Recarregue os dados.');
  return next;
}
