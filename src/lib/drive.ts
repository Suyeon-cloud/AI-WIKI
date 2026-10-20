/**
 * Google Drive 연결 (브라우저 전용, 백엔드 없음)
 * - 인증: Google Identity Services 토큰 모델 (OAuth 2.0 암시적 토큰, client secret 불필요)
 * - 권한: drive.file — 이 앱이 만든 파일과 사용자가 Picker로 직접 고른 파일만 접근
 * - API: Drive REST v3를 fetch로 호출
 * 접근 토큰은 메모리에만 두고 localStorage·백업 파일에 저장하지 않는다.
 * localStorage에는 폴더 ID만 저장한다 (토큰이 아니며 다시 찾을 수 있는 값).
 */

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
const API_KEY = (import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim();
const APP_ID = (import.meta.env.VITE_GOOGLE_APP_ID ?? '').trim();

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_ROOT_NAME = 'AI WIKI';
export const DRIVE_NOTES_NAME = 'notes';
const FOLDER_KEY = 'ai-wiki:drive-folders';

/** 연결에 필요한 값이 .env에 있는지 */
export const driveConfigured = () => !!CLIENT_ID;
/** Picker(내 Drive의 기존 파일 선택)에는 API 키와 앱 ID(프로젝트 번호)가 추가로 필요 */
export const pickerConfigured = () => !!CLIENT_ID && !!API_KEY && !!APP_ID;

/* ───────── 최소 타입 선언 (Google 스크립트는 런타임에 로드) ───────── */

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
interface PickerDoc {
  id: string;
  name: string;
  mimeType?: string;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 }; picker?: any };
    gapi?: { load(name: string, cb: () => void): void };
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src))
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          scripts.delete(src);
          reject(new DriveError('Google 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.', 'network'));
        };
        document.head.appendChild(s);
      }),
    );
  return scripts.get(src)!;
}

/* ───────── 상태 ───────── */

export type DriveStatus = 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'expired';

export class DriveError extends Error {
  constructor(message: string, public kind: 'auth' | 'denied' | 'cancelled' | 'network' | 'notfound' | 'api' = 'api') {
    super(message);
  }
}

let token: { value: string; expiresAt: number } | null = null;
let status: DriveStatus = driveConfigured() ? 'disconnected' : 'unconfigured';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function setStatus(s: DriveStatus) {
  status = s;
  emit();
}

export function subscribeDrive(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function driveState() {
  if (status === 'connected' && token && Date.now() > token.expiresAt) {
    token = null;
    status = 'expired';
  }
  return { status, expiresAt: token?.expiresAt ?? null };
}

let tokenClient: TokenClient | null = null;

/** Google 계정 연결 — 반드시 버튼 클릭 등 사용자 동작에서 호출 (팝업 차단 방지) */
export async function connectDrive(): Promise<void> {
  if (!driveConfigured()) throw new DriveError('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.', 'auth');
  const prev = status;
  setStatus('connecting');
  try {
    await loadScript('https://accounts.google.com/gsi/client');
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new DriveError('Google 인증 스크립트를 초기화하지 못했습니다.', 'network');
    await new Promise<void>((resolve, reject) => {
      tokenClient = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) {
            reject(new DriveError(r.error === 'access_denied' ? 'Google Drive 접근 권한이 거부되었습니다.' : `인증 실패: ${r.error_description ?? r.error ?? '알 수 없는 오류'}`, 'denied'));
            return;
          }
          token = { value: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60_000 };
          resolve();
        },
        error_callback: (e) =>
          reject(
            new DriveError(
              e.type === 'popup_closed' ? '로그인 창이 닫혀 연결을 취소했습니다.' : e.type === 'popup_failed_to_open' ? '로그인 팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.' : `인증 오류: ${e.message ?? e.type}`,
              'cancelled',
            ),
          ),
      });
      tokenClient.requestAccessToken({ prompt: prev === 'expired' ? '' : 'consent' });
    });
    setStatus('connected');
  } catch (e) {
    setStatus(prev === 'connected' ? 'connected' : prev === 'expired' ? 'expired' : 'disconnected');
    throw e;
  }
}

/** 연결 해제 — Google에 토큰 폐기를 요청하고 메모리에서 지운다 */
export function disconnectDrive() {
  const t = token?.value;
  token = null;
  if (t) window.google?.accounts?.oauth2?.revoke(t);
  setStatus(driveConfigured() ? 'disconnected' : 'unconfigured');
}

function requireToken(): string {
  const s = driveState().status;
  if (s === 'expired') {
    emit();
    throw new DriveError('Google 인증이 만료되었습니다. 다시 연결하세요.', 'auth');
  }
  if (!token) throw new DriveError('Google Drive에 연결되어 있지 않습니다.', 'auth');
  return token.value;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const t = requireToken();
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  } catch {
    throw new DriveError('Google Drive에 연결할 수 없습니다. 인터넷 연결을 확인하세요.', 'network');
  }
  if (res.ok) return res;
  let msg = `${res.status}`;
  try {
    msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
  } catch {
    /* 본문 없음 */
  }
  if (res.status === 401) {
    token = null;
    setStatus('expired');
    throw new DriveError('Google 인증이 만료되었습니다. 다시 연결하세요.', 'auth');
  }
  if (res.status === 403) throw new DriveError(`Drive 접근이 거부되었습니다: ${msg}`, 'denied');
  if (res.status === 404) throw new DriveError('Drive에서 파일을 찾을 수 없습니다.', 'notfound');
  throw new DriveError(`Drive 요청 실패: ${msg}`, 'api');
}

/* ───────── 폴더 ───────── */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFolder(name: string, parent?: string): Promise<string | null> {
  const q = [`mimeType='${FOLDER_MIME}'`, `name='${esc(name)}'`, 'trashed=false', parent ? `'${parent}' in parents` : null].filter(Boolean).join(' and ');
  const res = await call(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive', pageSize: '1' })}`);
  return ((await res.json()) as { files: { id: string }[] }).files[0]?.id ?? null;
}

async function createFolder(name: string, parent?: string): Promise<string> {
  const res = await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function folderAlive(id: string): Promise<boolean> {
  try {
    const res = await call(`${API}/files/${id}?fields=id,trashed`);
    return !((await res.json()) as { trashed?: boolean }).trashed;
  } catch (e) {
    if (e instanceof DriveError && e.kind === 'notfound') return false;
    throw e;
  }
}

/** 내 Drive의 'AI WIKI' 폴더와 그 안의 'notes' 폴더 (없으면 만든다) */
export async function ensureFolders(): Promise<{ root: string; notes: string }> {
  let saved: { root?: string; notes?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(FOLDER_KEY) ?? '{}');
  } catch {
    /* 무시 */
  }
  const root = saved.root && (await folderAlive(saved.root)) ? saved.root : (await findFolder(DRIVE_ROOT_NAME)) ?? (await createFolder(DRIVE_ROOT_NAME));
  const notes =
    saved.notes && saved.root === root && (await folderAlive(saved.notes))
      ? saved.notes
      : (await findFolder(DRIVE_NOTES_NAME, root)) ?? (await createFolder(DRIVE_NOTES_NAME, root));
  try {
    localStorage.setItem(FOLDER_KEY, JSON.stringify({ root, notes }));
  } catch {
    /* 저장 실패해도 다음에 다시 찾음 */
  }
  return { root, notes };
}

/* ───────── 파일 ───────── */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

/** 새 파일 만들기 (multipart 업로드) */
export async function createFile(name: string, content: string, mime: string, parent: string): Promise<DriveFile> {
  const boundary = `aiwiki${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: mime, parents: [parent] })}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as DriveFile;
}

/** 기존 파일 내용·이름 갱신 (같은 Drive 파일 ID 유지) */
export async function updateFile(id: string, name: string, content: string, mime: string): Promise<DriveFile> {
  const boundary = `aiwiki${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name })}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await call(`${UPLOAD}/files/${id}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size`, {
    method: 'PATCH',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as DriveFile;
}

export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`;
  const res = await call(
    `${API}/files?${new URLSearchParams({ q, orderBy: 'modifiedTime desc', pageSize: '200', fields: 'files(id,name,mimeType,modifiedTime,size)', spaces: 'drive' })}`,
  );
  return ((await res.json()) as { files: DriveFile[] }).files;
}

/** 파일 내용을 받아 브라우저 File로 만든다 — 기존 가져오기 흐름(미리보기·검증)을 그대로 사용하기 위해 */
export async function downloadAsFile(f: { id: string; name: string }): Promise<File> {
  const res = await call(`${API}/files/${f.id}?alt=media`);
  return new File([await res.text()], f.name);
}

/* ───────── Picker: 앱이 만들지 않은 Drive 파일 선택 ───────── */

export async function pickDriveFiles(): Promise<PickerDoc[]> {
  if (!pickerConfigured()) throw new DriveError('Picker 사용에는 VITE_GOOGLE_API_KEY와 VITE_GOOGLE_APP_ID가 필요합니다.', 'auth');
  const t = requireToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((r) => window.gapi!.load('picker', r));
  const p = window.google!.picker;
  return new Promise((resolve) => {
    const view = new p.DocsView(p.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    const picker = new p.PickerBuilder()
      .setOAuthToken(t)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .addView(view)
      .enableFeature(p.Feature.MULTISELECT_ENABLED)
      .setTitle('AI WIKI로 가져올 .md / .txt / .json 파일 선택')
      .setCallback((data: { action: string; docs?: PickerDoc[] }) => {
        if (data.action === p.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === p.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });
}
