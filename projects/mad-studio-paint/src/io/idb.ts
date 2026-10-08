/** Minimal promise wrapper around one IndexedDB object store (autosave). */

const DB_NAME = 'mad-studio-paint';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(value, key));
  } catch {
    // Storage can be unavailable (private mode); autosave is best effort.
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
    // Ignored.
  }
}
