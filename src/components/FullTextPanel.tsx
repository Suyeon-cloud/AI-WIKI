import { useRef, useState } from 'react';
import type { Material } from '../types';
import { useStore } from '../store';
import { authUser } from '../lib/auth';
import { readPdf } from '../lib/pdf';
import { EXTRACTOR_VERSION, buildFullText, fullTextMeta } from '../lib/fulltext';
import { deleteFullText, loadPdf, saveFullText, savePdf } from '../lib/fulltext-store';
import { formatDate } from '../lib/utils';
import { Card } from './ui';

const MAX_PDF_BYTES = 60 * 1024 * 1024;
// 학위논문은 결론·한계가 뒤쪽(400쪽 이후)에 있을 수 있으므로 넉넉히 (파일 크기 상한 60MB가 함께 제한)
const MAX_PAGES = 1000;

/** 원문이 오래된 추출 방식이거나 품질 점검에서 문제가 있으면 그 이유 */
export function fullTextWarnings(m: Material): string[] {
  const ft = m.fulltext;
  if (!ft) return [];
  const w: string[] = [];
  if ((ft.extractorVersion ?? 1) < EXTRACTOR_VERSION) w.push('이전 추출 방식으로 등록된 원문입니다 (한글 누락·장·절과 쪽 범위 인식 오류가 있을 수 있음). 다시 추출을 권합니다.');
  if (ft.quality?.level === 'low') w.push(...ft.quality.reasons.map((r) => `추출 품질 낮음: ${r}`));
  return w;
}

/**
 * 논문 PDF 원문 등록 — 텍스트 추출과 장·절 분할은 이 브라우저에서만 한다 (AI 호출 없음).
 * 원문은 자료 JSON이 아니라 원문 보관소(IndexedDB, 가능하면 Storage)에 저장하고, 다시 추출할 수 있도록 PDF도 이 기기에 보관한다.
 */
export function FullTextPanel({ m }: { m: Material }) {
  const { dispatch, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ft = m.fulltext;
  const warnings = fullTextWarnings(m);

  async function extract(file: Blob, fileName: string, keepPdf: boolean) {
    const userId = authUser()?.id;
    if (!userId) return toast('로그인한 뒤 원문을 등록할 수 있습니다.', 'error');
    setBusy('PDF에서 텍스트를 추출하는 중…');
    try {
      const pdf = await readPdf(file, MAX_PAGES);
      if (pdf.pages.join('').replace(/\s/g, '').length < 500)
        return toast('추출된 글자가 거의 없습니다. 스캔 이미지 PDF는 OCR로 텍스트를 만든 뒤 등록하세요.', 'error');
      // 제목·초록이 한국어면 본문에도 한글이 있어야 한다 (한글 누락 점검)
      const expectHangul = /[가-힣]/.test(`${m.title} ${m.abstract ?? ''}`);
      const doc = buildFullText(m.id, fileName, pdf.pages, pdf.numPages, new Date(), { expectHangul });
      setBusy('원문을 저장하는 중…');
      const r = await saveFullText(userId, doc);
      if (keepPdf) await savePdf(userId, m.id, file);
      dispatch({ type: 'update', id: m.id, patch: { fulltext: fullTextMeta(doc, r.cloud) } });
      const cut = pdf.numPages > MAX_PAGES ? ` (앞 ${MAX_PAGES}쪽만 추출)` : '';
      const low = doc.quality?.level === 'low' ? ` 추출 품질이 낮습니다: ${doc.quality.reasons.join(', ')}` : '';
      toast(`원문을 추출했습니다: ${doc.sections.length}개 절${cut}.${r.cloud ? '' : ` ${r.cloudError}`}${low}`, low ? 'error' : r.cloud ? 'success' : 'info');
    } catch (e) {
      toast(`원문을 추출하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  function register(file: File | undefined) {
    if (!file) return;
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return toast('PDF 파일만 등록할 수 있습니다.', 'error');
    if (file.size > MAX_PDF_BYTES) return toast('PDF가 너무 큽니다 (60MB 이하).', 'error');
    void extract(file, file.name, true);
  }

  /** 이 기기에 보관한 PDF로 다시 추출. 없으면(이전 버전 등록) PDF를 다시 고르게 한다 */
  async function reextract() {
    const userId = authUser()?.id;
    if (!userId || !ft) return;
    const pdf = await loadPdf(userId, m.id);
    if (!pdf) {
      toast('이 기기에 원본 PDF가 없습니다 (이전 버전에서 등록). 같은 PDF를 다시 선택하면 새 방식으로 추출합니다.', 'info');
      input.current?.click();
      return;
    }
    await extract(pdf, ft.fileName, false);
  }

  async function remove() {
    const userId = authUser()?.id;
    if (!userId || !ft) return;
    if (!window.confirm('등록한 원문을 이 기기와 클라우드 원문 보관소에서 지웁니다. 자료와 분석 결과·연구 기록은 그대로 둡니다. 계속할까요?')) return;
    await deleteFullText(userId, m.id);
    dispatch({ type: 'update', id: m.id, patch: { fulltext: undefined } });
    toast('원문을 지웠습니다.', 'info');
  }

  return (
    <Card title="논문 원문 (PDF)" extra={ft ? (warnings.length ? <span className="warn-tag">원문 확인 필요</span> : <span className="ok-tag">원문 등록됨</span>) : <span className="muted small">초록 기반 분석만 가능</span>}>
      {ft ? (
        <p className="small">
          {ft.fileName} · {ft.pages}쪽 · {ft.chars.toLocaleString()}자 · {ft.sections}개 절 · {formatDate(ft.savedAt)} 추출 ·{' '}
          {ft.cloud ? '클라우드에 보관' : <span className="warn-tag">이 기기에만 보관</span>}
          <br />
          <span className="muted">원문 기반 분석 시 이 원문 전체가 아니라 관련 장·절 최대 24,000자만 AI에 전송합니다.</span>
        </p>
      ) : (
        <p className="muted small">PDF를 등록하면 이 브라우저에서 글자를 추출하고 장·절로 나눕니다. 원문 기반 분석은 PDF 전체가 아니라 초록·서론·결론과 주제 관련 장·절을 골라 최대 24,000자만 AI에 보냅니다 (참고문헌 제외).</p>
      )}
      {warnings.length > 0 && (
        <ul className="warn-list small">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <div className="actions">
        <label className={`btn btn-sm ${busy ? 'disabled' : ''}`}>
          {ft ? '다른 PDF로 등록' : 'PDF 원문 등록'}
          <input ref={input} type="file" hidden accept="application/pdf,.pdf" disabled={!!busy} onChange={(e) => register(e.target.files?.[0])} />
        </label>
        {ft && <button className={`btn btn-sm ${warnings.length ? 'btn-primary' : ''}`} onClick={() => void reextract()} disabled={!!busy}>원문 다시 추출</button>}
        {ft && <button className="btn btn-sm" onClick={() => void remove()} disabled={!!busy}>원문 지우기</button>}
        {busy && <span className="muted small">{busy}</span>}
      </div>
    </Card>
  );
}
