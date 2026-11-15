// Imagens JPG/PNG/WebP/BMP -> WebP (JPEG se o navegador não codificar WebP), reduzidas a maxSide.
// O original só é trocado se a conversão deu certo E ficou menor (ou force=true, usado nas fotos de perfil).
// PDFs e demais formatos são guardados como vieram (compressão de PDF não implementada).
const MAX=15*1048576,hex=u=>[...u].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function toStored(file,{force=false,maxSide=1600,q=.8}={}){
  if(file.size>MAX)throw new Error('Arquivo acima de 15 MB.');
  const buf=new Uint8Array(await file.arrayBuffer()),hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)));
  const r={bytes:buf,type:file.type||'application/octet-stream',size:buf.length,originalSize:buf.length,hash,converted:false};
  if(!/^image\/(jpeg|png|webp|bmp)$/.test(r.type)){if(force)throw new Error('Selecione uma imagem JPG, PNG ou WebP.');return r}
  try{
    const bmp=await createImageBitmap(file),k=Math.min(1,maxSide/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');
    c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);bmp.close?.();
    let b=await new Promise(o=>c.toBlob(o,'image/webp',q));if(b?.type!=='image/webp')b=await new Promise(o=>c.toBlob(o,'image/jpeg',q));
    if(b&&(force||b.size<buf.length)){const nb=new Uint8Array(await b.arrayBuffer());Object.assign(r,{bytes:nb,type:b.type,size:nb.length,converted:true})}
  }catch{if(force)throw new Error('Não foi possível ler esta imagem.')}
  return r}
