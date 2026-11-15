import{listDebts}from '../services/debts.js';import{listClients}from '../services/clients.js';import{list}from '../services/records.js';
import{fflate}from './lib.js';import{buildXlsx}from './xlsx.js';
const MESES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],dBR=s=>s?s.split('-').reverse().join('/'):'—';
export const inPeriod=(iso,p)=>p.mode==='day'?iso===p.value:iso.slice(0,7)===p.value;
export const isoOf=ts=>new Date(ts-new Date(ts).getTimezoneOffset()*6e4).toISOString().slice(0,10);
export const label=p=>p.mode==='day'?'Dia '+dBR(p.value):`${MESES[+p.value.slice(5,7)-1]}/${p.value.slice(0,4)}`;
// Dívidas registradas no período (data do registro) + movimentações do histórico ocorridas no período.
export async function load(p){
  const cs=new Map((await listClients()).map(c=>[c.id,c.name])),nm=id=>cs.get(id)||'—';
  const debts=(await listDebts()).filter(d=>inPeriod(d.date,p)).map(d=>({...d,client:nm(d.clientId)})).sort((a,b)=>a.date.localeCompare(b.date)||a.client.localeCompare(b.client,'pt-BR'));
  const moves=(await list('history')).filter(e=>inPeriod(isoOf(e.createdAt),p)).sort((a,b)=>a.createdAt-b.createdAt).map(e=>({...e,client:nm(e.clientId)}));
  const sum=k=>debts.reduce((t,d)=>t+d[k],0);return{debts,moves,principal:sum('principal'),interest:sum('interest')};
}
export async function xlsxBytes(d){
  const H=t=>({v:t,s:1});
  const debts=[['Nome do cliente','Juros valor no mês','Valor emprestado','%','Data','Observações'].map(H),
    ...d.debts.map(x=>[x.client,{v:x.interest/100,s:2},{v:x.principal/100,s:2},{v:x.rate/10000,s:3},dBR(x.due),x.notes||x.description]),
    [{v:'TOTAL',s:4},{v:d.interest/100,s:5},{v:d.principal/100,s:5},'','','']];
  const moves=[['Data e hora','Cliente','Operação','Detalhe'].map(H),...d.moves.map(e=>[new Date(e.createdAt).toLocaleString('pt-BR'),e.client,e.type,e.detail||''])];
  return buildXlsx(await fflate(),[{name:'Dívidas',rows:debts,widths:[30,20,20,10,12,40]},{name:'Movimentações',rows:moves,widths:[20,30,28,50]}]);
}
