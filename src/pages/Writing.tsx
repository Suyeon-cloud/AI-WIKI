import { useEffect, useMemo, useRef, useState } from 'react';
import type { Material, ThesisChapter, ThesisDraft } from '../types';
import { useStore, useProject } from '../store';
import SKILL_MD from '../../.claude/skills/hufs-thesis-writing/SKILL.md?raw';
import { AI_MODEL_LABEL, AiError, generate } from '../lib/ai';
import { buildThesisHwpx, sectionsOf, type ThesisDoc } from '../lib/hwpx';
import { checkBib, formatCitation, segsToText, sortForStyle } from '../lib/citation';
import { downloadFile, safeFileName, uid } from '../lib/utils';
import { ABSTRACT_SCHEMA, CHAPTER_SCHEMA, OUTLINE_SCHEMA, thesisContext } from '../lib/prompts';
import { saveOutputToDrive } from '../lib/sync';
import { Card, Empty, NeedProject, PageHeader, StatusBadge } from '../components/ui';
import { OutputList } from '../components/Outputs';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';

/** 스킬 파일의 frontmatter를 뺀 본문 = AI 집필 시스템 지침 */
const SKILL = SKILL_MD.replace(/^---[\s\S]*?---\s*/, '');

const DEFAULT_OUTLINE: { title: string; sections: string[] }[] = [
  { title: 'Ⅰ. 서론', sections: ['1. 연구의 필요성 및 목적', '2. 연구 문제', '3. 연구 방법 및 범위', '4. 선행연구 검토'] },
  { title: 'Ⅱ. 이론적 배경', sections: ['1. 주요 개념 및 이론', '2. 관련 연구 및 논의'] },
  { title: 'Ⅲ. 연구 설계', sections: ['1. 연구 대상 및 자료', '2. 연구 방법 및 절차'] },
  { title: 'Ⅳ. 연구 결과 및 논의', sections: ['1. 분석 결과', '2. 결과에 대한 논의'] },
  { title: 'Ⅴ. 결론', sections: ['1. 연구 요약', '2. 연구의 의의와 한계', '3. 후속 연구 제언'] },
];

const toChapters = (o: { title: string; sections: string[] }[], prev: ThesisChapter[] = []): ThesisChapter[] =>
  o.map((c) => {
    const old = prev.find((p) => p.title === c.title);
    return { id: old?.id ?? uid(), title: c.title, sections: c.sections, text: old?.text ?? '' };
  });

const refLine = (m: Material) => {
  const s = formatCitation(m, 'APA 7');
  return s ? segsToText(s) : m.title;
};

export function Writing() {
  const { dispatch, toast } = useStore();
  const { project, materials, outputs, thesis } = useProject();
  const nav = useNav();
  const conn = useConnections();
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const [todo, setTodo] = useState<Record<string, string[]>>({});
  const [insightId, setInsightId] = useState('');
  const [length, setLength] = useState(4000);
  const ctrl = useRef<AbortController | null>(null);

  const t = thesis;
  useEffect(() => {
    setActive(t?.chapters[0]?.id ?? null);
    // 근거 자료 기본값: 참고문헌 선택 자료 + 관련도 4 이상
    if (project && t && !t.materialIds.length && materials.length)
      dispatch({ type: 'thesis', projectId: project.id, patch: { materialIds: materials.filter((m) => m.citationIncluded || m.relevance >= 4).map((m) => m.id) } });
  }, [project?.id]);

  const basis = useMemo(() => materials.filter((m) => t?.materialIds.includes(m.id)), [materials, t?.materialIds]);
  const insights = outputs.filter((o) => o.kind === '전체 분석');

  if (!project || !t)
    return (
      <>
        <PageHeader title="AI 집필" desc="외대 학위논문 서식으로 원고를 작성합니다." />
        <NeedProject onCreate={nav.newProject} />
      </>
    );

  const set = (patch: Partial<ThesisDraft>) => dispatch({ type: 'thesis', projectId: project.id, patch });
  const chapter = t.chapters.find((c) => c.id === active) ?? null;
  const setChapter = (id: string, patch: Partial<ThesisChapter>) => set({ chapters: t.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const outline = t.chapters.map((c) => ({ title: c.title, sections: c.sections.filter((s) => s.trim()) }));
  const insight = insights.find((o) => o.id === insightId)?.content;
  const title = t.titleKo || project.topic;

  function needAi() {
    if (!conn.ai) {
      toast('Claude API 키가 필요합니다. 연구 설정에서 입력하세요.', 'error');
      return false;
    }
    return true;
  }

  async function call<T>(label: string, o: { content: string; schema: object; maxTokens?: number }) {
    ctrl.current = new AbortController();
    setBusy(label);
    setChars(0);
    try {
      return await generate<T>({ system: SKILL, content: o.content, schema: o.schema as Record<string, unknown>, maxTokens: o.maxTokens, onProgress: setChars, signal: ctrl.current.signal });
    } finally {
      setBusy(null);
    }
  }

  async function suggestOutline() {
    if (!needAi()) return;
    try {
      const { data, model } = await call<{ chapters: { title: string; sections: string[] }[]; rationale: string }>('outline', {
        content: `${thesisContext(project!, title, outline, basis, insight)}\n\n위 연구 주제와 자료에 맞는 외대 ${project!.degree} 학위논문 목차(장·절)를 제안하라. 현재 목차가 있으면 다듬어라.`,
        schema: OUTLINE_SCHEMA,
        maxTokens: 8000,
      });
      set({ chapters: toChapters(data.chapters, t!.chapters) });
      setActive(null);
      dispatch({
        type: 'addOutput',
        output: { id: uid(), projectId: project!.id, kind: '목차 제안', title: `목차 제안 — ${title}`, createdAt: new Date().toISOString(), model, content: `${data.chapters.map((c) => `## ${c.title}\n${c.sections.map((s) => `- ${s}`).join('\n')}`).join('\n\n')}\n\n## 구성 이유\n${data.rationale}`, materialIds: basis.map((m) => m.id) },
      });
      toast('AI가 목차를 제안했습니다. 지도교수와 협의한 목차로 고쳐 쓰세요.');
    } catch (e) {
      toast(e instanceof AiError ? e.message : String(e), 'error');
    }
  }

  async function writeChapter(c: ThesisChapter) {
    if (!needAi()) return false;
    if (!basis.length) {
      toast('근거 자료를 1건 이상 선택하세요. AI는 선택한 자료만 인용합니다.', 'error');
      return false;
    }
    const others = t!.chapters
      .filter((x) => x.id !== c.id && x.text.trim())
      .map((x) => `${x.title}\n${x.text.slice(0, 800)}…`)
      .join('\n\n');
    try {
      const { data, model } = await call<{ text: string; citedIds: string[]; todo: string[] }>(`ch:${c.id}`, {
        content: `${thesisContext(project!, title, outline, basis, insight)}

${others ? `[이미 쓴 다른 장 (앞부분)]\n${others}\n` : ''}
[이번에 쓸 장] ${c.title}
[절 구성] ${c.sections.filter((s) => s.trim()).join(' / ') || '(절을 적절히 구성)'}
[분량] 공백 포함 약 ${length.toLocaleString()}자

위 장의 본문을 외대 학위논문 문체와 원고 출력 형식(절은 '## ', 항은 '### ')으로 써라.`,
        schema: CHAPTER_SCHEMA,
        maxTokens: 32000,
      });
      setChapter(c.id, { text: data.text });
      setTodo((x) => ({ ...x, [c.id]: data.todo }));
      dispatch({
        type: 'addOutput',
        output: { id: uid(), projectId: project!.id, kind: '집필 초안', title: `${c.title} 초안`, createdAt: new Date().toISOString(), model, content: `# ${c.title}\n\n${data.text}${data.todo.length ? `\n\n## 연구자 확인 사항\n${data.todo.map((x) => `- ${x}`).join('\n')}` : ''}`, materialIds: data.citedIds },
      });
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '집필', text: `AI가 '${c.title}' 초안을 작성했습니다.` } });
      return true;
    } catch (e) {
      toast(e instanceof AiError ? e.message : String(e), 'error');
      return false;
    }
  }

  async function writeAll() {
    for (const c of t!.chapters) {
      if (c.text.trim()) continue;
      setActive(c.id);
      if (!(await writeChapter(c))) return;
    }
    toast('비어 있던 장을 모두 작성했습니다.');
  }

  async function makeAbstract() {
    if (!needAi()) return;
    const body = t!.chapters.map((c) => `${c.title}\n${c.text.slice(0, 3000)}`).join('\n\n');
    if (!body.replace(/Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\.|\s/g, '')) return toast('본문을 먼저 작성하세요.', 'info');
    try {
      const { data } = await call<{ abstractKo: string; keywordsKo: string[]; titleEn: string; abstractEn: string; keywordsEn: string }>('abstract', {
        content: `논문 제목: ${title}\n키워드: ${project!.keywords.join(', ')}\n\n[본문]\n${body}\n\n이 논문의 국문초록과 ABSTRACT(영문)를 서식에 맞게 써라.`,
        schema: ABSTRACT_SCHEMA,
        maxTokens: 8000,
      });
      set({ abstractKo: data.abstractKo, abstractEn: data.abstractEn, keywordsEn: data.keywordsEn, titleEn: t!.titleEn || data.titleEn });
      if (data.keywordsKo.length && !project!.keywords.length) dispatch({ type: 'updateProject', id: project!.id, patch: { keywords: data.keywordsKo } });
      toast('국문초록과 ABSTRACT를 작성했습니다.');
    } catch (e) {
      toast(e instanceof AiError ? e.message : String(e), 'error');
    }
  }

  const refs = sortForStyle(basis.filter((m) => checkBib(m).complete), 'APA 7');
  const missingBib = basis.filter((m) => !checkBib(m).complete);

  function doc(): ThesisDoc {
    return {
      degree: project!.degree,
      titleKo: title,
      subtitle: t!.subtitle,
      titleEn: t!.titleEn,
      department: project!.department,
      departmentEn: project!.departmentEn,
      student: project!.student,
      studentEn: project!.studentEn,
      advisor: project!.advisor,
      year: t!.submitYear,
      month: t!.submitMonth,
      abstractKo: t!.abstractKo,
      keywordsKo: project!.keywords,
      abstractEn: t!.abstractEn,
      keywordsEn: t!.keywordsEn,
      chapters: t!.chapters.map((c) => ({ title: c.title, text: c.text })),
      references: refs.map(refLine),
    };
  }

  async function exportHwpx(toDrive: boolean) {
    if (!t!.chapters.length) return toast('목차와 본문을 먼저 작성하세요.', 'info');
    const bytes = buildThesisHwpx(doc());
    const name = `${safeFileName(title)}_${project!.degree}학위논문.hwpx`;
    const blob = new Blob([bytes], { type: 'application/hwp+zip' });
    const output = {
      id: uid(),
      projectId: project!.id,
      kind: '학위논문 HWPX' as const,
      title: `${name}`,
      createdAt: new Date().toISOString(),
      model: AI_MODEL_LABEL,
      content: `# ${title}\n\n${t!.chapters.map((c) => `## ${c.title}\n\n${c.text}`).join('\n\n')}\n\n## 참고문헌\n${refs.map((m) => `- ${refLine(m)}`).join('\n')}`,
      materialIds: basis.map((m) => m.id),
    };
    if (!toDrive) {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '내보내기', text: `학위논문 HWPX를 내려받았습니다 (${name}).` } });
      toast('HWPX 파일을 내려받았습니다. 한글에서 열어 쪽 번호·목차 쪽수를 확인하세요.');
      return;
    }
    setBusy('drive');
    try {
      const r = await saveOutputToDrive(output, project!, { blob, name, mime: 'application/hwp+zip' });
      const md = await saveOutputToDrive(output, project!);
      dispatch({ type: 'addOutput', output: { ...output, driveFileId: md.fileId, driveSyncedAt: new Date().toISOString() } });
      if (!project!.driveFolderId) dispatch({ type: 'updateProject', id: project!.id, patch: { driveFolderId: r.folderId, driveCreatedAt: new Date().toISOString() } });
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '내보내기', text: `학위논문 HWPX를 Drive 'AI 생성' 폴더에 저장했습니다.` } });
      toast(`Google Drive 'AI WIKI/${project!.name}/AI 생성' 폴더에 HWPX와 원고 Markdown을 저장했습니다.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const totalChars = t.chapters.reduce((s, c) => s + c.text.length, 0);

  return (
    <>
      <PageHeader
        title="AI 집필"
        desc="지도교수·목차를 정하면 학위논문집필 스킬(외대 서식)에 따라 장별 원고를 쓰고, 표지부터 참고문헌까지 HWPX로 출력합니다."
        badges={<><StatusBadge s="ai">{AI_MODEL_LABEL}</StatusBadge><span className="chip chip-strong">스킬: hufs-thesis-writing</span></>}
      />

      <div className="writing-layout">
        <div className="writing-side">
          <Card title="논문 정보 (표지·심사청구서)" extra={<button className="link small" onClick={() => nav.editProject(project)}>학과·지도교수 수정</button>}>
            <label className="field">
              <span className="field-label">논문 제목</span>
              <input value={t.titleKo} onChange={(e) => set({ titleKo: e.target.value })} placeholder={project.topic} />
            </label>
            <label className="field">
              <span className="field-label">부제목</span>
              <input value={t.subtitle} onChange={(e) => set({ subtitle: e.target.value })} placeholder="선택" />
            </label>
            <label className="field">
              <span className="field-label">영문 제목</span>
              <input value={t.titleEn} onChange={(e) => set({ titleEn: e.target.value })} placeholder="초록 생성 시 AI가 제안" />
            </label>
            <dl className="meta small-meta">
              <dt>학위</dt><dd>{project.degree}</dd>
              <dt>학과</dt><dd>{project.department || <span className="warn-tag">미입력</span>}</dd>
              <dt>지도교수</dt><dd>{project.advisor || <span className="warn-tag">미입력</span>}</dd>
              <dt>성명</dt><dd>{project.student || <span className="warn-tag">미입력</span>}</dd>
              <dt>제출</dt>
              <dd className="inline-inputs">
                <input value={t.submitYear} onChange={(e) => set({ submitYear: e.target.value })} style={{ width: 64 }} /> 년
                <input value={t.submitMonth} onChange={(e) => set({ submitMonth: e.target.value })} style={{ width: 44 }} /> 월
              </dd>
            </dl>
          </Card>

          <Card title={`근거 자료 (${basis.length}건)`} extra={<span className="muted small">AI는 이 자료만 인용</span>}>
            {materials.length === 0 ? (
              <Empty>자료가 없습니다.</Empty>
            ) : (
              <ul className="check-list">
                {materials.map((m) => (
                  <li key={m.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={t.materialIds.includes(m.id)}
                        onChange={() => set({ materialIds: t.materialIds.includes(m.id) ? t.materialIds.filter((x) => x !== m.id) : [...t.materialIds, m.id] })}
                      />
                      <span>{m.title}</span>
                      {!checkBib(m).complete && <span className="warn-tag" title="참고문헌 목록에서 빠짐">서지 확인</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className="field" style={{ marginTop: 10 }}>
              <span className="field-label">AI 전체 분석 결과 참고 (선택)</span>
              <select value={insightId} onChange={(e) => setInsightId(e.target.value)}>
                <option value="">사용 안 함</option>
                {insights.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </label>
          </Card>

          <Card
            title="목차"
            extra={
              <div className="btn-group">
                <button className="btn btn-sm" onClick={() => { set({ chapters: toChapters(DEFAULT_OUTLINE, t.chapters) }); setActive(null); }} disabled={!!busy}>기본 목차</button>
                <button className="btn btn-sm btn-ai" onClick={suggestOutline} disabled={!!busy}>{busy === 'outline' ? '제안 중…' : 'AI 목차 제안'}</button>
              </div>
            }
          >
            {t.chapters.length === 0 ? (
              <Empty>지도교수와 협의한 목차를 입력하거나 기본 목차·AI 제안으로 시작하세요.</Empty>
            ) : (
              <ul className="outline-edit">
                {t.chapters.map((c, i) => (
                  <li key={c.id} className={c.id === active ? 'active' : ''}>
                    <div className="outline-row">
                      <input value={c.title} onChange={(e) => setChapter(c.id, { title: e.target.value })} onFocus={() => setActive(c.id)} />
                      <span className={c.text.trim() ? 'ok-tag' : 'muted small'}>{c.text.trim() ? `${c.text.length.toLocaleString()}자` : '미작성'}</span>
                      <button className="link small" title="장 삭제" onClick={() => set({ chapters: t.chapters.filter((x) => x.id !== c.id) })}>✕</button>
                    </div>
                    <textarea
                      rows={Math.max(2, c.sections.length)}
                      value={c.sections.join('\n')}
                      onChange={(e) => setChapter(c.id, { sections: e.target.value.split('\n') })}
                      onFocus={() => setActive(c.id)}
                      placeholder="절 제목 (한 줄에 하나)"
                    />
                    {i === t.chapters.length - 1 && null}
                  </li>
                ))}
              </ul>
            )}
            <button className="link small" onClick={() => set({ chapters: [...t.chapters, { id: uid(), title: `${['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ'][t.chapters.length] ?? t.chapters.length + 1}. `, sections: [], text: '' }] })}>
              ＋ 장 추가
            </button>
          </Card>
        </div>

        <div className="writing-main">
          <Card
            title={chapter ? chapter.title : '본문'}
            extra={<span className="muted small">전체 {totalChars.toLocaleString()}자</span>}
          >
            {t.chapters.length > 0 && (
              <div className="chapter-tabs">
                {t.chapters.map((c) => (
                  <button key={c.id} className={c.id === active ? 'active' : ''} onClick={() => setActive(c.id)}>
                    {c.title.split('.')[0] || '장'}
                    {c.text.trim() && <i className="dot" />}
                  </button>
                ))}
              </div>
            )}
            {!chapter ? (
              <Empty>왼쪽 목차에서 장을 선택하세요.</Empty>
            ) : (
              <>
                <div className="toolbar">
                  <button className="btn btn-primary" onClick={() => writeChapter(chapter)} disabled={!!busy}>
                    {busy === `ch:${chapter.id}` ? `AI가 쓰는 중… ${chars ? `(${chars.toLocaleString()}자)` : ''}` : chapter.text.trim() ? 'AI로 이 장 다시 쓰기' : 'AI로 이 장 쓰기'}
                  </button>
                  <button className="btn" onClick={writeAll} disabled={!!busy}>빈 장 모두 쓰기</button>
                  {busy && <button className="btn btn-sm" onClick={() => ctrl.current?.abort()}>취소</button>}
                  <span className="spacer" />
                  <label className="small">
                    분량
                    <select value={length} onChange={(e) => setLength(Number(e.target.value))} style={{ width: 'auto', marginLeft: 6 }}>
                      {[2000, 4000, 6000, 8000, 12000].map((n) => <option key={n} value={n}>{n.toLocaleString()}자</option>)}
                    </select>
                  </label>
                </div>
                <p className="muted small">형식: 절은 <code>## 1. 제목</code>, 항은 <code>### 1) 제목</code>, 문단은 한 줄에 하나 — 이 형식대로 HWPX 문단 모양이 정해집니다. 직접 고쳐 써도 됩니다.</p>
                <textarea className="editor" value={chapter.text} onChange={(e) => setChapter(chapter.id, { text: e.target.value })} placeholder={'## 1. 연구의 필요성 및 목적\n본문 문단…'} />
                {sectionsOf(chapter.text).length > 0 && <p className="muted small">절: {sectionsOf(chapter.text).join(' · ')}</p>}
                {todo[chapter.id]?.length ? (
                  <div className="notice">
                    <b>연구자 확인 사항 (AI 메모)</b>
                    <ul>{todo[chapter.id].map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card title="국문초록 · ABSTRACT" extra={<button className="btn btn-sm btn-ai" onClick={makeAbstract} disabled={!!busy}>{busy === 'abstract' ? '작성 중…' : 'AI로 초록 쓰기'}</button>}>
            <div className="form-grid">
              <label className="span-2">국문초록<textarea rows={4} value={t.abstractKo} onChange={(e) => set({ abstractKo: e.target.value })} /></label>
              <label className="span-2">ABSTRACT<textarea rows={4} value={t.abstractEn} onChange={(e) => set({ abstractEn: e.target.value })} /></label>
              <label className="span-2">Keywords<input value={t.keywordsEn} onChange={(e) => set({ keywordsEn: e.target.value })} /></label>
            </div>
          </Card>

          <Card title="출력 — 한국외대 학위논문 서식 HWPX">
            <ol className="export-steps">
              <li>겉표지 · 속표지 · 심사청구서(지도교수) · 인정서(심사위원 {project.degree === '박사' ? 5 : 3}인)</li>
              <li>국문초록 · 목차 · 본문 {t.chapters.length}개 장</li>
              <li>참고문헌 {refs.length}건 (APA 7, 국문→외국 문헌 순){missingBib.length > 0 && <span className="warn-tag">서지 미완성 {missingBib.length}건 제외 — <button className="link small" onClick={() => nav.go('references')}>참고문헌에서 보완</button></span>}</li>
              <li>ABSTRACT · 19×26cm 지면, 좌 3cm · 우 2cm, 쪽 번호 아래 가운데</li>
            </ol>
            <div className="btn-group">
              <button className="btn btn-primary" onClick={() => exportHwpx(false)} disabled={!!busy}>HWPX 내려받기</button>
              <button className="btn" onClick={() => exportHwpx(true)} disabled={!!busy || !conn.drive} title={conn.drive ? '' : '연구 설정에서 Drive 연결'}>
                {busy === 'drive' ? '저장 중…' : '☁ Drive "AI 생성" 폴더에 저장'}
              </button>
              <button className="btn" onClick={() => downloadFile(`${safeFileName(title)}_원고.json`, JSON.stringify(doc(), null, 2), 'application/json')}>원고 JSON (스킬용)</button>
            </div>
            <p className="muted small">AI가 쓴 원고는 초안입니다. 인용·사실관계를 원문과 대조하고, 한글에서 목차 쪽수와 표지 줄 간격을 확인한 뒤 제출하세요.</p>
          </Card>

          <OutputList kinds={['목차 제안', '집필 초안', '학위논문 HWPX']} title="집필 기록 (AI 결과물)" />
        </div>
      </div>
    </>
  );
}
