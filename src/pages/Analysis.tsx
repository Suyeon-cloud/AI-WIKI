import { useEffect, useState } from 'react';
import { USAGE_SECTIONS, hasMyView, type Material, type UsageSection } from '../types';
import { useStore } from '../store';
import { demoAnalysis, demoTranscript } from '../data/sample';
import { downloadFile, materialToMarkdown, safeFileName, ytThumb } from '../lib/utils';
import { Card, Empty, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';

function useDemoRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => void) => {
    setBusy(key);
    setTimeout(() => {
      fn();
      setBusy(null);
    }, 700);
  };
  return { busy, run };
}

function YouTubeFlow({ m }: { m: Material }) {
  const { dispatch, toast } = useStore();
  const { busy, run } = useDemoRunner();
  const t = m.transcript;

  function exportMd() {
    const md = materialToMarkdown(m);
    downloadFile(`${safeFileName(m.title)}.md`, md, 'text/markdown');
    toast('Obsidian용 Markdown 파일을 다운로드했습니다.');
  }

  return (
    <Card title="YouTube 자막 추출·요약" extra={<StatusBadge s="demo">자막 추출·요약 Demo</StatusBadge>}>
      <ol className="flow">
        <li className="done">YouTube 자료</li>
        <li className={t ? 'done' : ''}>자막 추출·요약 <small>(Demo)</small></li>
        <li className={t ? 'done' : ''}>샘플 요약 결과</li>
        <li>Markdown 내보내기 <small>(실제)</small></li>
      </ol>
      <div className="yt-flow">
        {m.youtubeId ? (
          <img src={ytThumb(m.youtubeId)} alt="썸네일" className="yt-flow-thumb" />
        ) : (
          <div className="yt-placeholder small">샘플 영상 — 썸네일 없음</div>
        )}
        <div className="yt-flow-body">
          <p className="muted small">
            실제 자막을 가져오지 않습니다. 버튼을 누르면 준비된 <b>샘플 자막 요약</b>이 표시됩니다.
          </p>
          <div className="btn-group">
            <button
              className="btn btn-demo"
              disabled={busy !== null}
              onClick={() =>
                run('yt', () => {
                  dispatch({ type: 'update', id: m.id, patch: { transcript: demoTranscript(m) } });
                  toast('샘플 자막 요약을 표시했습니다. (Demo)', 'info');
                })
              }
            >
              {busy === 'yt' ? '처리 중… (Demo)' : '자막 추출·요약 (Demo)'}
            </button>
            {m.url && (
              <a className="btn" href={m.url} target="_blank" rel="noreferrer">
                YouTube 원본 ↗
              </a>
            )}
          </div>
        </div>
      </div>
      {t && (
        <div className="transcript">
          <div className="demo-banner">아래 내용은 실제 자막이 아닌 Demo 샘플입니다.</div>
          <h4>요약</h4>
          <ul>{t.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          <h4>타임라인</h4>
          <ul className="timeline">
            {t.segments.map((s) => (
              <li key={s.time}>
                <code>{s.time}</code> {s.text}
              </li>
            ))}
          </ul>
          <button className="btn btn-primary" onClick={exportMd}>
            Obsidian용 Markdown으로 내보내기 (.md)
          </button>
        </div>
      )}
    </Card>
  );
}

interface NotesForm {
  myView: string;
  researchLink: string;
  researchMemo: string;
  usage: UsageSection[];
}
const notesOf = (m: Material): NotesForm => ({
  myView: m.myView ?? '',
  researchLink: m.researchLink ?? '',
  researchMemo: m.researchMemo ?? '',
  usage: m.usage ?? [],
});

/** 연구자가 직접 쓰는 기록: 나의 관점 · 내 연구와의 연결 · 연구 메모 · 논문 활용 위치 */
function ResearcherNotes({ m, defaultView }: { m: Material; defaultView: string }) {
  const { dispatch, toast } = useStore();
  const [f, setF] = useState<NotesForm>(() => notesOf(m));
  useEffect(() => setF(notesOf(m)), [m.id, m.myView, m.researchLink, m.researchMemo, m.usage]);
  const dirty = JSON.stringify(f) !== JSON.stringify(notesOf(m));
  const set = (k: keyof NotesForm, v: string) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (u: UsageSection) =>
    setF((p) => ({ ...p, usage: USAGE_SECTIONS.filter((x) => (x === u ? !p.usage.includes(u) : p.usage.includes(x))) }));

  return (
    <Card
      title="내 관점 · 연구 기록"
      extra={
        <>
          {hasMyView(m) ? <span className="ok-tag">관점 작성 완료</span> : <span className="warn-tag">관점 작성 필요</span>}
          <StatusBadge s="real">직접 입력 · 저장</StatusBadge>
        </>
      }
    >
      <p className="muted small">기본 분석 관점: {defaultView}</p>
      <label className="field">
        <span className="field-label">나의 관점 (필수)</span>
        <textarea
          rows={4}
          value={f.myView}
          onChange={(e) => set('myView', e.target.value)}
          placeholder="이 자료에 대한 나의 해석, 동의/비판하는 지점을 직접 기록하세요. AI 분석 문장은 자동으로 들어가지 않습니다."
        />
      </label>
      <label className="field">
        <span className="field-label">내 연구와의 연결</span>
        <textarea
          rows={3}
          value={f.researchLink}
          onChange={(e) => set('researchLink', e.target.value)}
          placeholder="내 연구 주제·연구 문제와 어떻게 연결되는지, 차이점은 무엇인지"
        />
      </label>
      <label className="field">
        <span className="field-label">연구 메모</span>
        <textarea
          rows={3}
          value={f.researchMemo}
          onChange={(e) => set('researchMemo', e.target.value)}
          placeholder="연구 방법, 주요 결과, 한계, 추가로 확인할 점 등"
        />
      </label>
      <div className="field">
        <span className="field-label">논문 활용 위치</span>
        <div className="chips">
          {USAGE_SECTIONS.map((u) => (
            <label key={u} className="radio usage-option">
              <input type="checkbox" checked={f.usage.includes(u)} onChange={() => toggle(u)} />
              {u}
            </label>
          ))}
        </div>
      </div>
      <div className="actions">
        <button
          className="btn btn-primary"
          disabled={!dirty}
          onClick={() => {
            dispatch({ type: 'update', id: m.id, patch: {
                myView: f.myView,
                researchLink: f.researchLink.trim() ? f.researchLink : undefined,
                researchMemo: f.researchMemo.trim() ? f.researchMemo : undefined,
                usage: f.usage.length ? f.usage : undefined,
              } });
            toast(f.myView.trim() ? '내 관점과 연구 기록을 저장했습니다.' : '저장했습니다. 나의 관점이 비어 있어 "관점 작성 필요"로 표시됩니다.', f.myView.trim() ? 'success' : 'info');
          }}
        >
          저장
        </button>
        <button className="btn" disabled={!dirty} onClick={() => setF(notesOf(m))}>되돌리기</button>
        {dirty && <span className="small muted">저장되지 않은 변경사항이 있습니다.</span>}
      </div>
    </Card>
  );
}

export function Analysis() {
  const { state, dispatch, toast } = useStore();
  const { busy, run } = useDemoRunner();
  const m = state.materials.find((x) => x.id === state.selectedId) ?? null;


  const a = m?.analysis;

  return (
    <>
      <PageHeader
        title="AI 분석"
        desc="선택한 연구자료를 현재 논문 주제의 관점에서 정리하고, 연구자 본인의 관점을 함께 기록합니다."
        badges={<><StatusBadge s="demo">AI 분석 Demo</StatusBadge><StatusBadge s="real">내 관점 저장</StatusBadge></>}
      />

      <div className="analysis-layout">
        <Card title="분석 대상 자료" className="pick-list">
          <ul>
            {state.materials.map((x) => (
              <li key={x.id}>
                <button
                  className={x.id === state.selectedId ? 'active' : ''}
                  onClick={() => dispatch({ type: 'select', id: x.id })}
                >
                  <SourceTag type={x.sourceType} />
                  <span>{x.title}</span>
                  {x.analysis && <i className="dot" title="Demo 분석 완료" />}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="analysis-main">
          {!m ? (
            <Card><Empty>왼쪽에서 분석할 자료를 선택하세요.</Empty></Card>
          ) : (
            <>
              <Card className="analysis-head">
                <div className="analysis-title">
                  <div>
                    <SourceTag type={m.sourceType} />
                    <h2>{m.title}</h2>
                  </div>
                  <button
                    className="btn btn-demo"
                    disabled={busy !== null}
                    onClick={() =>
                      run('an', () => {
                        dispatch({ type: 'update', id: m.id, patch: { analysis: demoAnalysis(m, state.settings) } });
                        toast('샘플 분석 결과를 표시했습니다. (Demo — 외부 AI 호출 없음)', 'info');
                      })
                    }
                  >
                    {busy === 'an' ? '분석 중… (Demo)' : a ? 'AI 분석 다시 실행 (Demo)' : 'AI 분석 실행 (Demo)'}
                  </button>
                </div>
                <p className="muted small">
                  외부 AI API를 호출하지 않습니다. 준비된 샘플 분석 템플릿에 자료 정보와 연구 설정을 조합하여 표시합니다.
                </p>
              </Card>

              {a ? (
                <Card title="AI 분석 결과" extra={<StatusBadge s="demo">Demo 샘플 결과</StatusBadge>} className="result demo-outline">
                  <div className="result-grid">
                    <div className="result-item span-2">
                      <h4>AI 요약</h4>
                      <p>{a.summary}</p>
                    </div>
                    <div className="result-item">
                      <h4>주제</h4>
                      <p>{a.topic}</p>
                    </div>
                    <div className="result-item">
                      <h4>소스 유형</h4>
                      <p><SourceTag type={m.sourceType} /></p>
                    </div>
                    <div className="result-item">
                      <h4>핵심 키워드</h4>
                      <div className="chips">{a.keywords.map((k) => <span key={k} className="chip">{k}</span>)}</div>
                    </div>
                    <div className="result-item">
                      <h4>논문 관련도</h4>
                      <p><Relevance value={a.relevance} /> <b>{a.relevance}/5</b></p>
                    </div>
                    <div className="result-item span-2">
                      <h4>관련도 판단 근거</h4>
                      <p>{a.rationale}</p>
                    </div>
                    <div className="result-item span-2">
                      <h4>현재 논문과의 접점</h4>
                      <p>{a.connection}</p>
                    </div>
                    <div className="result-item span-2">
                      <h4>핵심 인사이트</h4>
                      <ul>{a.insights.map((i) => <li key={i}>{i}</li>)}</ul>
                    </div>
                    <div className="result-item span-2">
                      <h4>참고문헌 후보 정보</h4>
                      <p>{a.citationCandidate}</p>
                      <span className="warn-tag">서지정보 확인 필요</span>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card><Empty>"AI 분석 실행 (Demo)" 버튼을 누르면 샘플 분석 결과가 표시됩니다.</Empty></Card>
              )}

              <ResearcherNotes m={m} defaultView={state.settings.defaultView} />

              {m.sourceType === 'YouTube' && <YouTubeFlow m={m} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
