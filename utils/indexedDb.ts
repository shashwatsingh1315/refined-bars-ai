import { DBSchema, openDB } from 'idb';

interface AudioBackupDB extends DBSchema {
    backups: {
        key: number; // timestamp
        value: {
            timestamp: number;
            sessionId: string;
            parameterId: string; // e.g., '1', '2' (rubric index)
            blob: Blob;
            mimeType: string;
        };
        indexes: { 'by-session': string };
    };
}

const DB_NAME = 'bars-audio-backup';
const STORE_NAME = 'backups';

const initDB = async () => {
    return openDB<AudioBackupDB>(DB_NAME, 1, {
        upgrade(db) {
            const store = db.createObjectStore(STORE_NAME, {
                keyPath: 'timestamp',
            });
            store.createIndex('by-session', 'sessionId');
        },
    });
};

export const saveAudioBackup = async (
    blob: Blob,
    sessionId: string,
    parameterId: string
) => {
    try {
        const db = await initDB();
        await db.put(STORE_NAME, {
            timestamp: Date.now(),
            sessionId,
            parameterId,
            blob,
            mimeType: blob.type,
        });
        console.log(`[Backup] Saved audio for session ${sessionId}, param ${parameterId}`);
    } catch (err) {
        console.error("Failed to save audio backup to IndexedDB:", err);
    }
};

export const getSessionAudio = async (sessionId: string) => {
    const db = await initDB();
    return db.getAllFromIndex(STORE_NAME, 'by-session', sessionId);
};

export const getStorageStats = async (): Promise<{ count: number; sizeBytes: number }> => {
    const db = await initDB();
    const all = await db.getAll(STORE_NAME);
    let size = 0;
    all.forEach(item => {
        size += item.blob.size;
    });
    return { count: all.length, sizeBytes: size };
};

export const getQuestionAudio = async (sessionId: string, parameterId: string) => {
    const db = await initDB();
    const all = await db.getAllFromIndex(STORE_NAME, 'by-session', sessionId);
    // Filter specifically for this parameterId and sort by timestamp to ensure chronological order
    return all
        .filter(item => item.parameterId === parameterId)
        .sort((a, b) => a.timestamp - b.timestamp);
};

export const clearAllBackups = async () => {
    const db = await initDB();
    await db.clear(STORE_NAME);
    console.log("[Backup] All audio backups cleared.");
};
