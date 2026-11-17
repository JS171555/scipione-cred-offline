// Configuração pública do OAuth do Google Drive.
// Cliente OAuth do tipo "Aplicativo da Web" do projeto Google Cloud.
// O client_secret NUNCA é copiado para o repositório nem usado pelo aplicativo.
export const GOOGLE_OAUTH = {
  clientId: '236359551321-aedlnkvretokom2516a4bq6m562b4shv.apps.googleusercontent.com',
  // Projeto Google Cloud que contém o cliente acima.
  // A autenticação usa o clientId; este campo é informativo.
  projectId: 'optimum-habitat-447421-c4',
  type: 'web',
  origins: ['https://scipione-cred-offline.vercel.app']
};
