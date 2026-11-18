// Fixtures 100% fictícias e determinísticas. Nenhum dado real de produção entra aqui.
//
// Nomes: "Maria Exemplo" / "João Teste". Valores redondos. Documentos de exemplo são os clássicos de
// documentação técnica já usados na suíte do próprio repositório:
//   CPF  111.444.777-35  (11144477735, válido)
//   CNPJ 11.222.333/0001-81 (válido; é o CNPJ de exemplo commitado em tests/validators.test.mjs:3)
//   CNPJ 11.222.333/0001-44 (deliberadamente INVÁLIDO: dígito verificador incorreto — para testes negativos)
//
// Os campos replicam exatamente o que os services reais esperam/gravam:
//   clientes   -> src/services/clients.js:7-14 (validate) · campos gravados em :23, rótulos em :5
//   dívidas    -> src/services/debts.js:4 (rec) e :7-13 (validate)
//   documentos -> src/services/clients.js:42 (addDoc)  ·  histórico -> src/services/records.js:10 (hist)
// Nada aqui duplica regra de negócio: as máscaras e a validação vêm dos módulos reais (importados), então se o
// contrato de domínio mudar, a fixture muda junto e o teste quebra no lugar certo.

import { mask, digits, validCPF } from '../../src/domain/validators.js';

export const SENHA_TESTE = 'Senha-Forte-Ficticia-1';   // >= 8 caracteres: cumpre a política cobrada em src/main.js:19

export const CPF_VALIDO = '111.444.777-35';
export const CPF_VALIDO_SEM_MASCARA = digits(CPF_VALIDO);
export const CNPJ_VALIDO = '11.222.333/0001-81';
export const CNPJ_INVALIDO = '11.222.333/0001-44';     // mesmo corpo, DV errado
export const CPF_REPETIDO = '111.111.111-11';
export const TELEFONE_FIXO = '(11) 3333-4444';
export const TELEFONE_CELULAR = '(11) 98765-4321';
export const EMAIL_VALIDO = 'maria.exemplo@exemplo.invalid';   // ".invalid" nunca resolve: não há egress possível
export const CEP_VALIDO = '01001-000';

// Dígito verificador de CPF (pesos 10..2 / 11..2), só para GERAR CPFs fictícios válidos em série.
const dv = (base, pesoInicial) => {
  let s = 0, w = pesoInicial;
  for (const ch of base) { s += Number(ch) * w--; if (w < 2) w = 9 }
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
};
export function cpfFicticio(indice = 0) {
  const base = String(111444777 + indice * 137).padStart(9, '0').slice(-9);
  const com1 = base + dv(base, 10);
  const cpf = com1 + dv(com1, 11);
  if (!/^(\d)\1{10}$/.test(cpf) && validCPF(cpf)) return cpf;
  throw new Error(`fixtures: o CPF gerado para o índice ${indice} não é válido — fixture quebrada`);
}

let seq = 0;
const novoId = (prefixo) => `${prefixo}-${String(++seq).padStart(4, '0')}`;

// ---------- clientes ----------
export function novoClienteFicticio(over = {}) {
  const type = over.type ?? 'PF';
  const doc = over.doc ?? (type === 'PJ' ? CNPJ_VALIDO : CPF_VALIDO);
  const nome = over.name ?? (type === 'PJ' ? 'João Teste Comércio LTDA' : 'Maria Exemplo');
  return {
    id: over.id ?? novoId('cli'),
    type, name: nome, doc,
    birth: '1985-07-15', gender: 'F', rg: '12.345.678-9',
    phone: TELEFONE_FIXO, mobile: TELEFONE_CELULAR, email: EMAIL_VALIDO,
    cep: CEP_VALIDO, street: 'Praça da Sé', number: '100', complement: 'Apto 12',
    district: 'Sé', city: 'São Paulo', state: 'SP',
    address: 'Praça da Sé, 100, Apto 12 - Sé, São Paulo/SP',
    photoId: null, photoType: null,
    createdAt: 1700000000000, updatedAt: 1700000000000,
    ...over,
  };
}

// Cliente no formato cru que o FORMULÁRIO entrega para saveClient(d, old): sem id/createdAt/photoId.
export function novoClienteParaSalvar(over = {}) {
  const { id, createdAt, updatedAt, photoId, photoType, ...form } = novoClienteFicticio(over);
  return form;
}

export function listaClientes(n = 3, over = {}) {
  if (!Number.isInteger(n) || n < 0) throw new TypeError('listaClientes(n): n deve ser um inteiro >= 0');
  const celular = (i) => mask.phone('11' + String(900000000 + i));   // 11 dígitos -> '(11) 90000-0000'
  return Array.from({ length: n }, (_, i) => novoClienteFicticio({
    id: `cli-${String(i + 1).padStart(3, '0')}`,
    name: `Maria Exemplo ${String(i + 1).padStart(2, '0')}`,
    doc: mask.cpf(cpfFicticio(i)),
    mobile: celular(i),
    email: `maria${String(i + 1).padStart(2, '0')}@exemplo.invalid`,
    createdAt: 1700000000000 + i * 1000,
    ...over,
  }));
}

// ---------- dívidas ----------
export function novaDividaFicticia(over = {}) {
  return {
    id: over.id ?? novoId('dvd'),
    clientId: over.clientId ?? null,
    description: 'Empréstimo pessoal',
    principal: 500000,          // R$ 5.000,00 em centavos
    rate: 1500,                 // 15% ao mês
    date: '2026-11-06',
    due: '2026-12-06',
    notes: '',
    createdAt: 1700000000000, updatedAt: 1700000000000,
    ...over,
  };
}
export function novaDividaParaSalvar(over = {}) {
  const { id, clientId, createdAt, updatedAt, ...form } = novaDividaFicticia(over);
  return form;
}

// ---------- documentos / arquivos ----------
export function novoDocumento(over = {}) {
  return {
    id: over.id ?? novoId('doc'),
    clientId: over.clientId ?? null,
    name: 'contrato.txt', orig: 'contrato.txt', category: 'Identificação',
    type: 'text/plain', size: 8, originalSize: 8, converted: false,
    hash: 'a'.repeat(64), blobId: over.blobId ?? novoId('blb'),
    createdAt: 1700000000000,
    ...over,
  };
}

// Bytes determinísticos (não aleatórios): os mesmos valores em toda execução.
export function bytesFicticios(n = 8, deslocamento = 0) {
  return Uint8Array.from({ length: n }, (_, i) => (i + deslocamento) % 251);
}

// Objeto compatível com File aceito por src/files/process.js:5 (size/arrayBuffer/name/type) e, em Node 22,
// um File real — o que mantém o contrato fiel ao browser sem depender de polyfill.
export function novoArquivo({ name = 'contrato.txt', type = 'text/plain', bytes = bytesFicticios(8) } = {}) {
  return new File([bytes], name, { type });
}

export function novaFoto({ name = 'foto.png', type = 'image/png', bytes = bytesFicticios(16, 7) } = {}) {
  return new File([bytes], name, { type });
}

// ---------- histórico ----------
export function novoHistorico(over = {}) {
  return { id: over.id ?? novoId('his'), clientId: over.clientId ?? null, type: 'Cadastro de cliente', detail: '', createdAt: 1700000000000, ...over };
}

// ---------- backup (formato aceito por src/export/backup-format.js) ----------
export function conjuntoBackup({ clientes = 2, dividas = 2, documentos = 1, historicos = 2, bytesPorArquivo = 100 } = {}) {
  const clients = listaClientes(clientes);
  const debts = Array.from({ length: dividas }, (_, i) => novaDividaFicticia({ id: `dvd-${i + 1}`, clientId: clients[i % clients.length].id }));
  const files = new Map();
  const documents = Array.from({ length: documentos }, (_, i) => {
    const blobId = `blb-${i + 1}`;
    files.set(blobId, bytesFicticios(bytesPorArquivo, i));
    return novoDocumento({ id: `doc-${i + 1}`, clientId: clients[i % clients.length].id, blobId });
  });
  for (const c of clients) if (c.photoId) files.set(c.photoId, bytesFicticios(bytesPorArquivo, 9));
  const history = Array.from({ length: historicos }, (_, i) => novoHistorico({ id: `his-${i + 1}`, clientId: clients[i % clients.length].id }));
  return {
    clients, debts, documents, history,
    settings: { dueWindow: 7 }, files, dbVersion: 1,
  };
}

export function resetFixtures() { seq = 0 }
