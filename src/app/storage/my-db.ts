import { openDB, DBSchema, IDBPDatabase, deleteDB } from 'idb';
import { Plan } from '../models/plan';

interface AudioAppDB extends DBSchema {
  files: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      url: string;
      downloadedAt: number;
    };
    indexes: { 'by-downloadedAt': number };
  };
  plans: {
    key: string;
    value: Plan;
    indexes: {
      'by-title': string;
      'by-status': string;
      'by-startedAt': string;
    };
  };
  bibles: {
    key: string;
    value: {
      id: string;
      version: string;
      language: string;
      fullName: string;
      data: any;
      downloadedAt: number;
      sizeInBytes?: number;
    };
    indexes: {
      'by-language': string;
      'by-version': string;
      'by-downloadedAt': number;
    };
  };
}

const DB_NAME = 'audio-db';
const DB_VERSION = 3;

// Lista de stores com tipo literal (as const) para satisfazer o TypeScript
const STORE_NAMES = ['files', 'plans', 'bibles'] as const;
type StoreName = (typeof STORE_NAMES)[number]; // "files" | "plans" | "bibles"

export const dbPromise: Promise<IDBPDatabase<AudioAppDB>> = (async () => {
  try {
    return await openDB<AudioAppDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion) {
        console.log(`Upgrading DB from ${oldVersion} to ${newVersion}`);

        if (oldVersion < 1) {
          const store = db.createObjectStore('files', { keyPath: 'id' });
          store.createIndex('by-downloadedAt', 'downloadedAt');
        }
        if (oldVersion < 2) {
          const store = db.createObjectStore('plans', { keyPath: 'id' });
          store.createIndex('by-title', 'title');
          store.createIndex('by-status', 'status');
          store.createIndex('by-startedAt', 'startedAt');
        }
        if (oldVersion < 3) {
          const store = db.createObjectStore('bibles', { keyPath: 'id' });
          store.createIndex('by-language', 'language');
          store.createIndex('by-version', 'version');
          store.createIndex('by-downloadedAt', 'downloadedAt');
        }
      },
      blocked() {
        console.warn('DB upgrade blocked — close other tabs');
        alert('Atualização bloqueada. Feche outras abas do app e recarregue.');
      },
      blocking() {
        console.warn('New DB version — reloading');
        window.location.reload();
      },
    });
  } catch (error: any) {
    console.error('Failed to open IndexedDB:', error);

    if (
      error.name === 'VersionError' ||
      error.message?.includes('object store') ||
      error.message?.includes('not found') ||
      error.name === 'InvalidStateError'
    ) {
      console.warn('DB corrupted or schema mismatch — recovering...');
      await recoverCorruptedDatabase();
      return await createFreshDatabase();
    }

    console.error('IndexedDB unavailable — using fallback');
    return createFallbackDb();
  }
})();

async function recoverCorruptedDatabase(): Promise<void> {
  try {
    await deleteDB(DB_NAME, {
      blocked() {
        console.warn('Delete blocked — close other tabs');
        alert('Para corrigir o armazenamento, feche todas as abas deste app e recarregue.');
      },
    });
    console.log('Corrupted database deleted');
  } catch (err) {
    console.error('Failed to delete corrupted DB:', err);
  }
}

async function createFreshDatabase(): Promise<IDBPDatabase<AudioAppDB>> {
  return openDB<AudioAppDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Apaga todas as stores existentes e recria do zero (tipo seguro)
      STORE_NAMES.forEach((storeName) => {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
      });

      const filesStore = db.createObjectStore('files', { keyPath: 'id' });
      filesStore.createIndex('by-downloadedAt', 'downloadedAt');

      const plansStore = db.createObjectStore('plans', { keyPath: 'id' });
      plansStore.createIndex('by-title', 'title');
      plansStore.createIndex('by-status', 'status');
      plansStore.createIndex('by-startedAt', 'startedAt');

      const biblesStore = db.createObjectStore('bibles', { keyPath: 'id' });
      biblesStore.createIndex('by-language', 'language');
      biblesStore.createIndex('by-version', 'version');
      biblesStore.createIndex('by-downloadedAt', 'downloadedAt');

      console.log('Fresh database created (v3)');
    },
  });
}

function createFallbackDb(): any {
  const noop = async () => {};
  const mockTx = {
    get: async () => null,
    getAll: async () => [],
    put: noop,
    add: noop,
    delete: noop,
    clear: noop,
    objectStore: () => mockTx,
  };

  return {
    get: () => null,
    getAll: () => [],
    put: noop,
    add: noop,
    delete: noop,
    clear: noop,
    transaction: () => mockTx,
    close: () => {},
  } as any;
}

// === Operações seguras ===

export async function saveBibleVersion(
  id: string,
  versionName: string,
  language: string,
  fullName: string,
  bibleData: any
) {
  try {
    const db = await dbPromise;
    const sizeInBytes = new Blob([JSON.stringify(bibleData)]).size;
    await db.put('bibles', {
      id,
      version: versionName,
      language,
      fullName,
      data: bibleData,
      downloadedAt: Date.now(),
      sizeInBytes,
    });
    console.log(`Bíblia ${fullName} salva (${(sizeInBytes / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error('Erro ao salvar Bíblia:', err);
    throw new Error('Não foi possível salvar a Bíblia offline.');
  }
}

export async function getBibleVersion(id: string) {
  try {
    const db = await dbPromise;
    return await db.get('bibles', id);
  } catch (err) {
    console.error('Erro ao carregar Bíblia:', err);
    return null;
  }
}

export async function getAllSavedBibles() {
  try {
    const db = await dbPromise;
    return await db.getAll('bibles');
  } catch (err) {
    console.error('Erro ao listar Bíblias:', err);
    return [];
  }
}

export async function deleteBibleVersion(id: string) {
  try {
    const db = await dbPromise;
    await db.delete('bibles', id);
    console.log(`Bíblia ${id} removida`);
  } catch (err) {
    console.error('Erro ao remover Bíblia:', err);
  }
}

export class AvailableSpace {
  private readonly ONE_MB = 1024 * 1024;
  private readonly MIN_FREE_SPACE_MB = 20;

  async inMB(): Promise<number> {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) return 150;

    try {
      const estimate = await navigator.storage.estimate();
      const available = (estimate.quota || 0) - (estimate.usage || 0);
      return Math.floor(available / this.ONE_MB);
    } catch (e) {
      console.warn('Erro ao estimar espaço:', e);
      return 100;
    }
  }

  async isSafe(minMB = this.MIN_FREE_SPACE_MB): Promise<boolean> {
    return (await this.inMB()) > minMB;
  }
}
