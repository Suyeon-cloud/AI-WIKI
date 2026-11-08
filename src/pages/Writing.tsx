import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiOutputKind, Material, PaperType, ThesisChapter, ThesisDraft } from '../types';
import { useStore, useProject } from '../store';
import SKILL_MD from '../../.claude/skills/hufs-thesis-writing/SKILL.md?raw';
import JOURNAL_SKILL_MD from '../../.claude/skills/journal-article-writing/SKILL.md?raw';
import { AI_MODEL_LABEL, AiError, generate } from '../lib/ai';
import { buildThesisHwpx, sectionsOf, type ThesisDoc } from '../lib/hwpx';
import { checkBib, formatCitation, segsToText, sortForStyle } from '../lib/citation';
import { checkCitations, type CiteReport } from '../lib/cite-check';
import { checkFootnotes } from '../lib/footnotes';
import { downloadFile, safeFileName, uid } from '../lib/utils';
import { ABSTRACT_SCHEMA, CHAPTER_SCHEMA, OUTLINE_SCHEMA, thesisContext } from '../lib/prompts';
import { saveOutputToDrive } from '../lib/sync';
import { Card, Empty, NeedProject, PageHeader, StatusBadge } from '../components/ui';
import { OutputList } from '../components/Outputs';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';

/** 스킬 파일의 frontmatter를 뺀 본문 = AI 집필 시스템 지침 */
const SKILL = SKILL_MD.replace(/^---[\s\S]*?---\s*/, '');
const JOURNAL_SKILL = JOURNAL_SKILL_MD.replace(/^---[\s\S]*?---\s*/, '');

const JOURNAL_OUTLINE: { title: string; sections: string[] }[] = [
  { title: 'Ⅰ. 서론', sections: [] },
  { title: 'Ⅱ. 이론적 배경 및 선행연구', sections: ['1. 주요 개념 및 이론', '2. 선행연구 검토'] },
  { title: 'Ⅲ. 연구 방법', sections: ['1. 연구 대상 및 자료', '2. 분석 방법 및 절차'] },
  { title: 'Ⅳ. 연구 결과', sections: ['1. 분석 결과', '2. 결과 해석'] },
  { title: 'Ⅴ. 논의 및 결론', sections: ['1. 논의', '2. 결론 및 제언'] },
];

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
  // 인용 점검: 참고문헌 = 출력에 들어가는 목록(근거 자료 중 서지 완성)과 같은 기준
  const citeReport = useMemo(
    () => (t ? checkCitations(t.chapters, materials, new Set(basis.filter((m) => checkBib(m).complete).map((m) => m.id)), new Set(basis.map((m) => m.id))) : null),
    [t?.chapters, materials, basis],
  );
  const insights = outputs.filter((o) => o.kind === '전체 분석');

  if (!project || !t)
    return (
      <>
        <PageHeader title="AI 집필" desc="외대 학위논문 서식으로 원고를 작성합니다." />
        <NeedProject onCreate={nav.newProject} />
      </>
    );

  const set = (patch: Partial<ThesisDraft>) => dispatch({ type: 'thesis', projectId: project.id, patch });
  const isJournal = t.docType === '학술지논문';
  /** 논문 유형 전환: 지금 원고는 보관하고, 그 유형으로 쓰던 원고를 꺼낸다 */
  function switchType(next: PaperType) {
    if (next === (t!.docType ?? '학위논문')) return;
    const s = t!.stash;
    set({
      docType: next,
      chapters: s?.chapters ?? [],
      abstractKo: s?.abstractKo ?? '',
      abstractEn: s?.abstractEn ?? '',
      keywordsEn: s?.keywordsEn ?? '',
      stash: { chapters: t!.chapters, abstractKo: t!.abstractKo, abstractEn: t!.abstractEn, keywordsEn: t!.keywordsEn },
    });
    setActive(s?.chapters[0]?.id ?? null);
    setTodo({});
  }
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
      return await generate<T>({ system: isJournal ? JOURNAL_SKILL : SKILL, content: o.content, schema: o.schema as Record<string, unknown>, maxTokens: o.maxTokens, onProgress: setChars, signal: ctrl.current.signal });
    } finally {
      setBusy(null);
    }
  }

  const context = () => thesisContext(project!, title, outline, basis, insight, isJournal ? (t!.journalName ?? '') : undefined);

  async function suggestOutline() {
    if (!needAi()) return;
    try {
      const { data, model } = await call<{ chapters: { title: string; sections: string[] }[]; rationale: string }>('outline', {
        content: `${context()}\n\n위 연구 주제와 자료에 맞는 ${isJournal ? '학술지 투고 논문' : `외대 ${project!.degree} 학위논문`} 목차(장·절)를 제안하라. 현재 목차가 있으면 다듬어라.`,
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
        content: `${context()}

${others ? `[이미 쓴 다른 장 (앞부분)]\n${others}\n` : ''}
[이번에 쓸 장] ${c.title}
[절 구성] ${c.sections.filter((s) => s.trim()).join(' / ') || '(절을 적절히 구성)'}
[분량] 공백 포함 약 ${length.toLocaleString()}자

위 장의 본문을 ${isJournal ? '학술지 논문' : '외대 학위논문'} 문체와 원고 출력 형식(절은 '## ', 항은 '### ')으로 써라.`,
        schema: CHAPTER_SCHEMA,
        maxTokens: 32000,
      });
      setChapter(c.id, { text: data.text, citedIds: data.citedIds });
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
      docType: t!.docType ?? '학위논문',
      journal: t!.journalName,
      affiliation: t!.affiliation,
    };
  }

  async function exportHwpx(toDrive: boolean) {
    if (!t!.chapters.length) return toast('목차와 본문을 먼저 작성하세요.', 'info');
    const bytes = buildThesisHwpx(doc());
    const label = isJournal ? '학술지논문' : `${project!.degree}학위논문`;
    const name = `${safeFileName(title)}_${label}.hwpx`;
    const blob = new Blob([bytes], { type: 'application/hwp+zip' });
    const output = {
      id: uid(),
      projectId: project!.id,
      kind: (isJournal ? '학술지논문 HWPX' : '학위논문 HWPX') as AiOutputKind,
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
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '내보내기', text: `${label} HWPX를 내려받았습니다 (${name}).` } });
      toast('HWPX 파일을 내려받았습니다. 한글에서 열어 쪽 번호·목차 쪽수를 확인하세요.');
      return;
    }
    setBusy('drive');
    try {
      const r = await saveOutputToDrive(output, project!, { blob, name, mime: 'application/hwp+zip' });
      const md = await saveOutputToDrive(output, project!);
      dispatch({ type: 'addOutput', output: { ...output, driveFileId: md.fileId, driveSyncedAt: new Date().toISOString() } });
      if (!project!.driveFolderId) dispatch({ type: 'updateProject', id: project!.id, patch: { driveFolderId: r.folderId, driveCreatedAt: new Date().toISOString() } });
      dispatch({ type: 'log', event: { projectId: project!.id, kind: '내보내기', text: `${label} HWPX를 Drive 'AI 생성' 폴더에 저장했습니다.` } });
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
        desc="논문 유형과 목차를 정하면 모은 자료를 근거로 장별 원고를 쓰고, 해당 유형의 형식에 맞춰 HWPX로 출력합니다."
        badges={<><StatusBadge s="ai">{AI_MODEL_LABEL}</StatusBadge><span className="chip chip-strong">스킬: {isJournal ? 'journal-article-writing' : 'hufs-thesis-writing'}</span></>}
      />

      <div className="tabs analysis-tabs paper-tabs" role="tablist">
        <button role="tab" aria-selected={!isJournal} className={!isJournal ? 'active' : ''} onClick={() => switchType('학위논문')} disabled={!!busy}>
          <b>학위논문</b>
          <small>한국외대 학위논문 서식 · 표지·심사청구서·인정서 포함</small>
        </button>
        <button role="tab" aria-selected={isJournal} className={isJournal ? 'active' : ''} onClick={() => switchType('학술지논문')} disabled={!!busy}>
          <b>학술지논문</b>
          <small>투고 원고 형식 · 제목·초록·본문·참고문헌 · 유형별 원고는 따로 보관</small>
        </button>
      </div>

      <div className="writing-layout">
        <div className="writing-side">
          <Card title={isJournal ? '논문 정보' : '논문 정보 (표지·심사청구서)'} extra={<button className="link small" onClick={() => nav.editProject(project)}>{isJournal ? '저자 정보 수정' : '학과·지도교수 수정'}</button>}>
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
            {isJournal ? (
              <>
                <label className="field">
                  <span className="field-label">투고 학술지</span>
                  <input value={t.journalName ?? ''} onChange={(e) => set({ journalName: e.target.value })} placeholder="미정이면 비워 두세요" />
                </label>
                <label className="field">
                  <span className="field-label">저자 소속</span>
                  <input value={t.affiliation ?? ''} onChange={(e) => set({ affiliation: e.target.value })} placeholder="예: 한국외국어대학교 대학원 석사과정" />
                </label>
                <dl className="meta small-meta">
                  <dt>저자</dt><dd>{project.student || <span className="warn-tag">미입력</span>}</dd>
                </dl>
              </>
            ) : (
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
            )}
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
                <button className="btn btn-sm" onClick={() => { set({ chapters: toChapters(isJournal ? JOURNAL_OUTLINE : DEFAULT_OUTLINE, t.chapters) }); setActive(null); }} disabled={!!busy}>기본 목차</button>
                <button className="btn btn-sm btn-ai" onClick={suggestOutline} disabled={!!busy}>{busy === 'outline' ? '제안 중…' : 'AI 목차 제안'}</button>
              </div>
            }
          >
            {t.chapters.length === 0 ? (
              <Empty>{isJournal ? '투고 계획에 맞는 목차를 입력하거나' : '지도교수와 협의한 목차를 입력하거나'} 기본 목차·AI 제안으로 시작하세요.</Empty>
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

          {citeReport && <CiteCheckCard report={citeReport} chapters={t.chapters} onFix={() => nav.go('references')} />}
          <FootnoteCard chapters={t.chapters} />

          <Card title={isJournal ? '출력 — 학술지 투고 원고 HWPX' : '출력 — 한국외대 학위논문 서식 HWPX'}>
            <ol className="export-steps">
              {isJournal ? (
                <>
                  <li>제목 · 저자 · 소속 · 국문초록 · 주제어</li>
                  <li>본문 {t.chapters.length}개 장</li>
                </>
              ) : (
                <>
                  <li>겉표지 · 속표지 · 심사청구서(지도교수) · 인정서(심사위원 {project.degree === '박사' ? 5 : 3}인)</li>
                  <li>국문초록 · 목차 · 본문 {t.chapters.length}개 장</li>
                </>
              )}
              <li>참고문헌 {refs.length}건 (APA 7, 국문→외국 문헌 순){missingBib.length > 0 && <span className="warn-tag">서지 미완성 {missingBib.length}건 제외 — <button className="link small" onClick={() => nav.go('references')}>참고문헌에서 보완</button></span>}</li>
              {isJournal ? <li>영문 제목 · Abstract · Keywords · A4 지면, 좌우 3cm, 쪽 번호 아래 가운데</li> : <li>ABSTRACT · 19×26cm 지면, 좌 3cm · 우 2cm, 쪽 번호 아래 가운데</li>}
            </ol>
            <div className="btn-group">
              <button className="btn btn-primary" onClick={() => exportHwpx(false)} disabled={!!busy}>HWPX 내려받기</button>
              <button className="btn" onClick={() => exportHwpx(true)} disabled={!!busy || !conn.drive} title={conn.drive ? '' : '연구 설정에서 Drive 연결'}>
                {busy === 'drive' ? '저장 중…' : '☁ Drive "AI 생성" 폴더에 저장'}
              </button>
              <button className="btn" onClick={() => downloadFile(`${safeFileName(title)}_원고.json`, JSON.stringify(doc(), null, 2), 'application/json')}>원고 JSON (스킬용)</button>
            </div>
            <p className="muted small">
              {isJournal
                ? 'AI가 쓴 원고는 초안입니다. 인용·사실관계를 원문과 대조하고, 투고 학술지 규정에 맞게 한글에서 글꼴·여백·분량을 조정한 뒤 투고하세요.'
                : 'AI가 쓴 원고는 초안입니다. 인용·사실관계를 원문과 대조하고, 한글에서 목차 쪽수와 표지 줄 간격을 확인한 뒤 제출하세요.'}
            </p>
          </Card>

          <OutputList kinds={['목차 제안', '집필 초안', '학위논문 HWPX', '학술지논문 HWPX']} title="집필 기록 (AI 결과물)" />
        </div>
      </div>
    </>
  );
}

/** 각주 입력 예시와 점검 (경고만, 출력은 막지 않음). 각주는 HWPX에서 한글 각주로 바뀐다. */
function FootnoteCard({ chapters }: { chapters: ThesisChapter[] }) {
  const { count, issues } = useMemo(() => checkFootnotes(chapters), [chapters]);
  return (
    <Card title="각주" extra={<span className="muted small">HWPX에서 한글 각주로 출력</span>}>
      <p className="small">
        본문에 <code>[^1]</code>을 넣고, 같은 장 아무 줄에 <code>[^1]: 각주 내용</code>을 쓰세요. 번호는 문서 전체에서 1부터 자동으로 매겨집니다.
      </p>
      <pre className="footnote-example">{'이 점은 선행연구에서도 지적되었다.[^1]\n\n[^1]: 홍길동(2020), 45쪽 참고.'}</pre>
      <p className="small">
        각주 {count}개
        {issues.length ? <span className="warn-tag">확인할 항목 {issues.length}건</span> : count ? <span className="ok-tag">문제 없음</span> : null}
      </p>
      {issues.length > 0 && (
        <ul className="cite-check">
          {issues.map((x, i) => (
            <li key={i}>
              <code>[^{x.label}]</code> {x.kind} <span className="muted small">— {x.chapter}{x.kind === '정의 없음' || x.kind === '내용 없음' ? ' · 각주로 바꾸지 않고 글자로 남음' : x.kind === '중복 정의' ? ' · 처음 정의를 사용' : x.kind === '여러 번 참조' ? ' · 참조마다 같은 내용의 각주가 생김' : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** 본문 인용 ↔ 참고문헌 점검 결과. 확인용 경고만 보여 주고 출력은 막지 않는다. */
function CiteCheckCard({ report: r, chapters, onFix }: { report: CiteReport; chapters: ThesisChapter[]; onFix: () => void }) {
  const chapterTitle = (id: string) => chapters.find((c) => c.id === id)?.title ?? '';
  const issues = r.citedNotInRefs.length + r.refsNotCited.length + r.unmatched.length + r.needsCheck.length + r.aiMismatch.length;
  if (!chapters.some((c) => c.text.trim()))
    return (
      <Card title="인용 점검">
        <p className="muted small">본문을 작성하면 인용과 참고문헌의 일치 여부를 점검합니다.</p>
      </Card>
    );
  return (
    <Card title="인용 점검" extra={<span className="muted small">확인용 — 출력은 막지 않습니다</span>}>
      <p className="small">
        본문 인용 {r.citations.length}건 · 자료와 연결 {r.citations.filter((c) => c.status === 'matched').length}건
        {issues ? <span className="warn-tag">확인할 항목 {issues}건</span> : <span className="ok-tag">발견된 문제 없음</span>}
      </p>
      {r.citedNotInRefs.length > 0 && (
        <details className="cite-check" open>
          <summary>본문에 인용됐지만 참고문헌에 없는 자료 {r.citedNotInRefs.length}건</summary>
          <ul>{r.citedNotInRefs.map(({ material, reason }) => <li key={material.id}>{material.title} <span className="muted small">— {reason}</span></li>)}</ul>
          <button className="link small" onClick={onFix}>참고문헌에서 보완</button>
        </details>
      )}
      {r.refsNotCited.length > 0 && (
        <details className="cite-check">
          <summary>참고문헌에만 있는 자료 {r.refsNotCited.length}건 (본문 인용을 찾지 못함)</summary>
          <ul>{r.refsNotCited.map((m) => <li key={m.id}>{m.title}</li>)}</ul>
        </details>
      )}
      {r.unmatched.length > 0 && (
        <details className="cite-check">
          <summary>자료와 연결되지 않는 인용 {r.unmatched.length}건</summary>
          <ul>{r.unmatched.map((c, i) => <li key={i}>{c.raw} <span className="muted small">— {chapterTitle(c.chapterId)}{c.note ? ` · ${c.note}` : ''}</span></li>)}</ul>
        </details>
      )}
      {r.needsCheck.length > 0 && (
        <details className="cite-check">
          <summary>확인 필요 {r.needsCheck.length}건 (후보가 여럿이거나 인용인지 불확실)</summary>
          <ul>{r.needsCheck.map((c, i) => <li key={i}>{c.raw} <span className="muted small">— {chapterTitle(c.chapterId)} · {c.note ?? (c.status === 'unmatched' ? '해당 자료를 찾지 못함 (인용이 아닐 수 있음)' : '확인 필요')}</span></li>)}</ul>
        </details>
      )}
      {r.aiMismatch.length > 0 && (
        <details className="cite-check">
          <summary>AI 인용 기록과 본문이 다른 장 {r.aiMismatch.length}개</summary>
          <ul>
            {r.aiMismatch.map((x) => (
              <li key={x.chapterId}>
                <b>{x.chapterTitle}</b>
                {x.missingInText.length > 0 && <div className="small">AI가 인용했다고 했지만 본문에서 찾지 못함: {x.missingInText.map((m) => m.title).join(', ')}</div>}
                {x.notInAi.length > 0 && <div className="small">본문에 있지만 AI 기록에 없음: {x.notInAi.map((m) => m.title).join(', ')}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">인용은 첫 저자와 연도로 찾습니다. 저자 표기가 다르거나 확실하지 않은 경우는 추측하지 않고 '확인 필요'로 둡니다.</p>
    </Card>
  );
}
