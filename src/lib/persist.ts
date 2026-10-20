/**
 * localStorage 읽기·쓰기. 저장소를 인자로 받아 브라우저 밖(검증 스크립트)에서도 같은 코드를 시험할 수 있다.
 * - 'ai-wiki:v2'를 읽고, 없으면 기존 'ai-wiki:v1'을 변환해 사용 (v1 원본은 지우지 않음)
 * - v2 데이터가 손상되면 원본을 'ai-wiki:v2:corrupt-<시각>' 키에 보관
 *   보관도 실패하면 덮어쓰지 않도록 자동 저장을 중지한다 (복원·초기화·사용자의 명시적 재개 전까지)
 */
import { SCHEMA_VERSION, type AppState } from '../types';
import { parseFullState } from './data';

export const STORAGE_KEY = 'ai-wiki:v2';
export const LEGACY_KEY_V1 = 'ai-wiki:v1';
export const CORRUPT_PREFIX = `${STORAGE_KEY}:corrupt-`;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type NoticeKind = 'success' | 'error' | 'info';

export interface LoadResult {
  state: AppState;
  notices: { text: string; kind: NoticeKind }[];
  /** true면 자동 저장 중지 — 읽지 못한 원본을 덮어쓰지 않기 위해 */
  blockSave: boolean;
  /** 손상 데이터 사본을 보관한 키 */
  corruptKey?: string;
}

function existingCopy(storage: StorageLike, raw: string): string | undefined {
  // Storage 객체면 키 목록을 확인 (검증용 메모리 저장소는 key/length가 없을 수 있음)
  const s = storage as Partial<Storage>;
  if (typeof s.key !== 'function' || typeof s.length !== 'number') return undefined;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(CORRUPT_PREFIX) && storage.getItem(k) === raw) return k;
  }
  return undefined;
}

export function loadState(storage: StorageLike | null, initial: () => AppState, now = Date.now()): LoadResult {
  const notices: LoadResult['notices'] = [];
  let blockSave = false;
  let corruptKey: string | undefined;
  let raw: string | null = null;
  if (!storage)
    return { state: initial(), notices: [{ text: '브라우저 저장소에 접근할 수 없습니다. 이번 세션 내용은 저장되지 않습니다.', kind: 'error' }], blockSave: true };
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: initial(), notices: [{ text: '브라우저 저장소에 접근할 수 없습니다. 이번 세션 내용은 저장되지 않습니다.', kind: 'error' }], blockSave: true };
  }
  if (raw) {
    try {
      const r = parseFullState(JSON.parse(raw));
      if (r.dropped) notices.push({ text: `저장 자료 중 ${r.dropped}건은 형식이 올바르지 않아 불러오지 못했습니다.`, kind: 'error' });
      return { state: r.state, notices, blockSave };
    } catch {
      try {
        // 같은 원본을 이미 보관했다면 다시 복사하지 않는다 (개발 모드의 이중 초기화, 반복 새로고침)
        corruptKey = existingCopy(storage, raw) ?? `${CORRUPT_PREFIX}${now}`;
        if (storage.getItem(corruptKey) !== raw) storage.setItem(corruptKey, raw);
        notices.push({ text: `저장 데이터를 읽지 못했습니다. 원본은 '${corruptKey}'에 보관했습니다. 백업 파일로 복원하세요.`, kind: 'error' });
      } catch {
        corruptKey = undefined;
        blockSave = true;
        notices.push({ text: '저장 데이터를 읽지 못했고 원본 사본도 만들 수 없어 자동 저장을 중지했습니다. 연구 설정에서 백업 파일로 복원하세요.', kind: 'error' });
      }
    }
  }
  try {
    const legacy = storage.getItem(LEGACY_KEY_V1);
    if (legacy) {
      // v1 → v2 변환: 기존 자료·설정·집필 상태를 그대로 옮기고, 새 필드만 채운다.
      const parsed = JSON.parse(legacy) as Record<string, unknown>;
      const r = parseFullState({ ...parsed, materials: Array.isArray(parsed.materials) ? parsed.materials : [] });
      notices.push({
        text: raw
          ? `이전 버전(v1) 저장 자료 ${r.state.materials.length}건을 대신 불러왔습니다.`
          : `기존 저장 자료 ${r.state.materials.length}건을 새 데이터 구조로 옮겼습니다.`,
        kind: 'info',
      });
      return { state: r.state, notices, blockSave, corruptKey };
    }
  } catch {
    notices.push({ text: '이전 버전 저장 자료를 읽지 못했습니다. 원본은 그대로 남겨 두었습니다.', kind: 'error' });
  }
  return { state: initial(), notices, blockSave, corruptKey };
}

export type SaveResult = { ok: true } | { ok: false; reason: string };

export function saveState(storage: StorageLike | null, state: AppState): SaveResult {
  if (!storage) return { ok: false, reason: '브라우저 저장소 접근 불가' };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), ...state }));
    return { ok: true };
  } catch (e) {
    const quota = e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return { ok: false, reason: quota ? '브라우저 저장 공간 부족' : '브라우저 저장 실패' };
  }
}

/** 브라우저 localStorage (접근 자체가 막힌 환경에서는 null) */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
