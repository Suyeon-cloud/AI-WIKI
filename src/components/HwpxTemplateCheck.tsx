import { useEffect, useState } from 'react';
import { analyzeTemplate, TEMPLATE_LIMITS, TemplateError, toHwpxTemplate, type TemplateAnalysis } from '../lib/hwpx-template';
import type { HwpxTemplate } from '../lib/hwpx';

/** 이 앱의 규정 지면 (양식 쪽 크기와 비교해 안내) */
const RULE_PAGE = { thesis: { w: 190, h: 260, label: '학위논문 규정 지면(서식 5) 190×260mm' }, journal: { w: 210, h: 297, label: '학술지 원고 A4 210×297mm' } };

/**
 * 양식 HWPX 선택 적용. 파일은 이 화면의 메모리에서만 읽고 서버·DB·브라우저 저장소에 보관하지 않는다.
 * 스타일 적용(기본 켬)과 쪽 설정 적용(기본 끔, 기존 지면 유지)을 고를 수 있다. 아무것도 적용하지 않으면 기존 출력과 같다.
 */
export function HwpxTemplateCheck({ journal, onTemplate }: { journal: boolean; onTemplate: (t: { template: HwpxTemplate; label: string } | null) => void }) {
  const [result, setResult] = useState<TemplateAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useStyles, setUseStyles] = useState(true);
  const [usePage, setUsePage] = useState(false);

  useEffect(() => {
    const template = result ? toHwpxTemplate(result, { styles: useStyles, page: usePage }) : undefined;
    onTemplate(template && result ? { template, label: `${result.fileName} (${[template.header && '스타일', template.page && '쪽 설정'].filter(Boolean).join('·')} 적용)` } : null);
  }, [result, useStyles, usePage, onTemplate]);

  async function pick(file: File | undefined) {
    setResult(null);
    setError(null);
    setUsePage(false);
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

  const rule = journal ? RULE_PAGE.journal : RULE_PAGE.thesis;
  const pageDiffers = !!result?.page && (result.page.widthMm !== rule.w || result.page.heightMm !== rule.h);
  const mmText = (v: number | null) => (v === null ? '?' : `${v}mm`);
  return (
    <details className="template-check" open={!!result}>
      <summary>양식 HWPX 적용 (선택){result ? ` — ${result.fileName}` : ''}</summary>
      <p className="muted small">
        학교·학술지 양식 .hwpx(최대 5MB)를 고르면 연결된 스타일을 HWPX 출력에 적용합니다. 표지·목차의 내용과 배치, 각주·인용·참고문헌 내용은 그대로입니다.
        파일은 이 화면에서만 읽고 서버에 올리거나 저장하지 않습니다(새로고침하면 다시 골라야 합니다).
      </p>
      <div className="template-actions">
        <input type="file" accept=".hwpx" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="양식 HWPX 파일 선택" />
        {result && <button className="link small" onClick={() => { setResult(null); setError(null); }}>양식 해제 (기존 출력)</button>}
      </div>
      {busy && <p className="small">분석 중…</p>}
      {error && <p className="notice err" role="alert">{error}</p>}
      {result && (
        <div className="template-result">
          <p className="small">
            <b>{result.fileName}</b> · {(result.fileBytes / 1024).toFixed(0)}KB · 스타일 {result.counts.styles}개 · 글자 모양 {result.counts.charPr}개 · 문단 모양 {result.counts.paraPr}개
          </p>
          <label className="small template-opt">
            <input type="checkbox" checked={useStyles && result.styleApply.ok} disabled={!result.styleApply.ok} onChange={(e) => setUseStyles(e.target.checked)} /> 양식 스타일 적용 (연결된 역할만)
            {!result.styleApply.ok && <span className="warn-tag">적용 불가: {result.styleApply.reasons.join(', ')}</span>}
          </label>
          <table className="table template-map">
            <thead><tr><th>역할</th><th>연결된 양식 스타일</th><th>출력</th></tr></thead>
            <tbody>
              {result.mapping.map((m) => (
                <tr key={m.role}>
                  <td>{m.label}</td>
                  <td>{m.style ? `${m.style.name || m.style.engName}${m.style.engName && m.style.name ? ` (${m.style.engName})` : ''}` : '—'}</td>
                  <td>{m.style && useStyles && result.styleApply.ok ? <span className="ok-tag">양식 스타일</span> : <span className="warn-tag">내장 서식</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="small template-opt">
            <input type="checkbox" checked={usePage} disabled={!result.pageRaw} onChange={(e) => setUsePage(e.target.checked)} /> 양식 쪽 설정(용지·여백) 적용 — 기본값은 기존 지면 유지
          </label>
          <p className="small">
            양식 쪽 설정:{' '}
            {result.page
              ? `${mmText(result.page.widthMm)} × ${mmText(result.page.heightMm)} · 여백 좌 ${mmText(result.page.margins.left)} 우 ${mmText(result.page.margins.right)} 위 ${mmText(result.page.margins.top)} 아래 ${mmText(result.page.margins.bottom)}`
              : '찾지 못함'}
            {' · '}각주 번호: {result.footnote ? `${result.footnote.numberType ?? '?'}${result.footnote.suffix ?? ''}` : '찾지 못함'}
          </p>
          {pageDiffers && (
            <p className="notice small">
              양식 파일의 쪽 크기가 {rule.label}과 다릅니다. 서식 안내 문서(서식 1~12 모음)처럼 양식 파일 자체의 쪽 크기가 규정과 다를 수 있으니, 규정을 확인한 뒤에만 쪽 설정을 적용하세요.
            </p>
          )}
          {result.warnings.length > 0 && <ul className="cite-check">{result.warnings.map((w) => <li key={w} className="small">{w}</li>)}</ul>}
          <p className="muted small">양식을 적용한 HWPX는 반드시 한글에서 열어 글꼴·간격·쪽 나눔을 확인하세요.</p>
        </div>
      )}
    </details>
  );
}
