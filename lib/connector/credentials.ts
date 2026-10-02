const DATABASE = "treino-local-connector-credentials";
const STORE = "keys";
const DEVICE_CONNECTOR = "device-connector-v2";
export interface DeviceConnector { url: string; key: string; version: 2; checkedAt: string; }

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
      let result: T;
      request.onsuccess = () => { result = request.result; if (mode === "readonly") resolve(result); };
      request.onerror = () => reject(request.error ?? new Error("Connector key storage failed."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Connector key storage failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Connector key storage was interrupted."));
      transaction.oncomplete = () => { if (mode === "readwrite") resolve(result); };
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

export async function saveDeviceConnector(connector: DeviceConnector): Promise<void> {
  await operation("readwrite", (store) => store.put(connector, DEVICE_CONNECTOR));
}
export async function loadDeviceConnector(): Promise<DeviceConnector | undefined> {
  return operation("readonly", (store) => store.get(DEVICE_CONNECTOR));
}
export async function removeDeviceConnector(): Promise<void> {
  await operation("readwrite", (store) => store.delete(DEVICE_CONNECTOR));
}
export async function loadPlanConnectorKey(planId: string, version?: number): Promise<string | undefined> {
  return version === 2 ? (await loadDeviceConnector())?.key : loadConnectorKey(planId);
}
