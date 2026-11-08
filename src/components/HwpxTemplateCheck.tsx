import { useState } from 'react';
import { analyzeTemplate, TEMPLATE_LIMITS, TemplateError, type TemplateAnalysis } from '../lib/hwpx-template';

/**
 * 양식 HWPX 분석 (1단계). 파일은 이 화면의 메모리에서만 읽고 서버·DB·브라우저 저장소에 보관하지 않는다.
 * 분석 결과만 보여 주며, HWPX 출력에는 아직 적용하지 않는다.
 */
export function HwpxTemplateCheck() {
  const [result, setResult] = useState<TemplateAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    setResult(null);
    setError(null);
    if (!file) return;
    if (file.size > TEMPLATE_LIMITS.fileBytes) return setError('파일이 5MB를 넘습니다.');
    setBusy(true);
    try {
      setResult(await analyzeTemplate(file.name, new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      setError(e instanceof TemplateError ? e.message : '양식 파일을 읽지 못했습니다. 한글에서 HWPX로 다시 저장해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const mmText = (v: number | null) => (v === null ? '?' : `${v}mm`);
  return (
    <details className="template-check">
      <summary>양식 HWPX 분석 (미리 보기 · 출력에는 아직 적용되지 않음)</summary>
      <p className="muted small">
        학교·학술지 양식 .hwpx(최대 5MB)를 고르면 스타일과 쪽 설정을 분석합니다. 파일은 이 화면에서만 읽고 서버에 올리거나 저장하지 않습니다.
      </p>
      <input type="file" accept=".hwpx" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="양식 HWPX 파일 선택" />
      {busy && <p className="small">분석 중…</p>}
      {error && <p className="notice err" role="alert">{error}</p>}
      {result && (
        <div className="template-result">
          <p className="small">
            <b>{result.fileName}</b> · {(result.fileBytes / 1024).toFixed(0)}KB · 스타일 {result.counts.styles}개 · 글자 모양 {result.counts.charPr}개 · 문단 모양 {result.counts.paraPr}개 · 글꼴 묶음 {result.counts.fontfaces}개
          </p>
          <table className="table template-map">
            <thead><tr><th>역할</th><th>연결된 양식 스타일</th><th>상태</th></tr></thead>
            <tbody>
              {result.mapping.map((m) => (
                <tr key={m.role}>
                  <td>{m.label}</td>
                  <td>{m.style ? `${m.style.name || m.style.engName}${m.style.engName && m.style.name ? ` (${m.style.engName})` : ''}` : '—'}</td>
                  <td>{m.style ? <span className="ok-tag">양식 사용 예정</span> : <span className="warn-tag">내장 서식으로 대체 예정</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            쪽 설정:{' '}
            {result.page
              ? `${mmText(result.page.widthMm)} × ${mmText(result.page.heightMm)} · 여백 좌 ${mmText(result.page.margins.left)} 우 ${mmText(result.page.margins.right)} 위 ${mmText(result.page.margins.top)} 아래 ${mmText(result.page.margins.bottom)}`
              : '찾지 못함 (내장 설정 사용 예정)'}
            {' · '}각주 번호: {result.footnote ? `${result.footnote.numberType ?? '?'}${result.footnote.suffix ?? ''}` : '찾지 못함'}
          </p>
          {result.warnings.length > 0 && <ul className="cite-check">{result.warnings.map((w) => <li key={w} className="small">{w}</li>)}</ul>}
        </div>
      )}
    </details>
  );
}
