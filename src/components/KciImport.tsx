import { useRef, useState } from 'react';
import type { Material } from '../types';
import { newMaterial, useStore, useProject } from '../store';
import { readPdf } from '../lib/pdf';
import { kciToBib, parseKci, refineWithAi, type KciMeta } from '../lib/kci';
import { aiState } from '../lib/ai';
import { formatSize } from '../lib/utils';
import { normalizeDoi } from '../lib/citation';
import { Modal, StatusBadge } from './ui';

const MAX_CONTENT = 30000; // 브라우저 저장 공간을 고려해 본문은 앞부분만 저장

export interface PdfSource {
  file: Blob;
  name: string;
  size: number;
  from: 'KCI PDF' | 'Google Drive';
}

export interface ReviewItem {
  key: string;
  src: PdfSource;
  meta?: KciMeta;
  text?: string;
  error?: string;
  aiError?: string;
  duplicateOf?: string;
}

/** PDF 목록 → 텍스트·서지 추출 (진행 상황을 하나씩 알림) */
export async function extractPdfs(
  srcs: PdfSource[],
  opts: { useAi: boolean; existing: Material[] },
  onItem: (it: ReviewItem, i: number) => void,
): Promise<ReviewItem[]> {
  const out: ReviewItem[] = [];
  for (const [i, src] of srcs.entries()) {
    const key = `${src.name}-${src.size}-${i}`;
    let it: ReviewItem = { key, src };
    try {
      const pdf = await readPdf(src.file);
      let meta = parseKci(pdf, src.name);
      if (opts.useAi) {
        try {
          meta = await refineWithAi(pdf, meta);
        } catch (e) {
          it.aiError = e instanceof Error ? e.message : String(e);
        }
      }
      const text = pdf.pages.join('\n\n').slice(0, MAX_CONTENT);
      const doi = normalizeDoi(meta.doi);
      const t = meta.title.replace(/\s+/g, '').toLowerCase();
      const dup = opts.existing.find(
        (m) => (doi && normalizeDoi(m.bib?.doi) === doi) || (t.length > 6 && (m.bib?.title ?? m.title).replace(/\s+/g, '').toLowerCase() === t) || (m.fileName === src.name && m.fileSize === src.size),
      );
      it = { ...it, meta, text, duplicateOf: dup?.title };
    } catch (e) {
      it.error = `PDF를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
    }
    out.push(it);
    onItem(it, i);
  }
  return out;
}

function MetaEditor({ meta, onChange }: { meta: KciMeta; onChange: (m: KciMeta) => void }) {
  const set = (k: keyof KciMeta, v: string) =>
    onChange({ ...meta, [k]: k === 'authors' || k === 'keywords' ? v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) : v });
  const field = (k: keyof KciMeta, label: string, wide = false) => (
    <label className={wide ? 'span-2' : ''}>
      {label}
      <input value={Array.isArray(meta[k]) ? (meta[k] as string[]).join(', ') : String(meta[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <div className="form-grid compact-grid">
      {field('title', '논문 제목', true)}
      {field('authors', '저자 (쉼표 구분)', true)}
      {field('journal', '학술지명')}
      {field('publisher', '발행기관(학회)')}
      {field('year', '연도')}
      {field('volume', '권')}
      {field('issue', '호')}
      {field('pages', '쪽 (예: 123-145)')}
      {field('doi', 'DOI', true)}
      {field('keywords', '주제어 (쉼표 구분)', true)}
      <label className="span-2">
        국문 초록
        <textarea rows={4} value={meta.abstractKo} onChange={(e) => set('abstractKo', e.target.value)} />
      </label>
      <label className="span-2">
        영문 초록 (Abstract)
        <textarea rows={3} value={meta.abstractEn} onChange={(e) => set('abstractEn', e.target.value)} />
      </label>
    </div>
  );
}

/** 추출 결과 확인 창 — 체크한 자료만 라이브러리에 넣는다 */
export function KciReview({ items, onClose, onDone }: { items: ReviewItem[]; onClose: () => void; onDone?: (added: Material[]) => void }) {
  const { dispatch, toast } = useStore();
  const { project } = useProject();
  const [rows, setRows] = useState(items);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((x) => x.meta && !x.duplicateOf).map((x) => x.key)));
  const [open, setOpen] = useState<string | null>(items.length === 1 ? items[0].key : null);
  const [saveText, setSaveText] = useState(true);

  const toggle = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  function add() {
    const chosen = rows.filter((r) => r.meta && picked.has(r.key));
    if (!chosen.length) return toast('가져올 자료를 체크하세요.', 'info');
    const ms = chosen.map((r) => {
      const k = r.meta!;
      return newMaterial({
        title: k.title,
        sourceType: 'PDF',
        projectId: project?.id,
        importedFrom: r.src.from === 'Google Drive' ? 'Google Drive' : 'KCI PDF',
        topic: k.journal ? `${k.journal}${k.year ? ` (${k.year})` : ''}` : '',
        keywords: k.keywords.slice(0, 10),
        abstract: [k.abstractKo, k.abstractEn].filter(Boolean).join('\n\n') || undefined,
        content: saveText ? r.text : undefined,
        fileName: r.src.name,
        fileSize: r.src.size,
        mimeType: 'application/pdf',
        url: k.doi ? `https://doi.org/${k.doi}` : undefined,
        bib: kciToBib(k),
        citationIncluded: true,
      });
    });
    dispatch({ type: 'addMany', materials: ms });
    if (project) dispatch({ type: 'log', event: { projectId: project.id, kind: '자료', text: `PDF 논문 ${ms.length}건을 추가했습니다: ${ms.slice(0, 2).map((m) => m.title).join(', ')}${ms.length > 2 ? ' 외' : ''}` } });
    toast(`${ms.length}건을 '${project?.name ?? '미분류'}' 라이브러리에 추가했습니다. 서지사항은 참고문헌 화면에서 다시 확인할 수 있습니다.`);
    onDone?.(ms);
    onClose();
  }

  const okRows = rows.filter((r) => r.meta);
  return (
    <Modal
      title={`가져올 자료 확인 (${rows.length}건)`}
      onClose={onClose}
      wide
      footer={
        <>
          <label className="radio small" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={saveText} onChange={(e) => setSaveText(e.target.checked)} />
            본문 텍스트도 저장 (AI 분석 근거, 논문당 최대 3만 자)
          </label>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" onClick={add} disabled={!picked.size}>
            선택한 {picked.size}건 라이브러리에 추가
          </button>
        </>
      }
    >
      <p className="muted small">
        추출한 서지사항·초록을 확인하세요. 체크한 자료만 <b>{project?.name ?? '미분류'}</b> 폴더에 추가됩니다. 행을 누르면 내용을 고칠 수 있습니다.
      </p>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="link small" onClick={() => setPicked(new Set(okRows.map((r) => r.key)))}>
          모두 선택
        </button>
        <button className="link small" onClick={() => setPicked(new Set())}>
          선택 해제
        </button>
      </div>
      <ul className="review-list">
        {rows.map((r) => (
          <li key={r.key} className={open === r.key ? 'open' : ''}>
            <div className="review-row" onClick={() => r.meta && setOpen(open === r.key ? null : r.key)}>
              <input type="checkbox" disabled={!r.meta} checked={picked.has(r.key)} onChange={() => toggle(r.key)} onClick={(e) => e.stopPropagation()} />
              <div className="review-main">
                <b>{r.meta?.title ?? r.src.name}</b>
                {r.meta ? (
                  <span className="muted small">
                    {[r.meta.authors.join(', ') || '저자 미확인', r.meta.journal || '학술지 미확인', r.meta.year, r.meta.volume && `${r.meta.volume}(${r.meta.issue})`, r.meta.pages && `pp. ${r.meta.pages}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : (
                  <span className="err small">{r.error}</span>
                )}
                <span className="review-tags">
                  <span className="chip chip-muted">{r.src.name} · {formatSize(r.src.size)}</span>
                  {r.meta?.doi && <span className="chip">DOI</span>}
                  {r.meta && <span className={r.meta.abstractKo || r.meta.abstractEn ? 'chip' : 'warn-tag'}>{r.meta.abstractKo || r.meta.abstractEn ? '초록 있음' : '초록 없음'}</span>}
                  {r.meta?.source === 'rule+ai' && <StatusBadge s="ai">AI 보완</StatusBadge>}
                  {r.aiError && <span className="warn-tag" title={r.aiError}>AI 보완 실패</span>}
                  {r.duplicateOf && <span className="warn-tag">중복 의심: {r.duplicateOf}</span>}
                </span>
              </div>
            </div>
            {open === r.key && r.meta && (
              <MetaEditor meta={r.meta} onChange={(meta) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, meta } : x)))} />
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** 자료 수집 화면의 KCI 논문 PDF 카드 */
export function KciImport() {
  const { state } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [useAi, setUseAi] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const ai = aiState().configured;

  async function run(files: File[]) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) return;
    setProgress({ done: 0, total: pdfs.length, name: pdfs[0].name });
    const items = await extractPdfs(
      pdfs.map((f) => ({ file: f, name: f.name, size: f.size, from: 'KCI PDF' as const })),
      { useAi: useAi && ai, existing: state.materials },
      (_it, i) => setProgress({ done: i + 1, total: pdfs.length, name: pdfs[i + 1]?.name ?? '' }),
    );
    setProgress(null);
    if (fileRef.current) fileRef.current.value = '';
    setReview(items);
  }

  return (
    <>
      <div
        className={`dropzone big ${progress ? 'busy' : ''}`}
        onClick={() => !progress && fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!progress) void run(Array.from(e.dataTransfer.files));
        }}
      >
        <input ref={fileRef} type="file" hidden multiple accept=".pdf,application/pdf" onChange={(e) => void run(Array.from(e.target.files ?? []))} />
        {progress ? (
          <>
            <b>
              PDF 읽는 중… {progress.done} / {progress.total}
            </b>
            <span className="muted small">{progress.name}</span>
            <div className="progress" style={{ width: 260 }}>
              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <div className="drop-icon">📄</div>
            <b>KCI 논문 PDF를 끌어다 놓거나 클릭해서 선택</b>
            <span className="muted small">여러 편을 한 번에 넣을 수 있습니다 · 제목·저자·학술지·권호·쪽·DOI·초록·주제어를 추출합니다</span>
          </>
        )}
      </div>
      <label className="radio small" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={useAi && ai} disabled={!ai} onChange={(e) => setUseAi(e.target.checked)} />
        Claude AI로 서지사항·초록 보완 {ai ? '(규칙으로 못 찾은 항목을 AI가 원문에서 다시 찾음)' : '— 연구 설정에서 API 키를 넣으면 사용 가능'}
      </label>
      <p className="muted small">
        PDF는 이 브라우저 안에서만 읽습니다{useAi && ai ? ' (AI 보완 시 앞 4쪽 텍스트만 Claude API로 전송)' : ''}. 원본 PDF 파일은 저장·업로드하지 않습니다.
      </p>
      {review && <KciReview items={review} onClose={() => setReview(null)} />}
    </>
  );
}
