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
}

// Versão atual do banco – aumente só quando precisar de novas migrações
const DB_VERSION = 2;

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

    // Futuras versões:
    // if (oldVersion < 3) { ... }
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

