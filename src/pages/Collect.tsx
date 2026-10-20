import { useRef, useState } from 'react';
import type { PageKey, Para, SourceType } from '../types';
import { newMaterial, useStore } from '../store';
import { PARAS, extractYouTubeId, formatSize, isValidUrl, ytThumb } from '../lib/utils';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import { DriveSync } from '../components/DriveSync';

type Tab = 'file' | 'web' | 'youtube' | 'drive';

const TABS: { key: Tab; label: string; desc: string; status: 'real' | 'planned' }[] = [
  { key: 'file', label: 'PDF / 파일', desc: '로컬 파일 정보를 읽어 등록', status: 'real' },
  { key: 'web', label: '웹 자료', desc: 'URL과 제목으로 등록', status: 'real' },
  { key: 'youtube', label: 'YouTube', desc: '영상 ID 추출 및 썸네일', status: 'real' },
  { key: 'drive', label: 'Google Drive', desc: 'Drive 파일 불러오기·저장', status: 'real' },
];

function splitKeywords(s: string) {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function CommonFields({
  topic,
  setTopic,
  kw,
  setKw,
  para,
  setPara,
  rel,
  setRel,
}: {
  topic: string;
  setTopic: (v: string) => void;
  kw: string;
  setKw: (v: string) => void;
  para: Para;
  setPara: (v: Para) => void;
  rel: number;
  setRel: (v: number) => void;
}) {
  return (
    <div className="form-grid">
      <label>
        주제
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 중국 드라마 속 호칭 표현" />
      </label>
      <label>
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
        논문 관련도 (직접 지정)
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

export function Collect({ go }: { go: (p: PageKey) => void }) {
  const { dispatch, toast } = useStore();
  const [tab, setTab] = useState<Tab>('file');
  const [topic, setTopic] = useState('');
  const [kw, setKw] = useState('');
  const [para, setPara] = useState<Para>('Resources');
  const [rel, setRel] = useState(3);

  // 파일
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileType, setFileType] = useState<'PDF' | 'HWPX'>('PDF');
  const [files, setFiles] = useState<File[]>([]);
  // 웹
  const [webUrl, setWebUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  // 유튜브
  const [ytUrl, setYtUrl] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const ytId = extractYouTubeId(ytUrl);

  const resetCommon = () => {
    setTopic('');
    setKw('');
    setRel(3);
  };
  const common = { topic, keywords: splitKeywords(kw), para, relevance: rel };

  function registerFiles() {
    if (!files.length) return toast('먼저 파일을 선택하세요.', 'error');
    files.forEach((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      const type: SourceType = ext === 'hwpx' ? 'HWPX' : ext === 'pdf' ? 'PDF' : fileType;
      dispatch({
        type: 'add',
        material: newMaterial({
          ...common,
          title: f.name.replace(/\.[^.]+$/, ''),
          sourceType: type,
          fileName: f.name,
          fileSize: f.size,
          mimeType: f.type || undefined,
        }),
      });
    });
    toast(`${files.length}개 파일 정보를 라이브러리에 등록했습니다.`);
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
    resetCommon();
  }

  function registerWeb() {
    if (!isValidUrl(webUrl)) return toast('올바른 URL 형식이 아닙니다. http:// 또는 https://로 시작해야 합니다.', 'error');
    if (!webTitle.trim()) return toast('제목을 입력하세요.', 'error');
    dispatch({ type: 'add', material: newMaterial({ ...common, title: webTitle.trim(), sourceType: 'Web', url: webUrl.trim() }) });
    toast('웹 자료를 등록했습니다.');
    setWebUrl('');
    setWebTitle('');
    resetCommon();
  }

  function registerYt() {
    if (!ytId) return toast('YouTube URL에서 영상 ID를 찾을 수 없습니다.', 'error');
    dispatch({
      type: 'add',
      material: newMaterial({
        ...common,
        title: ytTitle.trim() || `YouTube 영상 (${ytId})`,
        sourceType: 'YouTube',
        url: `https://www.youtube.com/watch?v=${ytId}`,
        youtubeId: ytId,
      }),
    });
    toast('YouTube 자료를 등록했습니다. AI 분석 화면에서 자막 추출·요약 Demo를 실행할 수 있습니다.');
    setYtUrl('');
    setYtTitle('');
    resetCommon();
  }

  return (
    <>
      <PageHeader
        title="자료 수집"
        desc="PDF·HWPX·웹·YouTube 자료를 연구 라이브러리에 등록합니다. 등록 정보는 이 브라우저에만 저장됩니다."
        badges={<StatusBadge s="local" />}
      />

      <div className="collect-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`collect-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <div className="collect-tab-top">
              <b>{t.label}</b>
              <StatusBadge s={t.status} />
            </div>
            <span>{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === 'file' && (
        <Card title="PDF / 파일 등록" extra={<StatusBadge s="real" />}>
          <div className="type-select">
            <span className="muted small">자료 유형</span>
            <label className="radio">
              <input type="radio" checked={fileType === 'PDF'} onChange={() => setFileType('PDF')} /> PDF
            </label>
            <label className="radio">
              <input type="radio" checked={fileType === 'HWPX'} onChange={() => setFileType('HWPX')} /> HWPX
              <StatusBadge s="planned">파싱 추후 지원</StatusBadge>
            </label>
          </div>
          <div
            className="dropzone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept={fileType === 'PDF' ? '.pdf,application/pdf' : '.hwpx'}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <b>클릭하여 파일 선택</b> 또는 여기로 끌어다 놓기
            <span className="muted small">파일명·크기·형식만 읽습니다. 파일 자체는 서버나 클라우드에 업로드되지 않습니다.</span>
          </div>
          {files.length > 0 && (
            <table className="table compact">
              <thead>
                <tr>
                  <th>파일명</th>
                  <th>크기</th>
                  <th>MIME</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td>{formatSize(f.size)}</td>
                    <td className="muted">{f.type || '알 수 없음'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="notice">
            <StatusBadge s="planned">고도화 예정</StatusBadge> PDF 본문 텍스트 추출은 이번 프로토타입에서 제외했습니다. HWPX는
            자료 유형으로 등록만 가능하며 실제 문서 파싱은 추후 지원합니다.
          </div>
          <CommonFields {...{ topic, setTopic, kw, setKw, para, setPara, rel, setRel }} />
          <div className="actions">
            <button className="btn btn-primary" onClick={registerFiles}>
              라이브러리에 등록
            </button>
          </div>
        </Card>
      )}

      {tab === 'web' && (
        <Card title="웹 자료 등록" extra={<StatusBadge s="real" />}>
          <div className="form-grid">
            <label className="span-2">
              URL
              <input
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                placeholder="https://..."
                className={webUrl && !isValidUrl(webUrl) ? 'invalid' : ''}
              />
              {webUrl && !isValidUrl(webUrl) && <small className="err">URL 형식을 확인하세요.</small>}
            </label>
            <label className="span-2">
              제목
              <input value={webTitle} onChange={(e) => setWebTitle(e.target.value)} placeholder="자료 제목" />
            </label>
          </div>
          <p className="muted small">웹 페이지 본문 자동 수집(크롤링)은 하지 않으며, URL과 메타정보만 등록합니다.</p>
          <CommonFields {...{ topic, setTopic, kw, setKw, para, setPara, rel, setRel }} />
          <div className="actions">
            <button className="btn btn-primary" onClick={registerWeb}>
              라이브러리에 등록
            </button>
          </div>
        </Card>
      )}

      {tab === 'youtube' && (
        <Card title="YouTube 자료 등록" extra={<StatusBadge s="real">URL 검증 · 영상 ID 추출</StatusBadge>}>
          <div className="yt-form">
            <div className="form-grid">
              <label className="span-2">
                YouTube URL
                <input
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..."
                  className={ytUrl && !ytId ? 'invalid' : ''}
                />
                {ytUrl && !ytId && <small className="err">유효한 YouTube 영상 URL이 아닙니다.</small>}
                {ytId && <small className="ok">영상 ID: {ytId}</small>}
              </label>
              <label className="span-2">
                제목 (선택)
                <input value={ytTitle} onChange={(e) => setYtTitle(e.target.value)} placeholder="비워두면 영상 ID로 표시" />
              </label>
            </div>
            <div className="yt-preview">
              {ytId ? (
                <>
                  <img src={ytThumb(ytId)} alt="YouTube 썸네일" />
                  <a href={`https://www.youtube.com/watch?v=${ytId}`} target="_blank" rel="noreferrer" className="btn btn-sm">
                    YouTube에서 열기 ↗
                  </a>
                </>
              ) : (
                <div className="yt-placeholder">썸네일 미리보기</div>
              )}
            </div>
          </div>
          <div className="notice">
            <StatusBadge s="demo" /> 자막 추출·요약은 실제로 수행하지 않습니다. 등록 후 <b>AI 분석</b> 화면에서 샘플 결과를 확인할
            수 있습니다.
          </div>
          <CommonFields {...{ topic, setTopic, kw, setKw, para, setPara, rel, setRel }} />
          <div className="actions">
            <button className="btn btn-primary" onClick={registerYt}>
              라이브러리에 등록
            </button>
          </div>
        </Card>
      )}

      {tab === 'drive' && <DriveSync />}

      <p className="muted small" style={{ marginTop: 12 }}>
        등록한 자료는 <button className="link" onClick={() => go('library')}>자료 라이브러리</button>에서 확인할 수 있습니다.
      </p>
    </>
  );
}
