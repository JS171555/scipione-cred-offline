# Revisão final — SCIPIONE CRED

## Verificado
- Todos os testes automatizados passando (`npm test`).
- Fluxo completo no navegador (computador e celular): criar cofre, cadastrar cliente, cadastrar dívida (R$ 1.000,00 a 5% = R$ 50,00/mês no painel), exportar Excel, gerar backup criptografado e verificar a restauração com integridade confirmada.
- Nenhum erro no console e nenhuma rolagem horizontal nas telas Início, Clientes, Dívidas, Relatórios, Backup e Configurações.

## Correções
- **Cache offline (sw.js)**: o app não intercepta mais a consulta de CPF nem chamadas externas (Google, ViaCEP), evitando respostas antigas ou falhas offline indevidas. Versão do cache atualizada (sc-v70) para todos receberem a correção.
- **Consulta de CPF (api/cpf.js)**: bloqueia chamadas vindas de outros sites e limita 20 consultas por minuto por IP, protegendo a chave paga contra abuso.
- **Cabeçalhos de segurança (vercel.json)**: adicionados HSTS e Permissions-Policy.
- **Testes (package.json)**: adicionados `npm test` e `npm start`; o comando antigo falhava ao receber a pasta em vez dos arquivos. Novo teste para a consulta de CPF.

## Pendente do seu lado
- Google Drive: adicionar o domínio final em "Origens JavaScript autorizadas" no Google Cloud.
- Consulta de CPF: definir `APICPF_API_KEY` nas variáveis de ambiente da Vercel.
