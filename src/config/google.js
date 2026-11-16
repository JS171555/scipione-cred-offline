// Configuração pública do OAuth do Google Drive.
// O JSON fornecido é do tipo "installed" (aplicativo instalado); o Google não
// aceita esse tipo no fluxo de navegador. O ID público fica registrado aqui
// apenas como referência e a interface permite importar um JSON de cliente
// "web" com a origem deste site autorizada. O client_secret NUNCA é copiado
// para o repositório nem usado pelo aplicativo.
export const GOOGLE_OAUTH = {
  clientId: '662732522717-h7l5gpkqjdunasudt3f902uk7sfg6pej.apps.googleusercontent.com',
  projectId: 'oval-turbine-457821-h3',
  type: 'installed'
};
