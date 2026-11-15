import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { REF_TYPE_LABEL } from '../lib/citation';
import { readClipNote } from '../lib/importers';
import {
  CLIP_SITE_LABEL,
  ENRICH_FIELD_LABEL,
  SKIP_LABEL,
  enrichPatch,
  planEnrichment,
  type EnrichField,
  type EnrichPlan,
  type EnrichRow,
  type FieldChange,
  type SkipReason,
} from '../lib/clip-enrich';
import type { RefType } from '../types';
import { Card } from './ui';

const MAX_FILES = 2000;
const PREVIEW = 280;

const showValue = (c: FieldChange) => (c.field === 'type' ? REF_TYPE_LABEL[c.after as RefType] ?? c.after : c.field === 'abstract' ? `${c.after.length.toLocaleString()}자` : c.after);

/** 행마다 반영할 필드 (경고가 있는 초록은 기본 제외) */
const defaultFields = (r: EnrichRow) => new Set(r.changes.filter((c) => !(c.field === 'abstract' && r.clip.abstractWarn)).map((c) => c.field));

/**
 * Obsidian 웹 클리퍼 노트(RISS·KCI·DBpia)로 이미 가져온 Markdown 자료의 빈 서지·초록 필드를 채운다.
 * 볼트 파일은 읽기만 하고, 승인한 자료만 기존 저장 경로(자료 수정)로 반영한다.
 */
export function ClipEnrich() {
  const { state, dispatch, toast } = useStore();
  const [plan, setPlan] = useState<EnrichPlan | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Record<string, Set<EnrichField>>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => /\.(md|markdown)$/i.test(f.name));
    if (!files.length) return toast('Markdown(.md) 파일이 없습니다.', 'info');
    if (files.length > MAX_FILES) return toast(`한 번에 ${MAX_FILES}개까지 확인할 수 있습니다.`, 'error');
    setBusy(true);
    try {
      const read = await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, text: await f.text() })));
      const p = planEnrichment(state.materials, read, readClipNote);
      setPlan(p);
      setFileCount(files.length);
      setApproved(new Set());
      setFields(Object.fromEntries(p.rows.map((r) => [r.material.id, defaultFields(r)])));
      setOpen(null);
    } catch (e) {
      toast(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const skippedBy = useMemo(() => {
    const g = new Map<SkipReason, number>();
    for (const s of plan?.skipped ?? []) g.set(s.reason, (g.get(s.reason) ?? 0) + 1);
    return [...g.entries()];
  }, [plan]);

  const toggle = (id: string) =>
    setApproved((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleField = (id: string, f: EnrichField) =>
    setFields((all) => {
      const n = new Set(all[id]);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return { ...all, [id]: n };
    });

  const selected = (plan?.rows ?? []).filter((r) => approved.has(r.material.id) && fields[r.material.id]?.size);

  function apply() {
    if (!selected.length) return toast('보완할 자료를 체크하세요.', 'info');
    if (!window.confirm(`선택한 ${selected.length}건의 빈 필드만 채웁니다. 기존 값·본문·메모는 바꾸지 않습니다. 계속할까요?`)) return;
    let n = 0;
    for (const r of selected) {
      // 반영 직전 최신 자료로 다시 계산: 그사이 채워진 필드는 건너뛴다
      const cur = state.materials.find((m) => m.id === r.material.id);
      if (!cur) continue;
      const patch = enrichPatch(cur, r.changes.filter((c) => fields[r.material.id]?.has(c.field)));
      if (!Object.keys(patch).length) continue;
      dispatch({ type: 'update', id: cur.id, patch });
      n++;
    }
    toast(`${n}건의 논문 정보를 보완했습니다.`);
    setPlan(null);
    setApproved(new Set());
  }

  const rows = plan?.rows ?? [];
  return (
    <Card title="Obsidian 논문 정보 보완" extra={<span className="ok-tag">빈 필드만 채움</span>}>
      <p className="muted small">
        RISS·KCI·DBpia 웹 클리퍼 노트 폴더를 고르면, 이미 가져온 Markdown 자료와 <b>파일명·크기가 모두 같은 경우만</b> 짝지어 논문 유형·출처 URL·발행연도·초록을 찾습니다.
        볼트 파일은 읽기만 하고, 체크해 승인한 자료의 빈 필드만 채웁니다.
      </p>
      <div className="clip-pick">
        <label className="btn btn-sm">
          폴더 선택
          <input type="file" hidden multiple {...{ webkitdirectory: '' }} onChange={(e) => { void load(e.target.files); e.target.value = ''; }} disabled={busy} />
        </label>
        <label className="btn btn-sm">
          파일 선택
          <input type="file" hidden multiple accept=".md,.markdown" onChange={(e) => { void load(e.target.files); e.target.value = ''; }} disabled={busy} />
        </label>
        {busy && <span className="muted small">파일을 읽는 중…</span>}
      </div>

      {plan && (
        <div className="clip-review">
          <div className="chips">
            <span className="chip">파일 {fileCount}</span>
            <span className="chip chip-strong">보완 대상 {rows.length}</span>
            <span className="chip">제외 {plan.skipped.length}</span>
            {skippedBy.map(([k, n]) => (
              <span key={k} className="chip chip-muted">{SKIP_LABEL[k]} {n}</span>
            ))}
          </div>
          {plan.skipped.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowSkipped((v) => !v)}>{showSkipped ? '제외 목록 접기' : '제외 목록 보기'}</button>
          )}
          {showSkipped && (
            <ul className="clip-skipped small">
              {plan.skipped.map((s, i) => (
                <li key={i}><span className="muted">{SKIP_LABEL[s.reason]}</span> · {s.title ?? s.name}</li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <>
              <div className="clip-actions">
                <button className="btn btn-sm" onClick={() => setApproved(new Set(rows.map((r) => r.material.id)))}>전체 선택</button>
                <button className="btn btn-sm" onClick={() => setApproved(new Set())}>선택 해제</button>
                <button className="btn btn-sm btn-primary" onClick={apply} disabled={!selected.length}>선택한 {selected.length}건 보완</button>
              </div>
              <ul className="clip-rows">
                {rows.map((r) => {
                  const id = r.material.id;
                  const abs = r.changes.find((c) => c.field === 'abstract');
                  return (
                    <li key={id} className={approved.has(id) ? 'on' : ''}>
                      <label className="clip-row-head">
                        <input type="checkbox" checked={approved.has(id)} onChange={() => toggle(id)} aria-label={`${r.material.title} 승인`} />
                        <b>{r.material.title}</b>
                        <span className="chip">{CLIP_SITE_LABEL[r.clip.site]}</span>
                      </label>
                      <div className="clip-fields">
                        {r.changes.map((c) => (
                          <label key={c.field} className="clip-field">
                            <input type="checkbox" checked={!!fields[id]?.has(c.field)} onChange={() => toggleField(id, c.field)} />
                            {ENRICH_FIELD_LABEL[c.field]}: <span className="clip-val">{showValue(c)}</span>
                            {c.field === 'abstract' && r.clip.abstractWarn && <span className="warn-tag">{r.clip.abstractWarn}</span>}
                          </label>
                        ))}
                        {!r.clip.type && <span className="muted small">유형 미분류: {r.clip.typeNote}</span>}
                        {r.conflicts.map((c) => (
                          <span key={c.field} className="warn-tag" title={`볼트 값: ${c.field === 'abstract' ? `${c.after.length}자` : c.after}`}>
                            {ENRICH_FIELD_LABEL[c.field]} 기존 값 유지
                          </span>
                        ))}
                      </div>
                      {abs && (
                        <div className="clip-abstract">
                          <p>{open === id ? abs.after : abs.after.slice(0, PREVIEW) + (abs.after.length > PREVIEW ? '…' : '')}</p>
                          {abs.after.length > PREVIEW && (
                            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === id ? null : id)}>{open === id ? '접기' : '초록 전체 보기'}</button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!rows.length && <p className="muted small">채울 빈 필드가 있는 자료가 없습니다.</p>}
        </div>
      )}
    </Card>
  );
}
