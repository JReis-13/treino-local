const DATABASE = "treino-local-connector-credentials";
const STORE = "keys";

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Connector key storage is unavailable."));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Connector key storage failed."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Connector key storage failed."));
    });
  } finally { database.close(); }
}

export async function saveConnectorKey(planId: string, key: string): Promise<void> {
  await operation("readwrite", (store) => store.put(key, planId));
}
export async function loadConnectorKey(planId: string): Promise<string | undefined> {
  return operation("readonly", (store) => store.get(planId));
}
export async function removeConnectorKey(planId: string): Promise<void> {
  await operation("readwrite", (store) => store.delete(planId));
}
