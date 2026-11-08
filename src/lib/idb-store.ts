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

// Account-scoped recovery copies never replace the original local dataset.
export interface RecoveryCopy { key: string; version: number; state: AppState; savedAt: string }
export const recoveryKey = (userId: string, instanceId: string) => `ai-wiki:cloud-draft:${userId}:${instanceId}`;
export async function saveRecovery(copy: RecoveryCopy): Promise<void> {
  await run('readwrite', (s) => s.put(copy, copy.key));
}
export async function loadRecovery(userId: string): Promise<RecoveryCopy[]> {
  const prefix = `ai-wiki:cloud-draft:${userId}:`;
  const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  const copies = await Promise.all(keys.filter((k) => typeof k === 'string' && k.startsWith(prefix))
    .map((key) => run<RecoveryCopy>('readonly', (s) => s.get(key))));
  return copies.filter((copy) => copy?.state).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
// Acknowledging a copy only hides the reminder; the copy itself stays stored.
export interface RecoveryAck { key: string; savedAt: string }
export const recoveryAckKey = (userId: string) => `ai-wiki:recovery-ack:${userId}`;
/** 확인 기록과 key·savedAt이 모두 같은 사본만 숨긴다 (새 사본, 다시 저장된 사본은 다시 안내) */
export const visibleRecovery = (copies: RecoveryCopy[], acks: RecoveryAck[]) =>
  copies.filter((c) => !acks.some((a) => a.key === c.key && a.savedAt === c.savedAt));
/** 아직 남아 있는 사본의 확인 기록만 유지하고, 방금 확인한 사본을 더한다 */
export function nextRecoveryAcks(previous: RecoveryAck[], acked: RecoveryCopy[], existing: RecoveryCopy[]): RecoveryAck[] {
  const present = new Set(existing.map((c) => c.key));
  const replaced = new Set(acked.map((c) => c.key));
  return [...previous.filter((a) => present.has(a.key) && !replaced.has(a.key)), ...acked.map(({ key, savedAt }) => ({ key, savedAt }))];
}
const isAck = (a: unknown): a is RecoveryAck =>
  !!a && typeof (a as RecoveryAck).key === 'string' && typeof (a as RecoveryAck).savedAt === 'string';
export async function loadRecoveryAcks(userId: string): Promise<RecoveryAck[]> {
  const value = await run<unknown>('readonly', (s) => s.get(recoveryAckKey(userId)));
  return Array.isArray(value) ? value.filter(isAck) : [];
}
export async function saveRecoveryAcks(userId: string, acks: RecoveryAck[]): Promise<void> {
  await run('readwrite', (s) => s.put(acks, recoveryAckKey(userId)));
}
export async function clearRecovery(key: string, version: number): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => { if (req.result?.version === version) store.delete(key); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
