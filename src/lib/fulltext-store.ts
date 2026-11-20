/**
 * 논문 원문 보관소 — 자료 JSON(ai_wiki_materials)에는 넣지 않는다.
 * 1) 이 브라우저의 IndexedDB (항상)
 * 2) Supabase Storage 비공개 버킷 'ai-wiki-fulltext'의 <user_id>/<material_id>.json (마이그레이션 적용 시)
 *    버킷이 없거나 권한이 없으면 1)만 쓰고 그 사실을 돌려준다.
 */
import { supabase } from './supabase';
import { validDoc, type FullTextDoc } from './fulltext';

export const FULLTEXT_BUCKET = 'ai-wiki-fulltext';
const DB = 'ai-wiki-fulltext';
const STORE = 'texts';
/** 다시 추출용 원본 PDF (이 기기에만 보관, 클라우드에 올리지 않음) */
const PDF_STORE = 'pdfs';
const STORES = [STORE, PDF_STORE];
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

const key = (userId: string, materialId: string) => `${userId}:${materialId}`;
const cloudPath = (userId: string, materialId: string) => `${userId}/${materialId}.json`;

function open(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
    const req = version ? indexedDB.open(DB, version) : indexedDB.open(DB);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    // 다른 탭이 연결을 쥐고 있어 저장소를 만들 수 없으면 무한 대기 대신 안내
    req.onblocked = () => reject(new Error('다른 AI-WIKI 탭이 원문 저장소를 쓰고 있어 열 수 없습니다. 다른 탭을 닫고 다시 시도하세요.'));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // 다른 탭의 업그레이드를 막지 않는다
      // 저장소가 빠진 DB(이전 버전·다른 코드가 먼저 연 경우)는 버전을 올려 저장소를 만든다
      if (STORES.every((s) => db.objectStoreNames.contains(s))) return resolve(db);
      const next = db.version + 1;
      db.close();
      open(next).then(resolve, reject);
    };
    req.onerror = () => reject(req.error ?? new Error('원문 저장소를 열지 못했습니다.'));
  });
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, store = STORE): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? new Error('원문 저장소 오류'));
      tx.onabort = () => reject(tx.error ?? new Error('원문 저장이 취소되었습니다 (저장 공간 부족일 수 있음).'));
    });
  } finally {
    db.close();
  }
}

/** 원본 PDF를 이 기기에 보관 (다시 추출용). 저장 공간이 부족하면 조용히 건너뛴다 */
export async function savePdf(userId: string, materialId: string, pdf: Blob): Promise<boolean> {
  if (!SAFE_ID.test(materialId)) return false;
  return run('readwrite', (s) => s.put(pdf, key(userId, materialId)), PDF_STORE).then(() => true, () => false);
}
export async function loadPdf(userId: string, materialId: string): Promise<Blob | undefined> {
  if (!SAFE_ID.test(materialId)) return undefined;
  const b = await run<unknown>('readonly', (s) => s.get(key(userId, materialId)), PDF_STORE).catch(() => undefined);
  return b instanceof Blob ? b : undefined;
}

export interface SaveResult {
  cloud: boolean;
  /** 클라우드에 못 올린 이유 (로컬에는 저장됨) */
  cloudError?: string;
}

const cloudReason = (msg: string) =>
  /bucket not found|not found/i.test(msg)
    ? '클라우드 원문 저장소(Storage 버킷)가 아직 준비되지 않아 이 기기에만 저장했습니다.'
    : /row-level security|unauthorized|permission|403/i.test(msg)
      ? '클라우드 원문 저장 권한이 없어 이 기기에만 저장했습니다.'
      : '클라우드 저장에 실패해 이 기기에만 저장했습니다.';

export async function saveFullText(userId: string, doc: FullTextDoc): Promise<SaveResult> {
  if (!SAFE_ID.test(doc.materialId)) throw new Error('자료 ID 형식이 올바르지 않습니다.');
  await run('readwrite', (s) => s.put(doc, key(userId, doc.materialId)));
  if (!supabase) return { cloud: false, cloudError: '클라우드 연결 설정이 없어 이 기기에만 저장했습니다.' };
  try {
    const { error } = await supabase.storage
      .from(FULLTEXT_BUCKET)
      .upload(cloudPath(userId, doc.materialId), new Blob([JSON.stringify(doc)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
    return error ? { cloud: false, cloudError: cloudReason(error.message) } : { cloud: true };
  } catch (e) {
    return { cloud: false, cloudError: cloudReason(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * 원문 읽기: 이 기기 → 없으면 클라우드(받아서 이 기기에 보관).
 * expectedHash가 다르면(다른 PDF로 바뀜) 쓰지 않는다.
 */
export async function loadFullText(userId: string, materialId: string, expectedHash?: string): Promise<FullTextDoc | undefined> {
  if (!SAFE_ID.test(materialId)) return undefined;
  const match = (d: FullTextDoc | undefined) => (d && (!expectedHash || d.hash === expectedHash) ? d : undefined);
  let local: FullTextDoc | undefined;
  try {
    local = validDoc(await run<unknown>('readonly', (s) => s.get(key(userId, materialId))), materialId);
  } catch {
    local = undefined;
  }
  if (match(local)) return local;
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase.storage.from(FULLTEXT_BUCKET).download(cloudPath(userId, materialId));
    if (error || !data) return undefined;
    const doc = match(validDoc(JSON.parse(await data.text()), materialId));
    if (doc) await run('readwrite', (s) => s.put(doc, key(userId, materialId))).catch(() => undefined);
    return doc;
  } catch {
    return undefined;
  }
}

export async function deleteFullText(userId: string, materialId: string): Promise<void> {
  if (!SAFE_ID.test(materialId)) return;
  await run('readwrite', (s) => s.delete(key(userId, materialId))).catch(() => undefined);
  await run('readwrite', (s) => s.delete(key(userId, materialId)), PDF_STORE).catch(() => undefined);
  if (supabase) await supabase.storage.from(FULLTEXT_BUCKET).remove([cloudPath(userId, materialId)]).catch(() => undefined);
}
