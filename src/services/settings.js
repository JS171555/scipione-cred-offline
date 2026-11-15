import*as db from '../db/idb.js';
export const getDueWindow=async()=>(await db.get('settings','dueWindow'))?.value??7;
export const setDueWindow=n=>db.put('settings',{key:'dueWindow',value:n});
