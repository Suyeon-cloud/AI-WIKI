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
import { emptyThesis } from './lib/projects';
import { bibStatusOf } from './lib/citation';
import { browserStorage, loadState, saveState } from './lib/persist';

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
  /** 마지막 localStorage 저장 실패 사유 (정상 저장 시 null) */
  storageError: string | null;
  /** 손상된 저장 데이터를 보호하기 위해 자동 저장이 중지된 상태 */
  saveBlocked: boolean;
  /** 사용자가 현재 상태로 저장을 재개 (읽지 못한 원본을 덮어씀) */
  resumeSave: () => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(() => loadState(browserStorage(), initial));
  const [state, rawDispatch] = useReducer(reducer, boot.state);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [saveBlocked, setSaveBlocked] = useState(boot.blockSave);
  const errRef = useRef<string | null>(null);
  const noticed = useRef(false);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = uid();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);

  // 백업 복원·초기화는 저장 데이터를 새로 정하는 동작이므로 자동 저장 중지를 해제한다.
  const dispatch = useCallback((a: Action) => {
    if (a.type === 'restore' || a.type === 'reset') setSaveBlocked(false);
    rawDispatch(a);
  }, []);
  const resumeSave = useCallback(() => setSaveBlocked(false), []);

  useEffect(() => {
    if (noticed.current) return;
    noticed.current = true;
    boot.notices.forEach((n) => toast(n.text, n.kind));
  }, [boot, toast]);

  useEffect(() => {
    if (saveBlocked) return; // 읽지 못한 원본을 덮어쓰지 않음
    const r = saveState(browserStorage(), state);
    if (r.ok) {
      errRef.current = null;
      setStorageError(null);
    } else {
      if (!errRef.current) toast(`${r.reason}: 변경 내용이 저장되지 않았습니다. 연구 설정 화면에서 전체 백업 파일을 받아 두세요.`, 'error');
      errRef.current = r.reason;
      setStorageError(r.reason);
    }
  }, [state, saveBlocked, toast]);

  return <StoreContext.Provider value={{ state, dispatch, toast, toasts, storageError, saveBlocked, resumeSave }}>{children}</StoreContext.Provider>;
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
