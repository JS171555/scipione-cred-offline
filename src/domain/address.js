import{digits}from './validators.js';
export const onlyDigits=digits;
export const maskCep=v=>digits(v).slice(0,8).replace(/(\d{5})(\d)/,'$1-$2');
export const validCep=v=>{const d=digits(v);return d.length===8&&d!=='00000000'};
const clean=v=>String(v||'').trim();
export function composeAddress(a={}){
  const street=clean(a.street),district=clean(a.district),city=clean(a.city),state=clean(a.state).toUpperCase();
  const cityState=city&&state?`${city}/${state}`:city||state;
  const line2=district&&cityState?`${district} - ${cityState}`:district||cityState;
  return street&&line2?`${street}, ${line2}`:street||line2;
}
