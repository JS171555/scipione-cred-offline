// Atualização reativa: toda gravação em lote (db.batch) dispara 'data-changed'; a tela ativa registra UM observador.
let cb=null;addEventListener('data-changed',()=>{try{cb?.()}catch(e){console.warn(e)}});
export const watch=f=>{cb=f};export const unwatch=()=>{cb=null};
