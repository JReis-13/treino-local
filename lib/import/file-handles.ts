const DATABASE = "treino-local-handles";
const STORE = "files";

async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("File handle storage unavailable."));
  });
}

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("File handle storage failed."));
      transaction.onerror = () => reject(transaction.error ?? new Error("File handle storage failed."));
    });
  } finally { database.close(); }
}

export async function saveFileHandle(planId: string, handle: FileSystemFileHandle): Promise<void> {
  await operation("readwrite", (store) => store.put(handle, planId));
}
export async function loadFileHandle(planId: string): Promise<FileSystemFileHandle | undefined> {
  return operation("readonly", (store) => store.get(planId));
}
export async function removeFileHandle(planId: string): Promise<void> {
  await operation("readwrite", (store) => store.delete(planId));
}
