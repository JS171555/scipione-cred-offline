// Ícones de traço fino (1.5), grade 24x24, herdam a cor do texto. Sem imagens, fontes ou bibliotecas.
const P={
  home:'M3.5 10.5 12 3.5l8.5 7M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
  users:'M15.5 19.5v-1.2a3.8 3.8 0 0 0-3.8-3.8H7.3a3.8 3.8 0 0 0-3.8 3.8v1.2M9.5 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M20.5 19.5v-1.2a3.8 3.8 0 0 0-2.85-3.68M15.2 5.2a3.25 3.25 0 0 1 0 6.1',
  wallet:'M20.5 9.5V7A1.5 1.5 0 0 0 19 5.5H6A2.5 2.5 0 0 0 3.5 8v8A2.5 2.5 0 0 0 6 18.5h13a1.5 1.5 0 0 0 1.5-1.5v-2.5M20.5 9.5h-4a2.5 2.5 0 0 0 0 5h4z',
  file:'M6.5 3.5h7L18 8v12.5H6.5zM13.5 3.5V8H18M9.5 12.5h5M9.5 16h5',
  db:'M12 8.5c4.14 0 7.5-1.12 7.5-2.5S16.14 3.5 12 3.5 4.5 4.62 4.5 6 7.86 8.5 12 8.5M4.5 6v12c0 1.38 3.36 2.5 7.5 2.5s7.5-1.12 7.5-2.5V6M4.5 12c0 1.38 3.36 2.5 7.5 2.5s7.5-1.12 7.5-2.5',
  lock:'M6.5 10.5h11v9h-11zM9 10.5V7.75a3 3 0 0 1 6 0v2.75',
  logout:'M9.5 4.5H5v15h4.5M15 8l4 4-4 4M19 12H9',
  plus:'M12 5v14M5 12h14',
  search:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4.2-4.2',
  back:'M14.5 5.5 8 12l6.5 6.5',
  chevron:'m9.5 5.5 6.5 6.5-6.5 6.5',
  arrow:'M4 12h15M13.5 6l6 6-6 6',
  edit:'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash:'M4.5 7h15M9.5 7V4.5h5V7M7 7l.9 12.5h8.2L17 7M10.5 11v5M13.5 11v5',
  eye:'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  download:'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  upload:'M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4h14',
  percent:'M18.5 5.5 5.5 18.5M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  print:'M7 9V4h10v5M7 17H4.5V9h15v8H17M7 14h10v6H7z',
  alert:'M12 4 2.8 20h18.4zM12 10v4.5M12 17.5h.01',
  check:'M5 12.5 9.5 17 19 7.5',
  close:'M6 6l12 12M18 6 6 18',
  phone:'M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5',
  mail:'M3.5 6.5h17v11h-17zM4 7l8 6 8-6',
  pin:'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  id:'M3.5 6h17v12h-17zM8 11a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 8 11M5.5 15.5c.4-1.5 1.4-2.2 2.5-2.2s2.1.7 2.5 2.2M13 9.5h4M13 13h4',
  camera:'M3.5 8.5h3L8 6h8l1.5 2.5h3v10h-17zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  shield:'M12 3.5 5 6v5.5c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6zM9 12l2 2 4-4',
  clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7.5V12l3 2',
  activity:'M3.5 12h4l2.5-6 4 12 2.5-6h4',
  user:'M18 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 6 18.5V20M12 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5',
  calendar:'M4 6.5h16v13H4zM4 10.5h16M8.5 4v4M15.5 4v4',
  image:'M3.5 5.5h17v13h-17zM3.5 15l4.5-4.5 4 4 3-3 5 5M15 9.5h.01',
  info:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01',
  filter:'M4 6.5h16M7 12h10M10 17.5h4'
};
const NS='http://www.w3.org/2000/svg';
export function icon(n,s=20){
  const v=document.createElementNS(NS,'svg'),p=document.createElementNS(NS,'path');
  for(const[k,x]of Object.entries({viewBox:'0 0 24 24',width:s,height:s,fill:'none',stroke:'currentColor','stroke-width':1.5,
    'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'i'}))v.setAttribute(k,x);
  p.setAttribute('d',P[n]||P.info);v.append(p);return v}
