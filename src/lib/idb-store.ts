/**
 * 앱 데이터 저장소 (IndexedDB)
 * localStorage는 사이트당 약 5MB로 제한되어, 자료 본문이 많아지면 저장에 실패한다.
 * IndexedDB는 훨씬 큰 용량을 쓸 수 있으므로 전체 상태를 여기에 저장한다.
 * - DB 'ai-wiki-data' / 저장소 'state' / 키 'ai-wiki:v2' (localStorage와 같은 키 이름)
 * - 값은 localStorage에 쓰던 것과 같은 JSON 문자열 — 읽은 뒤 기존 검증(parseFullState)을 그대로 거친다.
 * - 기존 localStorage 데이터는 지우지 않는다 (처음 한 번 IndexedDB로 옮겨 저장한 뒤에도 원본으로 남겨 둠).
 */
import { SCHEMA_VERSION, type AppState } from '../types';
import { STORAGE_KEY } from './persist';

const DB = 'ai-wiki-data';
const STORE = 'state';

export const idbAvailable = () => typeof indexedDB !== 'undefined';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB가 다른 탭에서 사용 중입니다.'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 저장이 취소되었습니다.'));
    });
  } finally {
    db.close();
  }
}

/** 저장된 상태 원문(JSON 문자열). 없으면 null */
export const idbLoadRaw = () => run<string | undefined>('readonly', (s) => s.get(STORAGE_KEY)).then((v) => (typeof v === 'string' ? v : null));

export type IdbSaveResult = { ok: true } | { ok: false; reason: string };

export async function idbSave(state: AppState): Promise<IdbSaveResult> {
  try {
    await run('readwrite', (s) => s.put(JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), ...state }), STORAGE_KEY));
    return { ok: true };
  } catch (e) {
    const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
    return { ok: false, reason: quota ? '브라우저 저장 공간 부족' : '브라우저 저장 실패' };
  }
}

/** 손상된 원본을 지우지 않고 별도 키에 보관 */
export const idbKeepCopy = (raw: string, now = Date.now()) => run('readwrite', (s) => s.put(raw, `${STORAGE_KEY}:corrupt-${now}`)).catch(() => undefined);
