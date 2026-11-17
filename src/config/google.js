// Configuração pública do OAuth do Google Drive.
// Cliente OAuth do tipo "Aplicativo da Web" do projeto Google Cloud.
// O client_secret NUNCA é copiado para o repositório nem usado pelo aplicativo.
export const GOOGLE_OAUTH = {
  clientId: '236359551321-aedlnkvretokom2516a4bq6m562b4shv.apps.googleusercontent.com',
  // Opcional e apenas informativo: Project ID do projeto que contém o cliente acima.
  // A autenticação usa o clientId, não este campo.
  projectId: '',
  type: 'web',
  origins: ['https://scipione-cred-offline.vercel.app']
};
