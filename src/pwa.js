const cbs=[];let deferred;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;cbs.forEach(f=>f())});
export const registerSW=async()=>{if('serviceWorker'in navigator)try{await navigator.serviceWorker.register('sw.js')}catch(e){console.warn('SW',e)}};
export const requestPersist=async()=>{try{return await navigator.storage?.persist?.()}catch{return false}};
export async function storageInfo(){const s=navigator.storage;const[persisted,est]=await Promise.all([s?.persisted?.().catch(()=>false),s?.estimate?.().catch(()=>null)]);return{persisted:!!persisted,usage:est?.usage,quota:est?.quota}}
export const offlineReady=async()=>!!(await navigator.serviceWorker?.getRegistration())?.active;
export const canInstall=()=>!!deferred;
export const onInstallable=f=>{cbs.length=0;cbs.push(f);return()=>{const i=cbs.indexOf(f);if(i>=0)cbs.splice(i,1)}};
export const install=async()=>{await deferred.prompt();deferred=null};
export const isStandalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
export const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
