import { openDB, DBSchema } from 'idb';
import { Plan } from '../models/plan';

interface AudioAppDB extends DBSchema {
  // Store para os arquivos de áudio baixados
  files: {
    key: string;                    // track.id ou track.fileName
    value: {
      id: string;
      blob: Blob;
      url: string;
      downloadedAt: number;
    };
    indexes: { 'by-downloadedAt': number };
  };

  // Store para os planos de leitura
  plans: {
    key: string;                    // Plan.id (string UUID ou qualquer string única)
    value: Plan;
    indexes: {
      'by-title': string;
      'by-status': string;
      'by-startedAt': string;
    };
  };

  // Store para as bíblias
  bibles: {
    key: string; // ex: "pt-ara", "en-niv", "zh-cnvs"
    value: {
      id: string;           // "pt-ara"
      version: string;      // "Almeida Revista e Atualizada"
      language: string;     // "pt"
      fullName: string;     // "Bíblia Sagrada - ARA"
      data: any;            // O JSON completo da Bíblia (estrutura que você usa)
      downloadedAt: number; // timestamp
      sizeInBytes?: number; // opcional: para controle de espaço
    };
    indexes: {
      'by-language': string;
      'by-version': string;
      'by-downloadedAt': number;
    };
  };
}

// Versão atual do banco – aumente só quando precisar de novas migrações
const DB_VERSION = 3;

export const dbPromise = openDB<AudioAppDB>('audio-db', DB_VERSION, {
  upgrade(db, oldVersion, newVersion, transaction) {
    // Migração da versão 0 → 1 (store de áudio)
    if (oldVersion < 1) {
      const filesStore = db.createObjectStore('files', { keyPath: 'id' });
      filesStore.createIndex('by-downloadedAt', 'downloadedAt');
    }

    // Migração da versão 1 → 2 (store de planos)
    if (oldVersion < 2) {
      const plansStore = db.createObjectStore('plans', { keyPath: 'id' });
      plansStore.createIndex('by-title', 'title');
      plansStore.createIndex('by-status', 'status');
      plansStore.createIndex('by-startedAt', 'startedAt');
    }

    if (oldVersion < 3) {
      const biblesStore = db.createObjectStore('bibles', { keyPath: 'id' });

      // Índices úteis
      biblesStore.createIndex('by-language', 'language');
      biblesStore.createIndex('by-version', 'version');
      biblesStore.createIndex('by-downloadedAt', 'downloadedAt');
    }

    // Futuras versões:
    // if (oldVersion < 4) { ... }
  },

  blocked(currentVersion, blockedVersion, event) {
    console.warn('Banco bloqueado por versão antiga em outra aba');
    alert('Feche outras abas do app para permitir a atualização do banco de dados.');
  },

  blocking(currentVersion, blockedVersion, event) {
    console.warn('Nova versão disponível – recarregando...');
    // Opcional: recarregar automaticamente
    // location.reload();
  },
});

export async function saveBibleVersion(
  id: string,
  versionName: string,
  language: string,
  fullName: string,
  bibleData: any
) {
  const db = await dbPromise;

  const sizeInBytes = new Blob([JSON.stringify(bibleData)]).size;

  await db.put('bibles', {
    id,
    version: versionName,
    language,
    fullName,
    data: bibleData,
    downloadedAt: Date.now(),
    sizeInBytes
  });

  console.log(`Bíblia ${fullName} salva offline (${(sizeInBytes / 1024 / 1024).toFixed(1)} MB)`);
}

// Carregar uma versão salva
export async function getBibleVersion(id: string) {
  const db = await dbPromise;
  return await db.get('bibles', id);
}

// Listar todas as versões disponíveis offline
export async function getAllSavedBibles() {
  const db = await dbPromise;
  return await db.getAll('bibles');
}

export async function deleteBibleVersion(id: string) {
  const db = await dbPromise;
  await db.delete('bibles', id);
  console.log(`Bíblia ${id} removida do armazenamento`);
}

export class AvailableSpace {
  private readonly ONE_MB = 1024 * 1024;
  private readonly MIN_FREE_SPACE_MB = 20;

  async inMB(): Promise<number> {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return 150;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const available = quota - used;

      return Math.floor(available / this.ONE_MB);
    } catch (e) {
      console.warn('MyDb::AvailableSpace -> Erro ao estimar armazenamento', e);
      return 100;
    }
  }
  async isSafe(minMB = this.MIN_FREE_SPACE_MB): Promise<boolean> {
    let available = await this.inMB();
    return available > minMB;
  }
}

