"use strict";

globalThis.TransitStorage = (() => {
  const key = "workspace";
  let database;
  let revision = 0;
  let queue = Promise.resolve();

  function transact(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction("data", mode);
      const store = tx.objectStore("data");
      let result;
      let error;
      const read = store.get(key);
      read.onsuccess = () => {
        try { result = action(read.result, store); }
        catch (cause) { error = cause; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(error || tx.error || Error("IndexedDB transaction aborted"));
    });
  }

  async function open(legacy) {
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("transit-fuel", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("data");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error("IndexedDB upgrade blocked"));
    });
    database.onversionchange = () => database.close();
    const record = await transact("readwrite", (existing, store) => {
      if (existing) return existing;
      const initial = {revision: 1, ...legacy()};
      store.put(initial, key);
      return initial;
    });
    revision = record.revision;
    return record;
  }

  function save(changes) {
    const snapshot = structuredClone(changes);
    const write = queue.then(() => transact("readwrite", (previous, store) => {
      if (previous?.revision !== revision) throw Error("The workspace changed in another tab");
      const record = {...previous, ...snapshot, revision: revision + 1};
      store.put(record, key);
      return record.revision;
    })).then(next => { revision = next; });
    queue = write.catch(() => {});
    return write;
  }

  return {open, save};
})();
