import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { readTranscriptNote } from '../lib/importers';
import { KIND_LABEL } from '../lib/yt-transcript';
import {
  YT_FIELD_LABEL,
  YT_SKIP_LABEL,
  planTranscriptEnrich,
  summarizeTranscript,
  transcriptPatch,
  type YtField,
  type YtPlan,
  type YtSkipReason,
} from '../lib/yt-enrich';
import { Card, Modal } from './ui';

const MAX_FILES = 500;
const PREVIEW = 400;
const FIELDS: YtField[] = ['content', 'url', 'year'];

/**
 * 로컬 yt-dlp로 만든 YouTube 자막 노트(.md)로 기존 YouTube 자료의 빈 본문·URL·게시연도를 채운다.
 * youtube_id가 같은 자료와 1:1로만 짝짓고, 승인·저장 전 확인을 거쳐 기존 자료 수정 경로로 반영한다.
 */
export function YoutubeEnrich() {
  const { state, dispatch, toast } = useStore();
  const [plan, setPlan] = useState<YtPlan | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Record<string, Set<YtField>>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => /\.(md|markdown)$/i.test(f.name));
    if (!files.length) return toast('Markdown(.md) 자막 노트를 고르세요.', 'info');
    if (files.length > MAX_FILES) return toast(`한 번에 ${MAX_FILES}개까지 확인할 수 있습니다.`, 'error');
    setBusy(true);
    try {
      const read = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      const p = planTranscriptEnrich(state.materials, read, readTranscriptNote);
      setPlan(p);
      setApproved(new Set());
      setFields(Object.fromEntries(p.rows.map((r) => [r.material.id, new Set(r.changes.map((c) => c.field))])));
      setOpen(null);
    } catch (e) {
      toast(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const rows = plan?.rows ?? [];
  const unmatched = (plan?.skipped ?? []).filter((s) => s.reason === 'unmatched');
  const skippedBy = useMemo(() => {
    const g = new Map<YtSkipReason, number>();
    for (const s of plan?.skipped ?? []) g.set(s.reason, (g.get(s.reason) ?? 0) + 1);
    return [...g.entries()];
  }, [plan]);
  const summary = useMemo(() => summarizeTranscript(rows, approved, fields), [rows, approved, fields]);

  const toggle = (id: string) =>
    setApproved((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleField = (id: string, f: YtField) =>
    setFields((all) => {
      const n = new Set(all[id]);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return { ...all, [id]: n };
    });

  function apply() {
    let n = 0;
    for (const r of rows) {
      if (!approved.has(r.material.id)) continue;
      const cur = state.materials.find((m) => m.id === r.material.id);
      if (!cur) continue;
      const patch = transcriptPatch(cur, r.changes.filter((c) => fields[r.material.id]?.has(c.field)));
      if (!Object.keys(patch).length) continue;
      dispatch({ type: 'update', id: cur.id, patch });
      n++;
    }
    setConfirming(false);
    toast(`${n}건의 YouTube 자료에 자막을 보완했습니다.`);
    setPlan(null);
    setApproved(new Set());
  }

  return (
    <Card title="YouTube 자막 보완" extra={<span className="ok-tag">빈 필드만 채움</span>}>
      <p className="muted small">
        로컬 PC에서 <code>npm run yt:transcript -- &lt;YouTube URL&gt;</code>로 만든 자막 노트(.md)를 고르면, <b>같은 영상 ID(youtube_id)의 기존 YouTube 자료</b>와 1:1로 짝지어
        비어 있는 본문·URL·게시연도만 채웁니다. 메모·내 관점·AI 분석 결과는 바꾸지 않습니다.
      </p>
      <div className="clip-pick">
        <label className="btn btn-sm">
          자막 노트 선택
          <input type="file" hidden multiple accept=".md,.markdown" onChange={(e) => { void load(e.target.files); e.target.value = ''; }} disabled={busy} />
        </label>
        {busy && <span className="muted small">파일을 읽는 중…</span>}
      </div>

      {plan && (
        <div className="clip-review">
          <div className="chips">
            <span className="chip chip-strong">보완 대상 {rows.length}</span>
            {skippedBy.map(([k, n]) => (
              <span key={k} className="chip chip-muted">{YT_SKIP_LABEL[k]} {n}</span>
            ))}
          </div>
          {unmatched.length > 0 && (
            <div className="notice small yt-unmatched">
              기존 자료가 없는 영상 {unmatched.length}건은 보완하지 않습니다. 새 자료로 등록하려면 <b>자료 수집 → 파일</b>에서 해당 자막 노트(.md)를 가져오세요 (YouTube 자료·영상 서지·자막 본문으로 등록됨).
              <ul>
                {unmatched.map((s) => (
                  <li key={s.name}>{s.title ?? s.name} <span className="muted">({s.youtubeId})</span></li>
                ))}
              </ul>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="clip-actions">
                <button className="btn btn-sm" onClick={() => setApproved(new Set(rows.map((r) => r.material.id)))}>전체 선택</button>
                <button className="btn btn-sm" onClick={() => setApproved(new Set())}>선택 해제</button>
                <button className="btn btn-sm btn-primary" onClick={() => setConfirming(true)} disabled={!summary.count}>선택한 {summary.count}건 보완…</button>
              </div>
              <ul className="clip-rows">
                {rows.map((r) => {
                  const id = r.material.id;
                  const body = r.changes.find((c) => c.field === 'content');
                  return (
                    <li key={id} className={approved.has(id) ? 'on' : ''}>
                      <label className="clip-row-head">
                        <input type="checkbox" checked={approved.has(id)} onChange={() => toggle(id)} aria-label={`${r.material.title} 승인`} />
                        <b>{r.material.title}</b>
                        <span className="chip">{r.note.kind ? KIND_LABEL[r.note.kind] : '자막'}{r.note.translated ? '(자동 번역)' : ''}{r.note.lang ? ` · ${r.note.lang}` : ''}</span>
                      </label>
                      <div className="clip-fields">
                        {r.changes.map((c) => (
                          <label key={c.field} className="clip-field">
                            <input type="checkbox" checked={!!fields[id]?.has(c.field)} onChange={() => toggleField(id, c.field)} />
                            {YT_FIELD_LABEL[c.field]}: <span className="clip-val">{c.field === 'content' ? `${c.after.length.toLocaleString()}자` : c.after}</span>
                          </label>
                        ))}
                        {r.kept.map((c) => (
                          <span key={c.field} className="warn-tag" title={c.field === 'content' ? `자막 노트 ${c.after.length}자` : `자막 노트 값: ${c.after}`}>
                            {YT_FIELD_LABEL[c.field]} 기존 값 유지
                          </span>
                        ))}
                        {r.note.kind === 'auto' && <span className="muted small">자동 생성 자막 — 오탈자가 있을 수 있음</span>}
                      </div>
                      {body && (
                        <div className="clip-abstract">
                          <p>{open === id ? body.after : body.after.slice(0, PREVIEW) + (body.after.length > PREVIEW ? '…' : '')}</p>
                          {body.after.length > PREVIEW && (
                            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === id ? null : id)}>{open === id ? '접기' : '자막 전체 보기'}</button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!rows.length && <p className="muted small">채울 빈 필드가 있는 YouTube 자료가 없습니다.</p>}
        </div>
      )}

      {confirming && (
        <Modal
          title="YouTube 자막 보완 확인"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirming(false)}>취소</button>
              <button className="btn btn-primary" onClick={apply} disabled={!summary.count}>{summary.count}건 보완</button>
            </>
          }
        >
          <p>선택한 <b>{summary.count}건</b>의 <b>비어 있는 필드만</b> 채웁니다. 기존 본문·메모·내 관점·AI 분석 결과는 바꾸지 않습니다.</p>
          <table className="table clip-summary">
            <thead>
              <tr><th>필드</th><th>변경 수</th></tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f}><td>{YT_FIELD_LABEL[f]}</td><td>{summary.byField[f]}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </Card>
  );
}
