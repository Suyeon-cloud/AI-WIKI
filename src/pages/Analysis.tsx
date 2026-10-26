import { useEffect, useMemo, useRef, useState } from 'react';
import { USAGE_SECTIONS, hasMyView, type Analysis as AnalysisT, type Material, type UsageSection } from '../types';
import { useStore, useProject } from '../store';
import { AI_MODEL_LABEL, AiError, generate } from '../lib/ai';
import { uid } from '../lib/utils';
import { bibAuthors } from '../lib/citation';
import {
  ANALYSIS_SYSTEM,
  COLLECTION_SCHEMA,
  PAPER_SCHEMA,
  collectionPrompt,
  collectionToMarkdown,
  paperPrompt,
  paperToMarkdown,
  type AnalysisBrief,
  type CollectionResult,
} from '../lib/prompts';
import { Card, Empty, NeedProject, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';
import { OutputList } from '../components/Outputs';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';

type Tab = 'all' | 'one' | 'history';

interface NotesForm {
  myView: string;
  researchLink: string;
  researchMemo: string;
  usage: UsageSection[];
}
const notesOf = (m: Material): NotesForm => ({ myView: m.myView ?? '', researchLink: m.researchLink ?? '', researchMemo: m.researchMemo ?? '', usage: m.usage ?? [] });

/** 연구자가 직접 쓰는 기록: 나의 관점 · 내 연구와의 연결 · 연구 메모 · 논문 활용 위치 (AI가 채우지 않음) */
function ResearcherNotes({ m }: { m: Material }) {
  const { dispatch, toast } = useStore();
  const [f, setF] = useState<NotesForm>(() => notesOf(m));
  useEffect(() => setF(notesOf(m)), [m.id, m.myView, m.researchLink, m.researchMemo, m.usage]);
  const dirty = JSON.stringify(f) !== JSON.stringify(notesOf(m));
  const set = (k: keyof NotesForm, v: string) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (u: UsageSection) => setF((p) => ({ ...p, usage: USAGE_SECTIONS.filter((x) => (x === u ? !p.usage.includes(u) : p.usage.includes(x))) }));

  return (
    <Card title="나의 관점 · 연구 기록" extra={hasMyView(m) ? <span className="ok-tag">관점 작성 완료</span> : <span className="warn-tag">관점 작성 필요</span>}>
      <p className="muted small">AI 분석 문장은 여기에 자동으로 들어가지 않습니다. 연구자가 직접 쓴 관점은 다음 AI 분석·집필의 기준이 됩니다.</p>
      <label className="field">
        <span className="field-label">나의 관점</span>
        <textarea rows={4} value={f.myView} onChange={(e) => set('myView', e.target.value)} placeholder="이 자료에 대한 나의 해석, 동의/비판하는 지점" />
      </label>
      <label className="field">
        <span className="field-label">내 연구와의 연결</span>
        <textarea rows={2} value={f.researchLink} onChange={(e) => set('researchLink', e.target.value)} placeholder="내 연구 문제와 어떻게 연결되는지, 차이점은 무엇인지" />
      </label>
      <label className="field">
        <span className="field-label">연구 메모</span>
        <textarea rows={2} value={f.researchMemo} onChange={(e) => set('researchMemo', e.target.value)} placeholder="연구 방법, 주요 결과, 한계, 추가로 확인할 점" />
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
            dispatch({
              type: 'update',
              id: m.id,
              patch: { myView: f.myView, researchLink: f.researchLink.trim() || undefined, researchMemo: f.researchMemo.trim() || undefined, usage: f.usage.length ? f.usage : undefined },
            });
            toast('연구 기록을 저장했습니다.');
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

function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  const start = (label: string) => {
    ctrl.current = new AbortController();
    setChars(0);
    setBusy(label);
    return ctrl.current.signal;
  };
  return { busy, chars, setChars, start, stop: () => setBusy(null), cancel: () => ctrl.current?.abort() };
}

function CollectionView({ r, ms }: { r: CollectionResult; ms: Material[] }) {
  const name = (id: string) => {
    const i = ms.findIndex((m) => m.id === id);
    return i >= 0 ? <span className="ref-chip" title={ms[i].title} key={id}>[{i + 1}]</span> : null;
  };
  return (
    <div className="insight">
      <section className="insight-lead">
        <h4>전체 개관</h4>
        <p>{r.overview}</p>
      </section>
      <div className="insight-grid">
        <section>
          <h4>주제 흐름</h4>
          <ul>{r.themes.map((t) => <li key={t.name}><b>{t.name}</b> {t.description} {t.materialIds.map(name)}</li>)}</ul>
        </section>
        <section className="hl-gap">
          <h4>연구 공백</h4>
          <ul>{r.gaps.map((g) => <li key={g.gap}><b>{g.gap}</b> <span className="muted">— {g.evidence}</span></li>)}</ul>
        </section>
        <section>
          <h4>공통 발견</h4>
          <ul>{r.agreements.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
        <section>
          <h4>쟁점</h4>
          <ul>{r.debates.map((d) => <li key={d.issue}><b>{d.issue}</b> {d.positions} {d.materialIds.map(name)}</li>)}</ul>
        </section>
        <section className="hl-diff">
          <h4>내 연구의 차별점</h4>
          <ul>{r.differentiation.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
        <section className="hl-diff">
          <h4>제안 연구 문제</h4>
          <ol>{r.researchQuestions.map((x) => <li key={x}>{x}</li>)}</ol>
        </section>
      </div>
      <section>
        <h4>자료별 역할 판단</h4>
        <table className="table compact">
          <thead><tr><th>#</th><th>자료</th><th>역할</th><th>AI 관련도</th><th>판단 이유</th></tr></thead>
          <tbody>
            {r.materialNotes.map((n) => {
              const i = ms.findIndex((m) => m.id === n.id);
              return (
                <tr key={n.id}>
                  <td>{i + 1}</td>
                  <td className="cell-title">{ms[i]?.title ?? n.id}</td>
                  <td><span className="chip">{n.role}</span></td>
                  <td><Relevance value={Math.min(5, Math.max(1, n.relevance))} /></td>
                  <td className="small">{n.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="insight-grid">
        <section>
          <h4>더 찾아볼 검색어 (KCI)</h4>
          <div className="chips">{r.nextKeywords.map((k) => <a key={k} className="chip" href={`https://www.kci.go.kr/kciportal/po/search/poTotalSearList.kci?searchText=${encodeURIComponent(k)}`} target="_blank" rel="noreferrer">{k} ↗</a>)}</div>
        </section>
        <section>
          <h4>자료 구성의 한계</h4>
          <ul>{r.cautions.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}

function PaperView({ a }: { a: AnalysisT }) {
  return (
    <div className="result-grid">
      <div className="result-item span-2"><h4>요약</h4><p>{a.summary}</p></div>
      <div className="result-item"><h4>핵심 주제</h4><p>{a.topic}</p></div>
      <div className="result-item"><h4>관련도</h4><p><Relevance value={a.relevance} /> {a.rationale}</p></div>
      {a.method && <div className="result-item"><h4>연구 방법</h4><p>{a.method}</p></div>}
      {a.findings && <div className="result-item"><h4>주요 결과</h4><p>{a.findings}</p></div>}
      <div className="result-item span-2"><h4>내 논문과의 접점</h4><p>{a.connection}</p></div>
      <div className="result-item span-2"><h4>인사이트</h4><ul>{a.insights.map((i) => <li key={i}>{i}</li>)}</ul></div>
      {a.limitations && <div className="result-item"><h4>한계</h4><p>{a.limitations}</p></div>}
      {a.usageIdea && <div className="result-item"><h4>활용 제안</h4><p>{a.usageIdea}</p></div>}
      <div className="result-item span-2"><h4>핵심 키워드</h4><div className="chips">{a.keywords.map((k) => <span key={k} className="chip">{k}</span>)}</div></div>
    </div>
  );
}

const hasBody = (m: Material) => (m.abstract ? '초록' : m.content ? '본문' : m.myView ? '메모만' : '제목만');

export function Analysis() {
  const { state, dispatch, toast } = useStore();
  const { project, materials } = useProject();
  const nav = useNav();
  const conn = useConnections();
  const [tab, setTab] = useState<Tab>('all');
  const [brief, setBrief] = useState<AnalysisBrief>({ topic: '', keywords: [], view: '' });
  const [kwText, setKwText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ r: CollectionResult; ms: Material[] } | null>(null);
  const run = useRunner();

  useEffect(() => {
    if (!project) return;
    setBrief({ topic: project.topic, keywords: project.keywords, view: project.defaultView });
    setKwText(project.keywords.join(', '));
    setPicked(new Set(materials.map((m) => m.id)));
    setResult(null);
  }, [project?.id]);

  const selected = materials.find((m) => m.id === state.selectedId) ?? null;
  const targets = useMemo(() => materials.filter((m) => picked.has(m.id)), [materials, picked]);
  const keywords = kwText.split(',').map((k) => k.trim()).filter(Boolean);

  if (!project)
    return (
      <>
        <PageHeader title="AI 분석" desc="모은 자료 전체를 AI가 어떻게 판단하는지 확인합니다." />
        <NeedProject onCreate={nav.newProject} />
      </>
    );

  const ready = () => {
    if (!conn.ai) {
      toast('Claude API 키가 필요합니다. 연구 설정 → AI 설정에서 입력하세요.', 'error');
      return false;
    }
    if (!brief.topic.trim() || !keywords.length) {
      toast('분석 주제와 키워드를 1개 이상 입력하세요. AI는 이 기준으로 자료를 판단합니다.', 'error');
      return false;
    }
    return true;
  };
  const fullBrief = (): AnalysisBrief => ({ ...brief, topic: brief.topic.trim(), keywords });

  async function runAll() {
    if (!ready()) return;
    if (targets.length < 2) return toast('전체 분석은 자료 2건 이상을 선택하세요. 한 편은 "선택 논문 분석"을 사용하세요.', 'info');
    const signal = run.start('all');
    const b = fullBrief();
    try {
      const { data, model } = await generate<CollectionResult>({
        system: ANALYSIS_SYSTEM,
        content: collectionPrompt(b, project!, targets),
        schema: COLLECTION_SCHEMA as unknown as Record<string, unknown>,
        onProgress: run.setChars,
        signal,
      });
      setResult({ r: data, ms: targets });
      dispatch({
        type: 'addOutput',
        output: {
          id: uid(),
          projectId: project!.id,
          kind: '전체 분석',
          title: `전체 분석 — ${b.keywords.slice(0, 3).join(', ')} (${targets.length}건)`,
          createdAt: new Date().toISOString(),
          model,
          content: collectionToMarkdown(data, b, targets),
          materialIds: targets.map((m) => m.id),
        },
      });
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '분석', text: `자료 ${targets.length}건 전체 분석을 실행했습니다.` } });
      toast('전체 분석을 마쳤습니다. 결과는 AI 결과물 보관함에도 저장됩니다.');
    } catch (e) {
      toast(e instanceof AiError ? e.message : String(e), 'error');
    } finally {
      run.stop();
    }
  }

  async function runOne(m: Material) {
    if (!ready()) return;
    const signal = run.start('one');
    try {
      const { data, model } = await generate<AnalysisT>({
        system: ANALYSIS_SYSTEM,
        content: paperPrompt(fullBrief(), project!, m),
        schema: PAPER_SCHEMA as unknown as Record<string, unknown>,
        onProgress: run.setChars,
        signal,
      });
      const a: AnalysisT = { ...data, relevance: Math.min(5, Math.max(1, Math.round(data.relevance))), citationCandidate: '', model, analyzedAt: new Date().toISOString() };
      dispatch({ type: 'update', id: m.id, patch: { analysis: a } });
      dispatch({
        type: 'addOutput',
        output: { id: uid(), projectId: project!.id, kind: '개별 분석', title: `논문 분석 — ${m.title}`, createdAt: new Date().toISOString(), model, content: paperToMarkdown(a, m), materialIds: [m.id] },
      });
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '분석', text: `'${m.title}' 논문을 분석했습니다.` } });
      toast('논문 분석을 마쳤습니다.');
    } catch (e) {
      toast(e instanceof AiError ? e.message : String(e), 'error');
    } finally {
      run.stop();
    }
  }

  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="AI 분석"
        desc="모아 둔 자료를 AI가 내 주제·키워드 기준으로 판단하고 인사이트를 줍니다. (원고 작성은 AI 집필에서)"
        badges={<StatusBadge s="ai">{AI_MODEL_LABEL}</StatusBadge>}
      />

      <Card title="① 분석 기준 — AI에게 주제와 키워드를 알려 주세요" className="brief-card">
        <div className="form-grid">
          <label className="span-2">
            분석 주제 <b className="req">*</b>
            <input value={brief.topic} onChange={(e) => setBrief({ ...brief, topic: e.target.value })} placeholder="예: AI 모션그래픽을 활용한 중국 드라마 문화교육 콘텐츠" />
          </label>
          <label className="span-2">
            키워드 (쉼표 구분) <b className="req">*</b>
            <input value={kwText} onChange={(e) => setKwText(e.target.value)} placeholder="예: 모션그래픽, 문화교육, 중국 드라마, 생성형 AI" />
          </label>
          <label className="span-2">
            나의 관점 (선택)
            <input value={brief.view} onChange={(e) => setBrief({ ...brief, view: e.target.value })} placeholder="자료를 판단할 때 AI가 고려할 나의 입장" />
          </label>
          <label className="span-2">
            이번에 특히 알고 싶은 것 (선택)
            <input value={brief.question ?? ''} onChange={(e) => setBrief({ ...brief, question: e.target.value })} placeholder="예: 선행연구에서 다루지 않은 부분은? 내 연구 방법의 근거가 되는 자료는?" />
          </label>
        </div>
        <div className="actions">
          <button
            className="btn btn-sm"
            onClick={() => {
              dispatch({ type: 'updateProject', id: project.id, patch: { topic: brief.topic.trim() || project.topic, keywords, defaultView: brief.view } });
              toast('프로젝트의 주제·키워드로 저장했습니다.');
            }}
          >
            프로젝트 기본값으로 저장
          </button>
          {!conn.ai && <span className="warn-tag">Claude API 키 필요 — <button className="link small" onClick={() => nav.go('settings')}>설정</button></span>}
        </div>
      </Card>

      <div className="tabs analysis-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          <b>전체 분석</b>
          <small>모은 자료 전체를 종합 분석</small>
        </button>
        <button role="tab" aria-selected={tab === 'one'} className={tab === 'one' ? 'active' : ''} onClick={() => setTab('one')}>
          <b>선택 논문 분석</b>
          <small>한 편을 깊게 분석</small>
        </button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          <b>분석 기록</b>
          <small>저장된 AI 결과물</small>
        </button>
      </div>

      {tab === 'all' && (
        <>
          <Card
            title={`② 분석 대상 리스트 (${targets.length} / ${materials.length}건 선택)`}
            extra={
              <div className="btn-group">
                <button className="link small" onClick={() => setPicked(new Set(materials.map((m) => m.id)))}>모두 선택</button>
                <button className="link small" onClick={() => setPicked(new Set())}>선택 해제</button>
              </div>
            }
          >
            {materials.length === 0 ? (
              <Empty>이 프로젝트에 자료가 없습니다. <button className="link" onClick={() => nav.go('collect')}>자료 수집</button>에서 추가하세요.</Empty>
            ) : (
              <table className="table compact">
                <thead>
                  <tr><th className="cb" /><th>#</th><th>자료</th><th>저자 · 연도</th><th>AI가 읽을 내용</th><th>내 관점</th><th>관련도</th></tr>
                </thead>
                <tbody>
                  {materials.map((m, i) => (
                    <tr key={m.id} className="clickable" onClick={() => togglePick(m.id)}>
                      <td className="cb"><input type="checkbox" checked={picked.has(m.id)} readOnly /></td>
                      <td className="muted">{i + 1}</td>
                      <td className="cell-title">{m.title}</td>
                      <td className="small">{[bibAuthors(m.bib).slice(0, 2).join(', '), m.bib?.year].filter(Boolean).join(' · ') || '-'}</td>
                      <td><span className={hasBody(m) === '제목만' ? 'warn-tag' : 'chip'}>{hasBody(m)}</span></td>
                      <td>{hasMyView(m) ? <span className="ok-tag">있음</span> : <span className="muted small">-</span>}</td>
                      <td><Relevance value={m.relevance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <button className="btn btn-primary btn-lg" onClick={runAll} disabled={!!run.busy || targets.length < 2}>
                {run.busy === 'all' ? `AI가 자료 ${targets.length}건을 읽는 중… ${run.chars ? `(${run.chars.toLocaleString()}자 작성)` : ''}` : `③ 전체 분석 실행 (${targets.length}건)`}
              </button>
              {run.busy === 'all' && <button className="btn btn-sm" onClick={run.cancel}>취소</button>}
              <span className="muted small">'제목만' 자료는 판단 근거가 약합니다. 초록이나 본문이 있는 자료를 넣으세요.</span>
            </div>
          </Card>
          {result && (
            <Card title="AI 전체 분석 결과" extra={<StatusBadge s="ai">AI 판단 · 연구자 검토 필요</StatusBadge>} className="result ai-outline">
              <CollectionView r={result.r} ms={result.ms} />
            </Card>
          )}
        </>
      )}

      {tab === 'one' && (
        <div className="analysis-layout">
          <Card title="분석할 논문 선택" className="pick-list">
            {materials.length === 0 ? (
              <Empty>자료가 없습니다.</Empty>
            ) : (
              <ul>
                {materials.map((x) => (
                  <li key={x.id}>
                    <button className={x.id === state.selectedId ? 'active' : ''} onClick={() => dispatch({ type: 'select', id: x.id })}>
                      <SourceTag type={x.sourceType} />
                      <span>{x.title}</span>
                      {x.analysis?.analyzedAt && <i className="dot" title="AI 분석 완료" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="analysis-main">
            {!selected ? (
              <Card><Empty>왼쪽에서 분석할 논문을 선택하세요.</Empty></Card>
            ) : (
              <>
                <Card className="analysis-head">
                  <div className="analysis-title">
                    <div>
                      <SourceTag type={selected.sourceType} />
                      <h2>{selected.title}</h2>
                      <span className="muted small">AI가 읽을 내용: {hasBody(selected)}{selected.content ? ` (본문 ${selected.content.length.toLocaleString()}자)` : ''}</span>
                    </div>
                    <button className="btn btn-primary" disabled={!!run.busy} onClick={() => runOne(selected)}>
                      {run.busy === 'one' ? `분석 중… ${run.chars ? `(${run.chars.toLocaleString()}자)` : ''}` : selected.analysis?.analyzedAt ? '다시 분석' : '이 논문 AI 분석'}
                    </button>
                  </div>
                </Card>
                {selected.analysis?.analyzedAt ? (
                  <Card title="AI 논문 분석" extra={<StatusBadge s="ai">{selected.analysis.model ?? 'Claude'}</StatusBadge>} className="result ai-outline">
                    <PaperView a={selected.analysis} />
                  </Card>
                ) : selected.analysis ? (
                  <Card><Empty>이전 버전의 Demo 분석만 있습니다. "이 논문 AI 분석"으로 실제 분석을 실행하세요.</Empty></Card>
                ) : null}
                <ResearcherNotes m={selected} />
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && <OutputList kinds={['전체 분석', '개별 분석']} title="분석 기록 (AI 결과물)" />}
    </>
  );
}
