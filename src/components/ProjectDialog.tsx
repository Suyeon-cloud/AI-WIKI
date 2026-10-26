import { createContext, useContext, useState } from 'react';
import type { PageKey, Project } from '../types';
import { useStore } from '../store';
import { newProject } from '../lib/projects';
import { createProjectFolders, driveReady, obsidianReady } from '../lib/sync';
import { Modal } from './ui';

/** 어느 화면에서든 페이지 이동 · 새 프로젝트 창을 열 수 있게 */
export const NavContext = createContext<{ go: (p: PageKey) => void; newProject: () => void; editProject: (p: Project) => void }>({
  go: () => undefined,
  newProject: () => undefined,
  editProject: () => undefined,
});
export const useNav = () => useContext(NavContext);

type Form = Pick<Project, 'name' | 'topic' | 'overview' | 'defaultView' | 'degree' | 'department' | 'departmentEn' | 'advisor' | 'student' | 'studentEn' | 'status'> & {
  keywords: string;
};

const toForm = (p?: Project): Form => ({
  name: p?.name ?? '',
  topic: p?.topic ?? '',
  keywords: p?.keywords.join(', ') ?? '',
  overview: p?.overview ?? '',
  defaultView: p?.defaultView ?? '',
  degree: p?.degree ?? '석사',
  department: p?.department ?? '',
  departmentEn: p?.departmentEn ?? '',
  advisor: p?.advisor ?? '',
  student: p?.student ?? '',
  studentEn: p?.studentEn ?? '',
  status: p?.status ?? '진행 중',
});

/** 새 프로젝트 만들기 / 프로젝트 정보 수정 */
export function ProjectDialog({ edit, onClose }: { edit?: Project; onClose: () => void }) {
  const { state, dispatch, toast } = useStore();
  const [f, setF] = useState<Form>(() => toForm(edit));
  const [makeFolders, setMakeFolders] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));
  const canFolders = driveReady() || obsidianReady();

  async function submit() {
    const name = f.name.trim();
    if (!name) return toast('프로젝트 이름을 입력하세요.', 'error');
    if (state.projects.some((p) => p.name === name && p.id !== edit?.id)) return toast('같은 이름의 프로젝트가 있습니다.', 'error');
    const data = {
      ...f,
      name,
      topic: f.topic.trim() || name,
      keywords: f.keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean),
    };
    if (edit) {
      dispatch({ type: 'updateProject', id: edit.id, patch: data });
      dispatch({ type: 'log', event: { projectId: edit.id, kind: '수정', text: '프로젝트 정보를 수정했습니다.' } });
      toast('프로젝트 정보를 저장했습니다.');
      onClose();
      return;
    }
    const p = newProject(data);
    dispatch({ type: 'createProject', project: p });
    if (makeFolders && canFolders) {
      setBusy(true);
      try {
        const r = await createProjectFolders(p);
        if (Object.keys(r.patch).length) dispatch({ type: 'updateProject', id: p.id, patch: r.patch });
        if (r.done.length) dispatch({ type: 'log', event: { projectId: p.id, kind: '연동', text: `폴더 생성 — ${r.done.join(' / ')}` } });
        r.errors.forEach((e) => toast(e, 'error'));
        toast(`프로젝트를 만들었습니다.${r.done.length ? ` 폴더: ${r.done.join(', ')}` : ''}`);
      } finally {
        setBusy(false);
      }
    } else {
      toast('프로젝트를 만들었습니다. Obsidian·Drive 폴더는 연결 후 대시보드에서 만들 수 있습니다.');
    }
    onClose();
  }

  return (
    <Modal
      title={edit ? '프로젝트 정보 수정' : '새 연구 프로젝트'}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>취소</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? '폴더 만드는 중…' : edit ? '저장' : '프로젝트 만들기'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="span-2">
          프로젝트(폴더) 이름 <b className="req">*</b>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 석사논문 - AI 모션그래픽 한중문화콘텐츠" autoFocus />
        </label>
        <label className="span-2">
          논문 주제
          <input value={f.topic} onChange={(e) => set('topic', e.target.value)} placeholder="비우면 프로젝트 이름 사용" />
        </label>
        <label className="span-2">
          핵심 키워드 (쉼표로 구분 · AI 분석에 사용)
          <input value={f.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="AI 모션그래픽, 한중문화콘텐츠, 중국 드라마" />
        </label>
        <label className="span-2">
          연구 개요
          <textarea rows={3} value={f.overview} onChange={(e) => set('overview', e.target.value)} placeholder="연구 목적과 범위를 2~3문장으로" />
        </label>
        <label className="span-2">
          나의 기본 관점
          <textarea rows={2} value={f.defaultView} onChange={(e) => set('defaultView', e.target.value)} placeholder="자료를 볼 때 주목하는 관점 (AI 분석·집필이 참고)" />
        </label>
      </div>
      <h4 className="sub-title">학위논문 정보 <span className="muted small">— AI 집필 표지·심사청구서에 들어갑니다 (나중에 입력 가능)</span></h4>
      <div className="form-grid">
        <label>
          학위
          <select value={f.degree} onChange={(e) => set('degree', e.target.value)}>
            <option>석사</option>
            <option>박사</option>
          </select>
        </label>
        <label>
          지도교수
          <input value={f.advisor} onChange={(e) => set('advisor', e.target.value)} placeholder="예: 김OO" />
        </label>
        <label>
          학과
          <input value={f.department} onChange={(e) => set('department', e.target.value)} placeholder="예: 중국어문학과" />
        </label>
        <label>
          학과 (영문)
          <input value={f.departmentEn} onChange={(e) => set('departmentEn', e.target.value)} placeholder="Chinese Language and Literature" />
        </label>
        <label>
          성명
          <input value={f.student} onChange={(e) => set('student', e.target.value)} />
        </label>
        <label>
          성명 (영문)
          <input value={f.studentEn} onChange={(e) => set('studentEn', e.target.value)} placeholder="Gil-Dong Hong" />
        </label>
      </div>
      {!edit && (
        <div className="notice">
          <label className="radio">
            <input type="checkbox" checked={makeFolders && canFolders} disabled={!canFolders} onChange={(e) => setMakeFolders(e.target.checked)} />
            Obsidian · Google Drive에 같은 이름의 프로젝트 폴더 만들기 (<code>프로젝트/자료</code>, <code>프로젝트/AI 생성</code>)
          </label>
          <div className="muted small" style={{ marginTop: 4 }}>
            현재 연결: Obsidian {obsidianReady() ? '✔' : '✕'} · Google Drive {driveReady() ? '✔' : '✕'}
            {!canFolders && ' — 연구 설정에서 연결하면 대시보드에서 언제든 폴더를 만들 수 있습니다.'}
          </div>
        </div>
      )}
    </Modal>
  );
}
