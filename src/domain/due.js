// Vencimentos em datas ISO (AAAA-MM-DD), sem fuso: vencida = antes de hoje; prestes a vencer = hoje até hoje + janela.
const D=s=>Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10));
export const todayISO=()=>new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
export const daysUntil=(due,today=todayISO())=>Math.round((D(due)-D(today))/864e5);
export const status=(due,win,today)=>{const n=daysUntil(due,today);return n<0?'overdue':n<=win?'soon':'ok'};
