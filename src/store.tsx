import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  type AiOutput,
  type AppState,
  type ExternalLinks,
  type Material,
  type Project,
  type ProjectEvent,
  type ResearchSettings,
  type ThesisDraft,
  type WritingState,
} from './types';
import { DEFAULT_SETTINGS, DEFAULT_WRITING } from './data/sample';
import { uid } from './lib/utils';
import { deriveViewStatus } from './lib/data';
import { CloudState } from './lib/cloud-state';
import { cloudRepository } from './lib/cloud-repository';
import { authUser, signOut } from './lib/auth';
import { buildBackup } from './lib/data';
import { downloadFile } from './lib/utils';
import { saveRecovery, clearRecovery, loadRecovery, recoveryKey, loadRecoveryAcks, saveRecoveryAcks, visibleRecovery, nextRecoveryAcks, type RecoveryAck, type RecoveryCopy } from './lib/idb-store';
import { emptyThesis } from './lib/projects';
import { bibStatusOf } from './lib/citation';


type Action =
  | { type: 'add'; material: Material }
  | { type: 'addMany'; materials: Material[] }
  | { type: 'update'; id: string; patch: Partial<Material> }
  | { type: 'remove'; id: string }
  | { type: 'removeMany'; ids: string[] }
  | { type: 'select'; id: string | null }
  | { type: 'settings'; settings: ResearchSettings }
  | { type: 'writing'; patch: Partial<WritingState> }
  | { type: 'importApply'; add: Material[]; update: Material[] }
  | { type: 'restore'; state: AppState }
  /** 외부 연결 정보(Drive 파일 ID 등)만 기록 — 자료 수정일은 바꾸지 않음 */
  | { type: 'setExternal'; updates: { id: string; external: ExternalLinks }[] }
  | { type: 'reset' }
  // ── 프로젝트 ──
  | { type: 'createProject'; project: Project }
  | { type: 'updateProject'; id: string; patch: Partial<Project> }
  | { type: 'removeProject'; id: string }
  | { type: 'selectProject'; id: string }
  | { type: 'moveMaterials'; ids: string[]; projectId: string | undefined }
  | { type: 'log'; event: Omit<ProjectEvent, 'id' | 'at'> }
  // ── AI 산출물 · 학위논문 ──
  | { type: 'addOutput'; output: AiOutput }
  | { type: 'updateOutput'; id: string; patch: Partial<AiOutput> }
  | { type: 'removeOutput'; id: string }
  | { type: 'thesis'; projectId: string; patch: Partial<ThesisDraft> };

/** 처음 실행: 샘플 없이 빈 상태로 시작한다 (대문에서 첫 프로젝트를 만든다) */
const initial = (): AppState => ({
  materials: [],
  settings: DEFAULT_SETTINGS,
  writing: DEFAULT_WRITING,
  selectedId: null,
  projects: [],
  currentProjectId: null,
  events: [],
  aiOutputs: [],
  theses: [],
});

const now = () => new Date().toISOString();
const MAX_EVENTS = 500;

function withEvent(state: AppState, e: Omit<ProjectEvent, 'id' | 'at'>): AppState {
  return { ...state, events: [{ ...e, id: uid(), at: now() }, ...state.events].slice(0, MAX_EVENTS) };
}

function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'add':
      return { ...state, materials: [a.material, ...state.materials], selectedId: a.material.id };
    case 'addMany':
      return { ...state, materials: [...a.materials, ...state.materials] };
    case 'update':
      return {
        ...state,
        materials: state.materials.map((m) => {
          if (m.id !== a.id) return m;
          const next = { ...m, ...a.patch, updatedAt: now() };
          // 관점 내용이 바뀌면 상태를 다시 판단 (내용이 비면 '미작성', 수정하면 '작성 중')
          const status = a.patch.viewStatus ?? (a.patch.myView !== undefined && a.patch.myView !== m.myView ? '작성 중' : next.viewStatus);
          const withView = { ...next, viewStatus: deriveViewStatus(next.myView, status) };
          // 서지정보·제목·URL이 바뀌면 참고문헌 완성 여부를 다시 판단
          return { ...withView, bibStatus: bibStatusOf(withView) };
        }),
      };
    case 'remove':
      return {
        ...state,
        materials: state.materials.filter((m) => m.id !== a.id),
        selectedId: state.selectedId === a.id ? null : state.selectedId,
      };
    case 'removeMany': {
      const ids = new Set(a.ids);
      return { ...state, materials: state.materials.filter((m) => !ids.has(m.id)), selectedId: state.selectedId && ids.has(state.selectedId) ? null : state.selectedId };
    }
    case 'select':
      return { ...state, selectedId: a.id };
    case 'settings':
      return { ...state, settings: a.settings };
    case 'writing':
      return { ...state, writing: { ...state.writing, ...a.patch } };
    case 'importApply': {
      const upd = new Map(a.update.map((m) => [m.id, m]));
      const ids = new Set(state.materials.map((m) => m.id));
      // 가져온 새 자료는 지금 보고 있는 프로젝트 폴더에 넣는다
      const add = a.add.filter((m) => !ids.has(m.id)).map((m) => ({ ...m, projectId: m.projectId ?? state.currentProjectId ?? undefined }));
      return { ...state, materials: [...add, ...state.materials.map((m) => upd.get(m.id) ?? m)] };
    }
    case 'setExternal': {
      const map = new Map(a.updates.map((u) => [u.id, u.external]));
      return { ...state, materials: state.materials.map((m) => (map.has(m.id) ? { ...m, external: { ...m.external, ...map.get(m.id) } } : m)) };
    }
    case 'restore':
      return a.state;
    case 'reset':
      return initial();

    case 'createProject':
      return withEvent(
        { ...state, projects: [a.project, ...state.projects], currentProjectId: a.project.id, theses: [...state.theses, emptyThesis(a.project)] },
        { projectId: a.project.id, kind: '생성', text: `프로젝트 '${a.project.name}'을(를) 만들었습니다.` },
      );
    case 'updateProject':
      return { ...state, projects: state.projects.map((p) => (p.id === a.id ? { ...p, ...a.patch, updatedAt: now() } : p)) };
    case 'removeProject': {
      // AI WIKI 안의 프로젝트 전용 데이터만 지운다 (Obsidian·Drive의 실제 파일·폴더는 건드리지 않음)
      const projects = state.projects.filter((p) => p.id !== a.id);
      const materials = state.materials.filter((m) => m.projectId !== a.id);
      return {
        ...state,
        projects,
        currentProjectId: state.currentProjectId === a.id ? (projects[0]?.id ?? null) : state.currentProjectId,
        materials,
        selectedId: materials.some((m) => m.id === state.selectedId) ? state.selectedId : null,
        aiOutputs: state.aiOutputs.filter((o) => o.projectId !== a.id),
        theses: state.theses.filter((t) => t.projectId !== a.id),
        events: state.events.filter((e) => e.projectId !== a.id),
      };
    }
    case 'selectProject':
      return { ...state, currentProjectId: a.id, selectedId: state.materials.find((m) => m.id === state.selectedId)?.projectId === a.id ? state.selectedId : null };
    case 'moveMaterials': {
      const ids = new Set(a.ids);
      return { ...state, materials: state.materials.map((m) => (ids.has(m.id) ? { ...m, projectId: a.projectId, updatedAt: now() } : m)) };
    }
    case 'log':
      return withEvent(state, a.event);

    case 'addOutput':
      return { ...state, aiOutputs: [a.output, ...state.aiOutputs] };
    case 'updateOutput':
      return { ...state, aiOutputs: state.aiOutputs.map((o) => (o.id === a.id ? { ...o, ...a.patch } : o)) };
    case 'removeOutput':
      return { ...state, aiOutputs: state.aiOutputs.filter((o) => o.id !== a.id) };
    case 'thesis': {
      const exists = state.theses.some((t) => t.projectId === a.projectId);
      const p = state.projects.find((x) => x.id === a.projectId);
      const base = exists ? state.theses : p ? [...state.theses, emptyThesis(p)] : state.theses;
      return { ...state, theses: base.map((t) => (t.projectId === a.projectId ? { ...t, ...a.patch, updatedAt: now() } : t)) };
    }
  }
}

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface Ctx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  toast: (text: string, kind?: Toast['kind']) => void;
  toasts: Toast[];
  /** 마지막 브라우저 저장(IndexedDB 또는 localStorage) 실패 사유 (정상 저장 시 null) */
  storageError: string | null;
  pendingSave: boolean;
  /** 손상된 저장 데이터를 보호하기 위해 자동 저장이 중지된 상태 */
  saveBlocked: boolean;
  /** 사용자가 현재 상태로 저장을 재개 (읽지 못한 원본을 덮어씀) */
  resumeSave: () => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const [loaded, setLoaded] = useState<{ engine: CloudState; state: AppState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recovery, setRecovery] = useState<{ all: RecoveryCopy[]; visible: RecoveryCopy[]; acks: RecoveryAck[] }>({ all: [], visible: [], acks: [] });
  const [continueAfterRecovery, setContinueAfterRecovery] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setError(null);
    setAckError(null);
    const engine = new CloudState(cloudRepository, userId, () => alive && authUser()?.id === userId);
    // 확인 기록을 읽지 못하면 기록이 없는 것으로 보고 모든 사본을 안내한다.
    void Promise.all([engine.load(), loadRecovery(userId).catch(() => []), loadRecoveryAcks(userId).catch(() => [])]).then(([state, copies, acks]) => {
      if (alive) { setRecovery({ all: copies, visible: visibleRecovery(copies, acks), acks }); setLoaded({ engine, state: state ?? initial() }); }
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [userId, attempt]);
  if (error) return <div className="login-screen"><div className="login-card">
    <h1>자료를 불러오지 못했어요</h1><p role="alert">{error}</p>
    <p>서버 원본은 변경하지 않았습니다.</p>
    <button className="btn" onClick={() => setAttempt((x) => x + 1)}>다시 불러오기</button>
    <button className="btn" onClick={() => { void signOut().catch(() => setError('로그아웃하지 못했습니다. 다시 시도해 주세요.')); }}>로그아웃</button>
  </div></div>;
  if (!loaded) return <div className="boot-loading">내 계정의 자료를 불러오는 중…</div>;
  const acknowledge = () => {
    setAckError(null);
    saveRecoveryAcks(userId, nextRecoveryAcks(recovery.acks, recovery.visible, recovery.all)).then(
      () => setContinueAfterRecovery(true),
      () => setAckError('확인 기록을 저장하지 못했습니다. 사본은 그대로 있고, 다음에 다시 안내됩니다. "서버 자료로 계속하기"로 이번에는 넘어갈 수 있습니다.'),
    );
  };
  if (recovery.visible.length && !continueAfterRecovery) return <div className="login-screen"><div className="login-card">
    <h1>저장되지 않은 내용이 있어요</h1><p>이 계정으로 작업하다 서버에 저장하지 못한 사본입니다. 먼저 다운로드해 보관해 주세요. 사본은 자동으로 서버에 올리지 않습니다.</p>
    {recovery.visible.map((copy, i) => <p key={copy.key}><button className="btn" onClick={() => downloadFile(`ai-wiki-recovery-${i + 1}.json`, JSON.stringify(buildBackup(copy.state), null, 2), 'application/json')}>{copy.savedAt} 사본 다운로드</button></p>)}
    <button className="btn btn-primary" onClick={() => setContinueAfterRecovery(true)}>서버 자료로 계속하기</button>
    <button className="btn" onClick={acknowledge}>확인했어요, 다시 표시하지 않기</button>
    <p className="muted small">다시 표시하지 않아도 사본은 이 브라우저에 그대로 남습니다. 새로 생기거나 다시 저장된 사본은 다시 안내합니다.</p>
    {ackError && <p role="alert">{ackError}</p>}
  </div></div>;
  return <CloudStore engine={loaded.engine} boot={loaded.state}>{children}</CloudStore>;
}

function CloudStore({ children, engine, boot }: { children: ReactNode; engine: CloudState; boot: AppState }) {
  const [state, rawDispatch] = useReducer(reducer, boot);
  const [edits, setEdits] = useState(0);
  const [saved, setSaved] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const failed = useRef(false);
  const mounted = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [draftKey] = useState(() => recoveryKey(authUser()!.id, uid()));
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!edits) return;
    draftQueue.current = draftQueue.current.catch(() => undefined).then(() => saveRecovery({ key: draftKey, state, version: edits, savedAt: new Date().toISOString() }));
    void draftQueue.current.catch(() => undefined);
  }, [state, edits, draftKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = uid();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => { if (mounted.current) setToasts((t) => t.filter((x) => x.id !== id)); }, kind === 'error' ? 6000 : 3200);
  }, []);
  const dispatch = useCallback((a: Action) => {
    rawDispatch(a);
    setEdits((x) => x + 1);
  }, []);
  const resumeSave = useCallback(() => {
    failed.current = false;
    setStorageError(null);
    setRetry((x) => x + 1);
  }, []);
  const pendingSave = edits > saved;
  useEffect(() => {
    if (!pendingSave) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingSave]);
  useEffect(() => {
    if (!edits) return;
    const timer = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (!mounted.current || failed.current) return;
        try {
          await engine.save(state);
          await draftQueue.current.catch(() => undefined);
          await clearRecovery(draftKey, edits).catch(() => undefined);
          if (mounted.current) {
            setSaved((x) => Math.max(x, edits));
            setSavedAt(new Date().toLocaleTimeString('ko-KR'));
          }
        } catch (e) {
          failed.current = true;
          if (mounted.current) setStorageError(e instanceof Error ? e.message : '저장하지 못했습니다.');
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [engine, state, edits, retry, draftKey]);
  const backup = () => downloadFile(`ai-wiki-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildBackup(state), null, 2), 'application/json');
  return <StoreContext.Provider value={{ state, dispatch, toast, toasts, storageError, pendingSave, saveBlocked: !!storageError, resumeSave }}>
    <div className={`cloud-save-banner ${storageError ? 'cloud-save-error' : pendingSave ? 'cloud-save-pending' : 'cloud-save-done'}`} role={storageError ? 'alert' : 'status'}>
      {storageError ? <>
        <b>저장 실패: 최근 변경 내용은 서버에 저장되지 않았습니다.</b> {storageError}
        <br />변경 내용은 이 브라우저의 복구 사본에 남아 있으며 자동으로 지우지 않습니다. 새로고침하거나 창을 닫기 전에 "현재 내용 백업"을 받아 두세요.
        <br /><button className="btn btn-sm" onClick={backup}>현재 내용 백업</button> <button className="btn btn-sm" onClick={resumeSave}>저장 다시 시도</button>
      </> : pendingSave ? <><b>저장 중…</b> 완료 표시 전에 새로고침하거나 창을 닫으면 이번 변경은 서버에 저장되지 않습니다.</>
        : <><b>저장 완료</b> 내 계정의 Supabase에 저장됨{engine.mode === 'split' && ' (변경분 저장)'}{savedAt && ` · ${savedAt}`}</>}
    </div>
    {children}
  </StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('StoreProvider missing');
  return ctx;
}

/** 현재 프로젝트와 그 폴더의 자료·산출물 */
export function useProject() {
  const { state } = useStore();
  const project = state.projects.find((p) => p.id === state.currentProjectId) ?? null;
  const materials = project ? state.materials.filter((m) => m.projectId === project.id) : [];
  const outputs = project ? state.aiOutputs.filter((o) => o.projectId === project.id) : [];
  const thesis = project ? (state.theses.find((t) => t.projectId === project.id) ?? emptyThesis(project)) : null;
  return { project, materials, outputs, thesis };
}

export function newMaterial(partial: Partial<Material> & Pick<Material, 'title' | 'sourceType'>): Material {
  const t = now();
  return {
    id: uid(),
    origin: '원본 자료',
    topic: '',
    keywords: [],
    relevance: 3,
    para: 'Resources',
    createdAt: t,
    updatedAt: t,
    viewStatus: partial.myView?.trim() ? '작성 중' : '미작성',
    bibStatus: '서지정보 확인 필요',
    citationIncluded: false,
    ...partial,
  };
}
