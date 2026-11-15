# Bibliotecas locais (sem CDN)
- fflate 0.8.2, licença MIT (https://github.com/101arrowz/fflate): ZIP. Arquivo: fflate.min.js (UMD, global `fflate`).
O .xlsx é gerado por src/export/xlsx.js (XML + ZIP), sem biblioteca de planilha: o ExcelJS foi descartado porque o bundle usa `new Function`, que a política de segurança do app (CSP sem unsafe-eval) pode bloquear.
