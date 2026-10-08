(function(){
  'use strict';

  const DB_NAME='corralon_local_cache_v1';
  const DB_VERSION=1;
  const STORE_NAME='entries';
  const memoryFallback=new Map();
  let dbPromise=null;

  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('IndexedDB no disponible'));return}
      const request=window.indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME,{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('No se pudo abrir IndexedDB'));
    });
    return dbPromise;
  }

  async function get(key, options = {}){
    try{
      const db=await openDb();
      return await new Promise((resolve,reject)=>{
        const request=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).get(String(key));
        request.onsuccess=()=>resolve(request.result?.value??null);
        request.onerror=()=>reject(request.error);
      });
    }catch(error){
      if(options.strict)throw error;
      console.warn('Cache IndexedDB:',error);
      return memoryFallback.get(String(key))??null;
    }
  }

  async function set(key,value){
    memoryFallback.set(String(key),value);
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,'readwrite');
      transaction.objectStore(STORE_NAME).put({key:String(key),value,updatedAt:Date.now()});
      transaction.oncomplete=()=>resolve(value);
      transaction.onerror=()=>reject(transaction.error||new Error('No se pudo guardar en IndexedDB'));
      transaction.onabort=()=>reject(transaction.error||new Error('Guardado abortado en IndexedDB'));
    });
  }

  async function remove(key){
    memoryFallback.delete(String(key));
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,'readwrite');
      transaction.objectStore(STORE_NAME).delete(String(key));
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>reject(transaction.error||new Error('No se pudo borrar de IndexedDB'));
    });
  }

  async function migrateLocalStorage(key){
    const existing=await get(key);
    if(existing!==null)return existing;
    let raw=null;
    try{raw=localStorage.getItem(String(key))}catch{}
    if(!raw)return null;
    let value;
    try{value=JSON.parse(raw)}catch{return null}
    await set(key,value);
    try{localStorage.removeItem(String(key))}catch{}
    return value;
  }

  async function updateMany(entries, removeKeys = []){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,'readwrite'),store=transaction.objectStore(STORE_NAME);
      try{
        entries.forEach(([key,value])=>store.put({key:String(key),value,updatedAt:Date.now()}));
        removeKeys.forEach(key=>store.delete(String(key)));
      }catch(error){transaction.abort();reject(error);return;}
      transaction.oncomplete=()=>{entries.forEach(([key,value])=>memoryFallback.set(String(key),value));removeKeys.forEach(key=>memoryFallback.delete(String(key)));resolve();};
      transaction.onerror=()=>reject(transaction.error||new Error('No se pudieron actualizar las cargas'));
      transaction.onabort=()=>reject(transaction.error||new Error('Actualización de cargas abortada'));
    });
  }
  window.CorralonCacheDB={get,set,remove,migrateLocalStorage,updateMany};
})();
