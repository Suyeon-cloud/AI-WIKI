/**
 * Obsidian Vault 폴더 연결 (File System Access API)
 * - 사용자가 폴더 선택 창에서 직접 고른 폴더(와 그 하위)만 읽고 쓴다.
 * - 폴더 핸들은 IndexedDB에 보관해 새로고침 후에도 기억하지만, 접근 권한은 브라우저 정책에 따라
 *   다시 요청해야 할 수 있다 (사용자가 버튼을 눌러 허용).
 * - 지원 브라우저: Chrome·Edge 등 Chromium 계열 데스크톱. 미지원 환경에서는 기존 .md 가져오기/내보내기를 사용한다.
 */
import type { Material } from '../types';
import { materialToMarkdown, safeFileName } from './utils';
import { parseYaml } from './yaml';

/* ───────── 최소 타입 (TS DOM 기본 타입에 없는 API) ───────── */

type PermissionMode = { mode: 'read' | 'readwrite' };
export interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  queryPermission(o: PermissionMode): Promise<PermissionState>;
  requestPermission(o: PermissionMode): Promise<PermissionState>;
}
export interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandle> };

export const obsidianSupported = () => typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function' && 'indexedDB' in window;

/* ───────── 폴더 핸들 보관 (IndexedDB) ───────── */

const DB = 'ai-wiki-obsidian';
const STORE = 'handles';
const KEY = 'vault';

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

export const loadSavedFolder = () => idb<DirHandle | undefined>('readonly', (s) => s.get(KEY)).catch(() => undefined);
const saveFolder = (h: DirHandle) => idb('readwrite', (s) => s.put(h, KEY));
export const forgetFolder = () => idb('readwrite', (s) => s.delete(KEY)).catch(() => undefined);

/** 폴더 선택 창 — 사용자 클릭에서 호출. 취소하면 null */
export async function chooseFolder(): Promise<DirHandle | null> {
  try {
    const h = await (window as PickerWindow).showDirectoryPicker!({ id: 'ai-wiki-vault', mode: 'readwrite' });
    await saveFolder(h).catch(() => undefined); // 보관 실패해도 이번 세션에서는 사용 가능
    return h;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** 현재 권한 확인, ask=true면 (사용자 클릭에서) 권한 요청 */
export async function ensurePermission(h: DirHandle, ask: boolean): Promise<boolean> {
  const o: PermissionMode = { mode: 'readwrite' };
  if ((await h.queryPermission(o)) === 'granted') return true;
  return ask ? (await h.requestPermission(o)) === 'granted' : false;
}

/* ───────── 경로 ───────── */

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
const MAX_FILES = 3000;

export interface VaultNote {
  path: string; // 선택 폴더 기준 상대 경로 (예: 'AI WIKI/제목.md')
  handle: FileHandle;
  lastModified: number;
  aiWikiId?: string;
}

/** 선택 폴더 아래의 .md 파일 (숨김·설정 폴더 제외). subdir가 있으면 그 아래만 */
export async function scanNotes(root: DirHandle, subdir = ''): Promise<VaultNote[]> {
  const out: VaultNote[] = [];
  let start: DirHandle;
  try {
    start = subdir ? await resolveDir(root, subdir, false) : root;
  } catch {
    return out; // 하위 폴더가 아직 없음
  }
  async function walk(dir: DirHandle, prefix: string) {
    for await (const entry of dir.values()) {
      if (out.length >= MAX_FILES) return;
      if (entry.kind === 'directory') {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(entry, `${prefix}${entry.name}/`);
      } else if (/\.(md|markdown)$/i.test(entry.name)) {
        const f = await entry.getFile();
        out.push({ path: `${prefix}${entry.name}`, handle: entry, lastModified: f.lastModified, aiWikiId: readId(await f.slice(0, 4096).text()) });
      }
    }
  }
  await walk(start, subdir ? `${subdir.replace(/\/+$/, '')}/` : '');
  return out.sort((a, b) => b.lastModified - a.lastModified);
}

function readId(head: string): string | undefined {
  const m = head.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const id = parseYaml(m[1]).ai_wiki_id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

async function resolveDir(root: DirHandle, path: string, create: boolean): Promise<DirHandle> {
  let d = root;
  for (const seg of path.split('/').map((s) => s.trim()).filter(Boolean)) d = await d.getDirectoryHandle(seg, { create });
  return d;
}

async function fileAt(root: DirHandle, path: string): Promise<FileHandle | null> {
  const parts = path.split('/');
  const name = parts.pop()!;
  try {
    return await (await resolveDir(root, parts.join('/'), false)).getFileHandle(name);
  } catch {
    return null;
  }
}

/** 하위 폴더 이름 정리 — 상위 이동(..)이나 절대 경로 없이 선택 폴더 안으로만 */
export const cleanSubdir = (s: string) =>
  s
    .split(/[\\/]+/)
    .map((x) => x.trim().replace(/[:*?"<>|]/g, '_'))
    .filter((x) => x && x !== '.' && x !== '..')
    .join('/');

/* ───────── 저장 ───────── */

export interface SaveResult {
  saved: { id: string; path: string }[];
  skippedModified: { title: string; path: string }[]; // Obsidian에서 수정되어 덮어쓰지 않음
  failed: { title: string; message: string }[];
}

/**
 * 자료를 Markdown으로 저장.
 * 같은 자료(ai_wiki_id)의 노트가 있으면 그 파일을 갱신하고 새로 만들지 않는다.
 * AI WIKI가 만들지 않은 같은 이름의 노트는 덮어쓰지 않고 ' (AI WIKI)'를 붙인 새 파일로 저장한다.
 * 마지막 저장 이후 Obsidian에서 수정된 파일은 overwriteModified가 아니면 건너뛴다.
 */
export async function saveNotes(root: DirHandle, subdir: string, materials: Material[], overwriteModified: boolean, onProgress?: (i: number) => void): Promise<SaveResult> {
  const res: SaveResult = { saved: [], skippedModified: [], failed: [] };
  const dir = await resolveDir(root, subdir, true);
  const index = new Map<string, VaultNote>(); // ai_wiki_id → 노트 (선택 폴더 전체에서 찾음 — 사용자가 노트를 옮겨도 갱신)
  const taken = new Set<string>();
  for (const n of await scanNotes(root)) {
    taken.add(n.path.toLowerCase());
    if (n.aiWikiId && !index.has(n.aiWikiId)) index.set(n.aiWikiId, n);
  }
  const prefix = subdir ? `${subdir}/` : '';

  for (const [i, m] of materials.entries()) {
    onProgress?.(i);
    try {
      let target: { path: string; handle: FileHandle } | null = null;
      const known = m.external?.obsidianPath ? await fileAt(root, m.external.obsidianPath) : null;
      const knownId = known ? readId(await (await known.getFile()).slice(0, 4096).text()) : undefined;
      if (known && knownId === m.id) target = { path: m.external!.obsidianPath!, handle: known };
      else if (index.has(m.id)) target = index.get(m.id)!;

      const md = materialToMarkdown(m);
      if (target) {
        const file = await target.handle.getFile();
        const synced = m.external?.obsidianSyncedAt ? Date.parse(m.external.obsidianSyncedAt) : 0;
        const editedInObsidian = file.lastModified > synced + 2000 && (await file.text()) !== md;
        if (editedInObsidian && !overwriteModified) {
          res.skippedModified.push({ title: m.title, path: target.path });
          continue;
        }
      } else {
        const base = safeFileName(m.title);
        let name = `${base}.md`;
        if (taken.has(`${prefix}${name}`.toLowerCase())) name = `${base} (AI WIKI).md`;
        for (let n = 2; taken.has(`${prefix}${name}`.toLowerCase()); n++) name = `${base} (AI WIKI ${n}).md`;
        target = { path: `${prefix}${name}`, handle: await dir.getFileHandle(name, { create: true }) };
        taken.add(target.path.toLowerCase());
      }
      const w = await target.handle.createWritable();
      await w.write(md);
      await w.close();
      res.saved.push({ id: m.id, path: target.path });
    } catch (e) {
      res.failed.push({ title: m.title, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
