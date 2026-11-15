const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),dg=s=>String(s||'').replace(/\D/g,'');
// Nome, e-mail e RG por texto (sem acento/caixa); CPF, CNPJ, RG, telefone e celular por dígitos quando a busca é numérica.
export const match=(c,q)=>{q=String(q||'').trim();if(!q)return true;const n=norm(q),d=dg(q);
  return norm(c.name).includes(n)||norm(c.email).includes(n)||norm(c.rg).includes(n)||(d&&/^[\d\s.\-\/()+]+$/.test(q)&&[c.doc,c.rg,c.phone,c.mobile].some(v=>dg(v).includes(d)))};
