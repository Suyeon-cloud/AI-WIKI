import { useRef, useState } from 'react';
import type { Material } from '../types';
import { useStore } from '../store';
import { authUser } from '../lib/auth';
import { readPdf } from '../lib/pdf';
import { buildFullText, fullTextMeta } from '../lib/fulltext';
import { deleteFullText, saveFullText } from '../lib/fulltext-store';
import { formatDate } from '../lib/utils';
import { Card } from './ui';

const MAX_PDF_BYTES = 60 * 1024 * 1024;
const MAX_PAGES = 400;

/**
 * 논문 PDF 원문 등록 — 텍스트 추출과 장·절 분할은 이 브라우저에서만 한다 (AI 호출 없음).
 * 원문은 자료 JSON이 아니라 원문 보관소(IndexedDB, 가능하면 Storage)에 저장한다.
 */
export function FullTextPanel({ m }: { m: Material }) {
  const { dispatch, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ft = m.fulltext;

  async function register(file: File | undefined) {
    if (!file) return;
    const userId = authUser()?.id;
    if (!userId) return toast('로그인한 뒤 원문을 등록할 수 있습니다.', 'error');
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return toast('PDF 파일만 등록할 수 있습니다.', 'error');
    if (file.size > MAX_PDF_BYTES) return toast('PDF가 너무 큽니다 (60MB 이하).', 'error');
    setBusy('PDF에서 텍스트를 추출하는 중…');
    try {
      const pdf = await readPdf(file, MAX_PAGES);
      if (pdf.pages.join('').replace(/\s/g, '').length < 500)
        return toast('추출된 글자가 거의 없습니다. 스캔 이미지 PDF는 OCR로 텍스트를 만든 뒤 등록하세요.', 'error');
      const doc = buildFullText(m.id, file.name, pdf.pages, pdf.numPages);
      setBusy('원문을 저장하는 중…');
      const r = await saveFullText(userId, doc);
      dispatch({ type: 'update', id: m.id, patch: { fulltext: fullTextMeta(doc, r.cloud) } });
      const cut = pdf.numPages > MAX_PAGES ? ` (앞 ${MAX_PAGES}쪽만 추출)` : '';
      toast(r.cloud ? `원문을 등록했습니다: ${doc.sections.length}개 절${cut}` : `원문을 등록했습니다${cut}. ${r.cloudError}`, r.cloud ? 'success' : 'info');
    } catch (e) {
      toast(`원문을 등록하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
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
    <Card title="논문 원문 (PDF)" extra={ft ? <span className="ok-tag">원문 등록됨</span> : <span className="muted small">초록 기반 분석만 가능</span>}>
      {ft ? (
        <p className="small">
          {ft.fileName} · {ft.pages}쪽 · {ft.chars.toLocaleString()}자 · {ft.sections}개 절 · {formatDate(ft.savedAt)} 등록 ·{' '}
          {ft.cloud ? '클라우드에 보관' : <span className="warn-tag">이 기기에만 보관</span>}
          <br />
          <span className="muted">원문 기반 분석 시 이 원문 전체가 아니라 관련 장·절 최대 24,000자만 AI에 전송합니다.</span>
        </p>
      ) : (
        <p className="muted small">PDF를 등록하면 이 브라우저에서 글자를 추출하고 장·절로 나눕니다. 원문 기반 분석은 PDF 전체가 아니라 초록·서론·결론과 주제 관련 장·절을 골라 최대 24,000자만 AI에 보냅니다 (참고문헌 제외).</p>
      )}
      <div className="actions">
        <label className={`btn btn-sm ${busy ? 'disabled' : ''}`}>
          {ft ? 'PDF 다시 등록' : 'PDF 원문 등록'}
          <input ref={input} type="file" hidden accept="application/pdf,.pdf" disabled={!!busy} onChange={(e) => void register(e.target.files?.[0])} />
        </label>
        {ft && <button className="btn btn-sm" onClick={() => void remove()} disabled={!!busy}>원문 지우기</button>}
        {busy && <span className="muted small">{busy}</span>}
      </div>
    </Card>
  );
}
