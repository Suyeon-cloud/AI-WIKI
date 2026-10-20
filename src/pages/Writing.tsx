import { useState } from 'react';
import { useStore } from '../store';
import { OUTLINES } from '../data/sample';
import { downloadFile, escapeHtml, formatDate, safeFileName, uid, wrapHtml } from '../lib/utils';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import type { WritingState } from '../types';

const DOC_TYPES = ['분석 보고서', '학술논문', '학위논문', '강의노트'];
const DEPTHS = ['초급', '중급', '고급', '전문가'];

const DEPTH_TONE: Record<string, string> = {
  초급: '핵심 개념을 쉬운 용어로 풀어',
  중급: '개념과 사례를 균형 있게 연결하여',
  고급: '선행 논의와의 관계를 비판적으로 검토하며',
  전문가: '이론적 쟁점과 방법론적 한계를 함께 논의하며',
};

export function Writing() {
  const { state, dispatch, toast } = useStore();
  const w = state.writing;
  const s = state.settings;
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<WritingState>) => dispatch({ type: 'writing', patch });

  const basis = state.materials.filter((m) => m.relevance >= 4).slice(0, 3);

  const pushHistory = (label: string, text: string, extra: Partial<WritingState> = {}) =>
    set({
      text,
      history: [{ id: uid(), at: new Date().toISOString(), label, text }, ...w.history].slice(0, 20),
      ...extra,
    });

  const demo = (key: string, fn: () => void) => {
    setBusy(key);
    setTimeout(() => {
      fn();
      setBusy(null);
    }, 700);
  };

  function recommendOutline() {
    demo('outline', () => {
      const outline = OUTLINES[w.docType] ?? OUTLINES['학술논문'];
      set({ outline, selectedSection: outline[0] });
      toast('샘플 목차를 표시했습니다. (Demo)', 'info');
    });
  }

  function draft() {
    if (!w.selectedSection) return toast('먼저 목차를 추천받고 작성할 챕터/절을 선택하세요.', 'error');
    demo('draft', () => {
      const refs = basis.map((m) => `「${m.title}」`).join(', ') || '라이브러리 자료';
      const text = [
        `${w.selectedSection}`,
        '',
        `[Demo 샘플 문단 — 실제 AI 생성 결과가 아닙니다]`,
        '',
        `본 절에서는 "${s.topic}"의 맥락에서 ${DEPTH_TONE[w.depth]} 서술한다. ` +
          `${s.keywords[0]}은(는) ${s.keywords[2]} 속 언어·문화 정보를 시각적으로 구조화하여 전달하는 수단으로 활용될 수 있으며, ` +
          `${s.keywords[3]}은(는) 콘텐츠 기획, 정보 정리, 시각 요소 초안 구현 단계에서 연구자의 작업을 보조하는 도구로 위치시킬 수 있다.`,
        '',
        `참고 자료로는 ${refs} 등을 검토하였다. 다만 이들 자료의 서지정보는 아직 확인되지 않았으므로 인용 전 원문 확인이 필요하다.`,
        '',
        `(목표 분량: 공백 포함 약 ${w.length.toLocaleString()}자 · ${w.docType} · ${w.depth} — Demo에서는 짧은 샘플만 생성됩니다)`,
      ].join('\n');
      pushHistory(`글 작성 (Demo) — ${w.selectedSection}`, text);
      toast('샘플 초안을 생성했습니다. (Demo)', 'info');
    });
  }

  function rewrite() {
    if (!w.text.trim()) return toast('재작성할 본문이 없습니다.', 'error');
    demo('rewrite', () => {
      const text =
        w.text
          .replace(/할 수 있으며/g, '할 수 있고')
          .replace(/서술한다\./g, '논의한다.')
          .replace(/\[Demo 샘플 문단[^\]]*\]/g, '') +
        `\n\n[Demo 재작성] 문장 연결을 다듬고, "${s.keywords[1]}" 관점의 문장을 보강하는 방향을 예시로 보여 줍니다. ` +
        `예: 이러한 설계는 한국 학습자가 ${s.keywords[2]}의 문화적 맥락을 보다 직관적으로 이해하도록 돕는 ${s.keywords[1]} 개발로 이어질 수 있다.`;
      pushHistory('AI 재작성 (Demo)', text.trim());
      toast('샘플 재작성 결과를 반영했습니다. (Demo)', 'info');
    });
  }

  function feedback() {
    if (!w.text.trim()) return toast('피드백을 받을 본문이 없습니다.', 'error');
    demo('fb', () => {
      const len = w.text.length;
      set({
        feedback: [
          `[논리] 핵심 주장("${s.keywords[0]}의 정보 전달 역할")과 근거 사이에 사례 연결 문장을 추가하면 흐름이 명확해집니다.`,
          `[근거] 현재 본문은 공백 포함 ${len.toLocaleString()}자로 목표 ${w.length.toLocaleString()}자의 ${Math.round((len / w.length) * 100)}% 수준입니다.`,
          '[인용] 참고 자료의 서지정보가 "확인 필요" 상태입니다. 인용 전 저자·연도·발행처를 원문에서 확인하세요.',
          '[표현] "~할 수 있다" 표현이 반복됩니다. 일부는 단정적 서술 또는 근거 제시로 바꾸는 것을 고려하세요.',
        ],
      });
      toast('샘플 피드백을 표시했습니다. (Demo)', 'info');
    });
  }

  function saveManual() {
    pushHistory('직접 수정 저장', w.text);
    toast('현재 본문을 변경 이력에 저장했습니다.');
  }

  function exportHtml() {
    if (!w.text.trim()) return toast('내보낼 본문이 없습니다.', 'error');
    const body =
      `<h1>${escapeHtml(s.topic)}</h1><p><em>${escapeHtml(w.docType)} · ${escapeHtml(w.depth)}</em></p>` +
      (w.outline.length ? `<h2>목차</h2><ul>${w.outline.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ul>` : '') +
      '<h2>본문</h2>' +
      w.text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
    downloadFile(`${safeFileName(s.topic)}-${w.docType}.html`, wrapHtml(s.topic, body), 'text/html');
    toast('HTML 파일을 다운로드했습니다.');
  }

  function exportMd() {
    if (!w.text.trim()) return toast('내보낼 본문이 없습니다.', 'error');
    const md = `---\ntitle: "${s.topic}"\ntype: ${w.docType}\ntags: [${s.keywords.map((k) => `"${k}"`).join(', ')}]\n---\n\n# ${s.topic}\n\n${
      w.outline.length ? `## 목차\n\n${w.outline.map((o) => `- ${o}`).join('\n')}\n\n` : ''
    }## 본문\n\n${w.text}\n`;
    downloadFile(`${safeFileName(s.topic)}-${w.docType}.md`, md, 'text/markdown');
    toast('Markdown 파일을 다운로드했습니다.');
  }

  return (
    <>
      <PageHeader
        title="AI 집필"
        desc="라이브러리 자료와 연구 설정을 바탕으로 목차 구성 → 초안 작성 → 수정 → 피드백 흐름을 지원합니다."
        badges={<><StatusBadge s="demo">AI 생성 Demo</StatusBadge><StatusBadge s="real">편집·이력·내보내기</StatusBadge></>}
      />

      <div className="writing-layout">
        <div className="writing-side">
          <Card title="작성 옵션">
            <div className="field"><span className="field-label">작성 유형</span>
              <div className="seg">
                {DOC_TYPES.map((t) => (
                  <button key={t} className={w.docType === t ? 'active' : ''} onClick={() => set({ docType: t })}>{t}</button>
                ))}
              </div>
            </div>
            <div className="field"><span className="field-label">작성 심도</span>
              <div className="seg">
                {DEPTHS.map((t) => (
                  <button key={t} className={w.depth === t ? 'active' : ''} onClick={() => set({ depth: t })}>{t}</button>
                ))}
              </div>
            </div>
            <div className="field"><span className="field-label">분량 (공백 포함 한글 자수)</span>
              <div className="range-row">
                <input
                  type="range"
                  min={2000}
                  max={20000}
                  step={500}
                  value={w.length}
                  onChange={(e) => set({ length: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={2000}
                  max={20000}
                  step={500}
                  value={w.length}
                  onChange={(e) => set({ length: Number(e.target.value) })}
                  onBlur={() => set({ length: Math.min(20000, Math.max(2000, w.length || 2000)) })}
                />
              </div>
            </div>
            <div className="muted small">기반 자료(관련도 4~5등급): {basis.length ? basis.map((m) => m.title).join(' / ') : '없음'}</div>
          </Card>

          <Card title="목차" extra={<StatusBadge s="demo" />}>
            <button className="btn btn-demo full" onClick={recommendOutline} disabled={busy !== null}>
              {busy === 'outline' ? '추천 중… (Demo)' : '목차 추천 (Demo)'}
            </button>
            {w.outline.length > 0 && (
              <ul className="outline">
                {w.outline.map((o) => (
                  <li key={o}>
                    <button className={w.selectedSection === o ? 'active' : ''} onClick={() => set({ selectedSection: o })}>
                      {o}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="변경 이력" extra={<StatusBadge s="real" />}>
            {w.history.length === 0 ? (
              <p className="muted small">아직 이력이 없습니다.</p>
            ) : (
              <ul className="history">
                {w.history.map((h) => (
                  <li key={h.id}>
                    <div>
                      <b>{h.label}</b>
                      <span className="muted small">
                        {formatDate(h.at)} {new Date(h.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · {h.text.length}자
                      </span>
                    </div>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        set({ text: h.text });
                        toast('선택한 버전으로 되돌렸습니다.');
                      }}
                    >
                      복원
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="writing-main">
          <Card
            title={w.selectedSection ? `본문 — ${w.selectedSection}` : '본문'}
            extra={
              <span className="muted small">
                {w.text.length.toLocaleString()} / {w.length.toLocaleString()}자
              </span>
            }
          >
            <div className="toolbar">
              <button className="btn btn-demo" onClick={draft} disabled={busy !== null}>
                {busy === 'draft' ? '작성 중… (Demo)' : '글 작성 (Demo)'}
              </button>
              <button className="btn btn-demo" onClick={rewrite} disabled={busy !== null}>
                {busy === 'rewrite' ? '재작성 중… (Demo)' : 'AI 재작성 (Demo)'}
              </button>
              <button className="btn btn-demo" onClick={feedback} disabled={busy !== null}>
                {busy === 'fb' ? '검토 중… (Demo)' : '논리·근거·인용 피드백 (Demo)'}
              </button>
              <span className="spacer" />
              <button className="btn" onClick={saveManual} disabled={!w.text.trim()}>
                수정 내용 저장
              </button>
            </div>
            <div className="progress">
              <span style={{ width: `${Math.min(100, (w.text.length / w.length) * 100)}%` }} />
            </div>
            <textarea
              className="editor"
              value={w.text}
              onChange={(e) => set({ text: e.target.value })}
              placeholder="목차를 추천받고 챕터/절을 선택한 뒤 '글 작성 (Demo)'을 누르거나, 직접 작성하세요."
            />
          </Card>

          {w.feedback.length > 0 && (
            <Card title="논리·근거·인용 피드백" extra={<StatusBadge s="demo">Demo 샘플 피드백</StatusBadge>} className="demo-outline">
              <ul className="feedback">{w.feedback.map((f) => <li key={f}>{f}</li>)}</ul>
            </Card>
          )}

          <Card title="출력">
            <div className="btn-group">
              <button className="btn" onClick={exportHtml}>HTML 다운로드</button>
              <button className="btn" onClick={exportMd}>Markdown 다운로드</button>
              <button className="btn btn-disabled-look" onClick={() => toast('HWPX 출력은 연동 예정입니다. 현재는 파일이 생성되지 않습니다.', 'info')}>
                HWPX 출력 <StatusBadge s="planned" />
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
