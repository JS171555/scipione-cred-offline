import*as db from '../db/idb.js';
import{list,one,enc,hist,uid}from'./records.js';
import{getKey}from'../security/auth.js';
import{openJSON}from'../security/crypto.js';
import{splitInstallments,validDate,principalAfterInstallment}from'../domain/installments.js';
import*as M from'../domain/money.js';
import{listClients}from'./clients.js';

const decode=async r=>r&&({...await openJSON(getKey(),r.data),id:r.id,createdAt:r.createdAt,clientId:r.clientId,debtId:r.debtId});
const planRecord=async p=>{const op=await enc('installment_plans',p);op[2].debtId=p.debtId;return op};
const validCount=n=>Number.isInteger(n)&&n>=1&&n<=60;

export async function listPlans(){
  const[plans,clients,debts]=await Promise.all([list('installment_plans'),listClients(),list('debts')]);
  const names=new Map(clients.map(c=>[c.id,c.name])),debtById=new Map(debts.map(d=>[d.id,d]));
  return plans.map(p=>({...p,clientName:names.get(p.clientId)||'—',debt:debtById.get(p.debtId)||null}))
    .sort((a,b)=>b.createdAt-a.createdAt);
}

export async function createPlan({clientId,debtId,count,startDate,firstDueDate}){
  count=Number(count);
  if(!clientId||!debtId)throw new Error('Selecione um cliente e uma dívida.');
  if(!validCount(count))throw new Error('Informe de 1 a 60 parcelas.');
  if(!validDate(startDate))throw new Error('Informe uma data de início válida.');
  if(!validDate(firstDueDate)||firstDueDate<startDate)throw new Error('O primeiro vencimento deve ser igual ou posterior à data de início.');
  const[client,rawDebt]=await Promise.all([one('clients',clientId),db.get('debts',debtId)]);
  if(!client)throw new Error('Cliente não encontrado.');
  if(!rawDebt)throw new Error('Dívida não encontrada.');
  const debt=await decode(rawDebt);
  if(debt.clientId!==clientId)throw new Error('A dívida selecionada não pertence a este cliente.');
  if(!Number.isSafeInteger(debt.principal)||debt.principal<=0)throw new Error('A dívida não possui saldo para parcelar.');
  if((await db.getAll('installment_plans')).some(p=>p.debtId===debtId))throw new Error('Esta dívida já possui um parcelamento.');
  const now=Date.now(),plan={id:uid(),clientId,debtId,createdAt:now,updatedAt:now,totalCents:debt.principal,count,startDate,firstDueDate,
    items:splitInstallments(debt.principal,count,firstDueDate)};
  const planOp=await planRecord(plan);
  planOp[0]='add';
  await db.compareAndBatch([['debts',debtId,rawDebt]],[planOp,await hist(clientId,'Parcelamento criado',`${count} parcela(s) de ${M.brl(debt.principal)} no total`) ]);
  return plan.id;
}

export async function setPaid(planId,number,paid){
  if(typeof paid!=='boolean')throw new Error('Informe se a parcela ficará marcada como paga.');
  const rawPlan=await db.get('installment_plans',planId);
  if(!rawPlan)throw new Error('Parcelamento não encontrado.');
  const plan=await decode(rawPlan),item=plan.items?.find(x=>x.number===number);
  if(!item)throw new Error('Parcela não encontrada.');
  if(!!item.paidAt===paid)return;
  const rawDebt=await db.get('debts',plan.debtId);
  if(!rawDebt)throw new Error('A dívida vinculada não foi encontrada.');
  const debt=await decode(rawDebt);
  if(debt.clientId!==plan.clientId)throw new Error('O vínculo da dívida está inconsistente.');
  const principal=principalAfterInstallment(debt.principal,item.amountCents,paid);
  const now=Date.now();item.paidAt=paid?now:null;plan.updatedAt=now;
  const updatedDebt={...debt,principal,updatedAt:now};
  const planOp=await planRecord(plan),debtOp=await enc('debts',updatedDebt);
  const type=paid?'Parcela baixada':'Baixa de parcela desfeita';
  const detail=`Parcela ${item.number}/${plan.count}: ${M.brl(item.amountCents)} · saldo da dívida atualizado para ${M.brl(principal)}`;
  await db.compareAndBatch([['installment_plans',planId,rawPlan],['debts',plan.debtId,rawDebt]],
    [planOp,debtOp,await hist(plan.clientId,type,detail)]);
}

// Mantido para compatibilidade com chamadas existentes; a UI usa setPaid para alternar livremente.
export const markPaid=(planId,number)=>setPaid(planId,number,true);

export async function deletePlan(planId){
  const rawPlan=await db.get('installment_plans',planId);
  if(!rawPlan)throw new Error('Parcelamento não encontrado.');
  const plan=await decode(rawPlan),rawDebt=await db.get('debts',plan.debtId);
  const debt=rawDebt?await decode(rawDebt):null;
  const checks=[['installment_plans',planId,rawPlan],['debts',plan.debtId,rawDebt]];
  const balance=debt?`Saldo da dívida mantido em ${M.brl(debt.principal)}.`:'A dívida vinculada não foi alterada.';
  const op=['delete','installment_plans',planId];
  await db.compareAndBatch(checks,[op,await hist(plan.clientId,'Parcelamento excluído',`${plan.count} parcela(s). ${balance} As parcelas já baixadas continuam descontadas.`)]);
}
