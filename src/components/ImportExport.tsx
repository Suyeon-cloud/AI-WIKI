import { useEffect, useRef, useState } from 'react';
import type { AppState, Material } from '../types';
import { useStore } from '../store';
import { downloadFile, formatDate, markdownToHtml, materialToMarkdown, materialToText, safeFileName, wrapHtml } from '../lib/utils';
import {
  IMPORT_STATUS_LABEL,
  buildBackup,
  planImport,
  resolveImport,
  type ConflictPolicy,
  type DuplicatePolicy,
  type ImportError,
  type ImportItem,
  type ImportStatus,
  type StateParseResult,
} from '../lib/data';
import { IMPORT_ACCEPT, parseImportFile, type ParsedCandidate } from '../lib/importers';
import { Card, StatusBadge } from './ui';

export function downloadBackup(state: AppState) {
  downloadFile(
    `ai-wiki-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(buildBackup(state), null, 2),
    'application/json',
  );
}

const STATUS_ORDER: ImportStatus[] = ['add', 'update', 'conflict', 'duplicate', 'same'];
const STATUS_CLASS: Record<ImportStatus, string> = {
  add: 'ok-tag',
  update: 'ok-tag',
  conflict: 'warn-tag',
  duplicate: 'warn-tag',
  same: 'chip chip-muted',
};

type Pending =
  | { mode: 'merge'; items: ImportItem[]; errors: ImportError[]; note?: string }
  | { mode: 'backup'; backup: StateParseResult; source: string; exportedAt?: string };

/**
 * 파일 선택 → 미리보기(추가/갱신/충돌/중복 건수) → 적용.
 * 전체 백업 JSON을 고르면 '전체 복원' 또는 '자료만 병합'을 선택하게 한다.
 */
export function ImportFlow({
  label,
  accept = IMPORT_ACCEPT,
  incoming,
  hideButton,
  onApplied,
}: {
  label: string;
  accept?: string;
  /** 파일 선택 창 대신 코드에서 넘기는 파일 (예: Google Drive에서 받은 파일) — 같은 미리보기·검증 흐름을 탄다 */
  incoming?: { files: File[]; key: number } | null;
  hideButton?: boolean;
  /** 병합 적용 후 반영된 자료(추가·갱신·변경 없음) — 외부 파일과 자료를 연결할 때 사용 */
  onApplied?: (materials: Material[]) => void;
}) {
  const { state, dispatch, toast } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ConflictPolicy>('keep');
  const [duplicate, setDuplicate] = useState<DuplicatePolicy>('skip');
  const [confirmRestore, setConfirmRestore] = useState(false);

  const close = () => {
    setPending(null);
    setConfirmRestore(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const backupToCandidates = (b: StateParseResult, source: string): ParsedCandidate[] =>
    b.state.materials.map((m) => ({ partial: m, source, fallbackTitle: m.title }));

  useEffect(() => {
    if (incoming?.files.length) void onPick(incoming.files);
  }, [incoming]);

  async function onPick(files: FileList | File[] | null) {
    if (!files?.length) return;
    setBusy(true);
    const candidates: ParsedCandidate[] = [];
    const errors: ImportError[] = [];
    const backups: { backup: StateParseResult; source: string; exportedAt?: string }[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = await parseImportFile(f);
        if (r.kind === 'backup') {
          let exportedAt: string | undefined;
          try {
            exportedAt = (JSON.parse(await f.text()) as { exportedAt?: string }).exportedAt;
          } catch {
            /* 이미 검증된 파일 */
          }
          backups.push({ backup: r.backup, source: r.source, exportedAt });
        } else {
          candidates.push(...r.items);
          errors.push(...r.errors.map((message) => ({ file: f.name, message })));
        }
      } catch (e) {
        errors.push({ file: f.name, message: e instanceof Error ? e.message : '읽을 수 없는 파일' });
      }
    }
    setBusy(false);
    setConflict('keep');
    setDuplicate('skip');
    setConfirmRestore(false);

    if (backups.length === 1 && !candidates.length && !errors.length) {
      setPending({ mode: 'backup', ...backups[0] });
      return;
    }
    // 백업이 다른 파일과 함께 선택되면 자료만 병합 대상으로 다룬다.
    for (const b of backups) candidates.push(...backupToCandidates(b.backup, b.source));
    if (!candidates.length) {
      toast(`가져오기 실패: ${errors.map((e) => `${e.file} — ${e.message}`).join(' / ')}`, 'error');
      close();
      return;
    }
    const plan = planImport(state.materials, candidates);
    setPending({
      mode: 'merge',
      items: plan.items,
      errors: [...errors, ...plan.errors],
      note: backups.length ? '전체 백업 파일은 다른 파일과 함께 선택되어 자료만 병합합니다. 설정·집필 상태는 바뀌지 않습니다.' : undefined,
    });
  }

  function applyMerge(items: ImportItem[]) {
    const { add, update } = resolveImport(items, conflict, duplicate);
    if (!add.length && !update.length) {
      onApplied?.(items.filter((i) => i.status === 'same').map((i) => i.incoming));
      toast('반영할 변경 사항이 없습니다.', 'info');
      close();
      return;
    }
    dispatch({ type: 'importApply', add, update });
    onApplied?.([...add, ...update, ...items.filter((i) => i.status === 'same').map((i) => i.incoming)]);
    if (add.length === 1 && !update.length) dispatch({ type: 'select', id: add[0].id });
    toast(`가져오기 완료: 추가 ${add.length}건, 갱신 ${update.length}건`);
    close();
  }

  function applyRestore(b: StateParseResult) {
    // v1 '전체 JSON 백업'에는 집필 상태가 없으므로 현재 집필 내용을 유지한다.
    dispatch({ type: 'restore', state: { ...b.state, writing: b.hasWriting ? b.state.writing : state.writing } });
    toast(`백업을 복원했습니다. 자료 ${b.state.materials.length}건${b.hasWriting ? ', 설정·집필 상태 포함' : ', 설정 포함 (집필 상태는 백업에 없어 현재 내용 유지)'}`);
    close();
  }

  const counts = pending?.mode === 'merge'
    ? STATUS_ORDER.map((s) => [s, pending.items.filter((i) => i.status === s).length] as const).filter(([, n]) => n)
    : [];
  const has = (s: ImportStatus) => pending?.mode === 'merge' && pending.items.some((i) => i.status === s);

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} multiple hidden onChange={(e) => onPick(e.target.files)} />
      {hideButton ? (
        busy && <span className="muted small">파일 확인 중…</span>
      ) : (
        <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? '파일 확인 중…' : label}
        </button>
      )}

      {pending?.mode === 'merge' && (
        <div className="import-review">
          <div className="import-review-head">
            <b>가져오기 미리보기</b>
            <span className="chips">
              {counts.map(([s, n]) => (
                <span key={s} className="chip">{IMPORT_STATUS_LABEL[s]} <small>{n}</small></span>
              ))}
              {pending.errors.length > 0 && <span className="chip">오류 <small>{pending.errors.length}</small></span>}
            </span>
          </div>
          {pending.note && <p className="muted small">{pending.note}</p>}
          <ul className="import-list">
            {pending.items.map((it, i) => (
              <li key={i}>
                <span className={STATUS_CLASS[it.status]}>{IMPORT_STATUS_LABEL[it.status]}</span>
                <span className="import-title" title={it.source}>{it.incoming.title}</span>
                {it.reason && <span className="muted small">{it.reason}</span>}
              </li>
            ))}
            {pending.errors.map((e, i) => (
              <li key={`e${i}`}>
                <span className="warn-tag">오류</span>
                <span className="import-title">{e.file}</span>
                <span className="err small">{e.message}</span>
              </li>
            ))}
          </ul>
          {has('conflict') && (
            <label className="import-policy">
              충돌 처리
              <select value={conflict} onChange={(e) => setConflict(e.target.value as ConflictPolicy)}>
                <option value="keep">현재 자료 유지 (가져온 내용 무시)</option>
                <option value="overwrite">가져온 내용으로 덮어쓰기</option>
                <option value="copy">가져온 내용을 사본으로 추가</option>
              </select>
            </label>
          )}
          {has('duplicate') && (
            <label className="import-policy">
              중복 의심
              <select value={duplicate} onChange={(e) => setDuplicate(e.target.value as DuplicatePolicy)}>
                <option value="skip">건너뛰기</option>
                <option value="add">별도 자료로 추가</option>
              </select>
            </label>
          )}
          <p className="muted small">갱신은 가져온 파일에 있는 항목만 바꾸고, 파일에 없는 분석 결과·내 관점·서지정보는 유지합니다.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => applyMerge(pending.items)}>적용</button>
            <button className="btn" onClick={close}>취소</button>
          </div>
        </div>
      )}

      {pending?.mode === 'backup' && (
        <div className="import-review">
          <div className="import-review-head">
            <b>전체 백업 파일</b>
            <StatusBadge s="local">v{pending.backup.fromVersion}</StatusBadge>
          </div>
          <dl className="meta">
            <dt>파일</dt>
            <dd>{pending.source}</dd>
            {pending.exportedAt && (
              <>
                <dt>백업 일자</dt>
                <dd>{formatDate(pending.exportedAt)}</dd>
              </>
            )}
            <dt>자료</dt>
            <dd>
              {pending.backup.state.materials.length}건
              {pending.backup.dropped > 0 && <span className="err small">(형식 오류 {pending.backup.dropped}건 제외)</span>}
            </dd>
            <dt>연구 설정</dt>
            <dd>{pending.backup.hasSettings ? pending.backup.state.settings.topic : <span className="muted">없음 (기본값)</span>}</dd>
            <dt>집필 상태</dt>
            <dd>
              {pending.backup.hasWriting
                ? `본문 ${pending.backup.state.writing.text.length.toLocaleString()}자 · 이력 ${pending.backup.state.writing.history.length}건`
                : <span className="muted">백업에 없음 — 현재 내용 유지</span>}
            </dd>
          </dl>
          <p className="muted small">
            <b>전체 복원</b>은 현재 자료 {state.materials.length}건과 설정·집필 상태를 백업 내용으로 바꿉니다.
            <b> 자료만 병합</b>은 현재 상태를 유지하고 ID 기준으로 추가·갱신만 합니다.
          </p>
          {confirmRestore ? (
            <div className="actions">
              <span className="small err">현재 상태를 백업 내용으로 대체할까요?</span>
              <button className="btn btn-danger" onClick={() => applyRestore(pending.backup)}>복원 확인</button>
              <button className="btn" onClick={() => downloadBackup(state)}>현재 상태 먼저 백업</button>
              <button className="btn" onClick={() => setConfirmRestore(false)}>취소</button>
            </div>
          ) : (
            <div className="actions">
              <button className="btn btn-primary" onClick={() => setConfirmRestore(true)}>전체 복원</button>
              <button
                className="btn"
                onClick={() => {
                  const plan = planImport(state.materials, backupToCandidates(pending.backup, pending.source));
                  setPending({ mode: 'merge', items: plan.items, errors: plan.errors });
                }}
              >
                자료만 병합
              </button>
              <button className="btn" onClick={close}>취소</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Obsidian 호환 파일 기반 가져오기/내보내기 — vault 자동 접근·동기화는 하지 않음 */
export function ImportExport({ selected }: { selected: Material | null }) {
  const { state, toast } = useStore();

  function exp(kind: 'md' | 'txt' | 'json' | 'html' | 'all') {
    if (kind === 'all') {
      downloadBackup(state);
      toast('전체 상태(자료·설정·집필)를 JSON으로 백업했습니다.');
      return;
    }
    if (!selected) {
      toast('먼저 자료를 선택하세요.', 'error');
      return;
    }
    const name = safeFileName(selected.title);
    const md = materialToMarkdown(selected);
    if (kind === 'md') downloadFile(`${name}.md`, md, 'text/markdown');
    if (kind === 'txt') downloadFile(`${name}.txt`, materialToText(selected), 'text/plain');
    if (kind === 'json') downloadFile(`${name}.json`, JSON.stringify(selected, null, 2), 'application/json');
    if (kind === 'html') downloadFile(`${name}.html`, wrapHtml(selected.title, markdownToHtml(md)), 'text/html');
    toast(`.${kind} 파일을 다운로드했습니다.`);
  }

  return (
    <Card
      title="Obsidian 호환 가져오기 / 내보내기"
      extra={<StatusBadge s="real">파일 기반 교류</StatusBadge>}
      className="io-card"
    >
      <p className="muted small">
        Obsidian vault에 직접 접근하거나 자동 동기화하지 않습니다. .md 파일을 vault 폴더에 넣거나, vault의 노트를 이
        화면으로 가져오는 <b>파일 기반 교류</b> 방식입니다. Markdown frontmatter의 ID·서지정보·태그·PARA와 '내 관점' 섹션을
        인식하므로, 내보낸 노트를 다시 가져오면 같은 자료로 갱신됩니다.
      </p>
      <div className="io-row">
        <span className="io-label">가져오기</span>
        <ImportFlow label=".md / .txt / .json 파일 선택" />
      </div>
      <div className="io-row">
        <span className="io-label">선택 자료</span>
        <span className="io-target">{selected ? selected.title : '선택된 자료 없음'}</span>
      </div>
      <div className="io-row">
        <span className="io-label">내보내기</span>
        <div className="btn-group">
          <button className="btn" onClick={() => exp('md')} disabled={!selected}>Markdown</button>
          <button className="btn" onClick={() => exp('txt')} disabled={!selected}>TXT</button>
          <button className="btn" onClick={() => exp('json')} disabled={!selected}>JSON</button>
          <button className="btn" onClick={() => exp('html')} disabled={!selected}>HTML</button>
          <button className="btn btn-ghost" onClick={() => exp('all')}>전체 JSON 백업</button>
        </div>
      </div>
    </Card>
  );
}
