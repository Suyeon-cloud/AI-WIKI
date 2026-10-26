import { useState } from 'react';
import type { Para } from '../types';
import { newMaterial, useStore, useProject } from '../store';
import { PARAS, extractYouTubeId, isValidUrl, ytThumb } from '../lib/utils';
import { driveConfigured } from '../lib/drive';
import { Card, NeedProject, PageHeader, StatusBadge } from '../components/ui';
import { KciImport } from '../components/KciImport';
import { DriveImportModal } from '../components/DriveImport';
import { ImportFlow } from '../components/ImportExport';
import { ObsidianSync } from '../components/ObsidianSync';
import { useConnections } from '../components/Sidebar';
import { useNav } from '../components/ProjectDialog';

type Tab = 'kci' | 'web' | 'youtube' | 'file';

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'kci', label: 'KCI 논문 PDF', desc: '초록·서지사항 자동 추출' },
  { key: 'web', label: '웹 자료', desc: 'URL과 제목으로 등록' },
  { key: 'youtube', label: 'YouTube', desc: '영상 링크 등록' },
  { key: 'file', label: 'Markdown · 파일', desc: '.md · .txt · 백업 JSON' },
];

const splitKeywords = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function CommonFields({ kw, setKw, para, setPara, rel, setRel }: { kw: string; setKw: (v: string) => void; para: Para; setPara: (v: Para) => void; rel: number; setRel: (v: number) => void }) {
  return (
    <div className="form-grid">
      <label className="span-2">
        키워드 (쉼표 구분)
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="예: 중국 드라마, 문화 요소" />
      </label>
      <label>
        PARA 분류
        <select value={para} onChange={(e) => setPara(e.target.value as Para)}>
          {PARAS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        논문 관련도
        <select value={rel} onChange={(e) => setRel(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {r}등급
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function Collect() {
  const { dispatch, toast } = useStore();
  const { project, materials } = useProject();
  const nav = useNav();
  const c = useConnections();
  const [tab, setTab] = useState<Tab>('kci');
  const [kw, setKw] = useState('');
  const [para, setPara] = useState<Para>('Resources');
  const [rel, setRel] = useState(3);
  const [webUrl, setWebUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [driveOpen, setDriveOpen] = useState(false);
  const ytId = extractYouTubeId(ytUrl);

  if (!project)
    return (
      <>
        <PageHeader title="자료 수집" desc="프로젝트 폴더에 연구자료를 모읍니다." />
        <NeedProject onCreate={nav.newProject} />
      </>
    );

  const common = { keywords: splitKeywords(kw), para, relevance: rel, projectId: project.id, importedFrom: '직접 입력' as const };
  const added = (title: string) => {
    dispatch({ type: 'log', event: { projectId: project.id, kind: '자료', text: `자료를 추가했습니다: ${title}` } });
    setKw('');
    setRel(3);
  };

  function registerWeb() {
    if (!isValidUrl(webUrl)) return toast('올바른 URL 형식이 아닙니다. http:// 또는 https://로 시작해야 합니다.', 'error');
    if (!webTitle.trim()) return toast('제목을 입력하세요.', 'error');
    dispatch({ type: 'add', material: newMaterial({ ...common, title: webTitle.trim(), sourceType: 'Web', url: webUrl.trim(), bib: { type: 'web', author: '', year: '', publisher: '', url: webUrl.trim(), accessed: new Date().toISOString().slice(0, 10) } }) });
    toast('웹 자료를 등록했습니다.');
    added(webTitle.trim());
    setWebUrl('');
    setWebTitle('');
  }

  function registerYt() {
    if (!ytId) return toast('YouTube URL에서 영상 ID를 찾을 수 없습니다.', 'error');
    const title = ytTitle.trim() || `YouTube 영상 (${ytId})`;
    dispatch({ type: 'add', material: newMaterial({ ...common, title, sourceType: 'YouTube', url: `https://www.youtube.com/watch?v=${ytId}`, youtubeId: ytId }) });
    toast('YouTube 자료를 등록했습니다.');
    added(title);
    setYtUrl('');
    setYtTitle('');
  }

  return (
    <>
      <PageHeader
        title="자료 수집"
        desc={`KCI 논문·웹·YouTube·파일에서 새 연구자료를 '${project.name}' 폴더에 모읍니다. Drive·Obsidian에 보관된 기존 자료는 아래 '연동 저장소에서 가져오기'를 이용하세요.`}
        badges={<span className="chip chip-strong">현재 폴더 자료 {materials.length}건</span>}
      />

      <div className="collect-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`collect-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <b>{t.label}</b>
            <span>{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === 'kci' && (
        <Card title="KCI 논문 PDF 가져오기" extra={<StatusBadge s="real">PDF 텍스트 추출</StatusBadge>}>
          <KciImport />
          <div className="notice">
            <b>순서</b> ① PDF 선택 → ② 제목·저자·학술지·권호·쪽·DOI·초록·주제어 자동 추출 → ③ <b>확인 창에서 가져올 논문을 직접 체크</b>하고 틀린 항목 수정 →
            ④ 라이브러리 추가 (서지사항은 참고문헌 목록에 바로 반영)
          </div>
        </Card>
      )}

      {tab === 'web' && (
        <Card title="웹 자료 등록">
          <div className="form-grid">
            <label className="span-2">
              URL
              <input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="https://..." className={webUrl && !isValidUrl(webUrl) ? 'invalid' : ''} />
              {webUrl && !isValidUrl(webUrl) && <small className="err">URL 형식을 확인하세요.</small>}
            </label>
            <label className="span-2">
              제목
              <input value={webTitle} onChange={(e) => setWebTitle(e.target.value)} placeholder="자료 제목" />
            </label>
          </div>
          <CommonFields {...{ kw, setKw, para, setPara, rel, setRel }} />
          <div className="actions">
            <button className="btn btn-primary" onClick={registerWeb}>
              라이브러리에 등록
            </button>
          </div>
        </Card>
      )}

      {tab === 'youtube' && (
        <Card title="YouTube 자료 등록">
          <div className="yt-form">
            <div className="form-grid">
              <label className="span-2">
                YouTube URL
                <input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..." className={ytUrl && !ytId ? 'invalid' : ''} />
                {ytUrl && !ytId && <small className="err">유효한 YouTube 영상 URL이 아닙니다.</small>}
                {ytId && <small className="ok">영상 ID: {ytId}</small>}
              </label>
              <label className="span-2">
                제목 (선택)
                <input value={ytTitle} onChange={(e) => setYtTitle(e.target.value)} placeholder="비워두면 영상 ID로 표시" />
              </label>
            </div>
            <div className="yt-preview">{ytId ? <img src={ytThumb(ytId)} alt="YouTube 썸네일" /> : <div className="yt-placeholder">썸네일 미리보기</div>}</div>
          </div>
          <CommonFields {...{ kw, setKw, para, setPara, rel, setRel }} />
          <div className="actions">
            <button className="btn btn-primary" onClick={registerYt}>
              라이브러리에 등록
            </button>
          </div>
        </Card>
      )}

      {tab === 'file' && (
        <Card title="Markdown · 파일 가져오기">
          <p className="muted small">내 컴퓨터의 Markdown(.md), 텍스트(.txt), AI WIKI JSON을 고르면 추가·갱신·충돌·중복을 미리 보여 준 뒤 적용합니다. 새 자료는 현재 프로젝트 폴더에 들어갑니다.</p>
          <ImportFlow label="파일 선택" />
        </Card>
      )}

      <section className="store-section">
        <div className="store-head">
          <h2>연동 저장소에서 가져오기</h2>
          <p>
            Google Drive와 Obsidian은 자료를 새로 수집하는 곳이 아니라, <b>이미 확보해 정리해 둔 연구자료를 보관하는 외부 저장소</b>입니다. 저장소의 기존
            자료 가운데 필요한 것만 골라 현재 프로젝트(<b>{project.name}</b>)로 가져옵니다.
          </p>
        </div>
        <div className="store-grid">
          <Card title="Google Drive에서 가져오기" extra={c.drive ? <StatusBadge s="real">연결됨</StatusBadge> : <span className="warn-tag">연결 필요</span>} className="store-card">
            <p className="muted small">
              Drive에 보관된 기존 연구자료(PDF·노트)를 목록에서 <b>체크한 것만</b> 현재 프로젝트로 가져옵니다. 기본으로 <code>AI WIKI/{project.name}/자료</code> 폴더를
              열며, 다른 폴더로 이동해 고를 수도 있습니다.
            </p>
            {!driveConfigured() ? (
              <p className="notice">
                Google Drive 연결이 설정되지 않았습니다. <code>.env</code>에 <code>VITE_GOOGLE_CLIENT_ID</code>를 넣고 개발 서버를 다시 시작하세요 (README 참고).
              </p>
            ) : c.drive ? (
              <button className="btn btn-primary btn-sm" onClick={() => setDriveOpen(true)}>
                Drive 자료 목록 열기
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => nav.go('settings')}>
                연구 설정에서 Google 계정 연결
              </button>
            )}
            {driveOpen && <DriveImportModal onClose={() => setDriveOpen(false)} />}
          </Card>
          <ObsidianSync importOnly onOpenSettings={() => nav.go('settings')} />
        </div>
      </section>
    </>
  );
}
