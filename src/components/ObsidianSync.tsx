import { useEffect, useRef, useState } from 'react';
import type { Material } from '../types';
import { useStore } from '../store';
import { formatDate } from '../lib/utils';
import {
  chooseFolder,
  cleanSubdir,
  ensurePermission,
  forgetFolder,
  loadSavedFolder,
  obsidianSupported,
  saveNotes,
  scanNotes,
  type DirHandle,
  type VaultNote,
} from '../lib/obsidian';
import { Card, Empty, StatusBadge } from './ui';
import { ImportFlow } from './ImportExport';

const SUBDIR_KEY = 'ai-wiki:obsidian-subdir';
const readSubdir = () => {
  try {
    return localStorage.getItem(SUBDIR_KEY) ?? 'AI WIKI';
  } catch {
    return 'AI WIKI';
  }
};
const time = (ms: number) => {
  const d = new Date(ms);
  return `${formatDate(d.toISOString())} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Obsidian Vault 폴더와 Markdown 주고받기 (사용자가 버튼을 누를 때만)
 * - 저장: 자료 → 선택 폴더/하위 폴더의 .md (같은 자료는 같은 파일 갱신)
 * - 불러오기: 폴더의 .md → 기존 가져오기 미리보기(추가·갱신·충돌·중복)
 */
export function ObsidianSync() {
  const { state, dispatch, toast } = useStore();
  const supported = obsidianSupported();
  const [dir, setDir] = useState<DirHandle | null>(null);
  const [granted, setGranted] = useState(false);
  const [subdir, setSubdir] = useState(readSubdir);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [scope, setScope] = useState<'sub' | 'all'>('sub');
  const [notes, setNotes] = useState<VaultNote[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<{ files: File[]; key: number } | null>(null);
  // 가져온 AI WIKI 노트의 위치 — 실제로 적용된 자료만 노트와 연결해 다음 저장 때 같은 파일을 갱신
  const pending = useRef(new Map<string, { path: string; lastModified: number }>());

  useEffect(() => {
    if (!supported) return;
    loadSavedFolder().then(async (h) => {
      if (!h) return;
      setDir(h);
      setGranted(await ensurePermission(h, false).catch(() => false));
    });
  }, [supported]);

  const sub = cleanSubdir(subdir);
  const changed = state.materials.filter((m) => !m.external?.obsidianSyncedAt || (m.updatedAt ?? m.createdAt) > m.external.obsidianSyncedAt);
  const targets = onlyChanged ? changed : state.materials;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      toast(
        name === 'NotAllowedError'
          ? '폴더 접근 권한이 없습니다. "접근 허용"을 눌러 다시 허용하세요.'
          : name === 'NotFoundError'
            ? '선택한 폴더를 찾을 수 없습니다. 폴더가 옮겨졌거나 삭제되었다면 폴더를 다시 선택하세요.'
            : `Obsidian 폴더 오류: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      );
      if (name === 'NotAllowedError') setGranted(false);
    } finally {
      setBusy(null);
    }
  }

  const pickFolder = () =>
    run('폴더 선택 중…', async () => {
      const h = await chooseFolder();
      if (!h) return;
      setDir(h);
      setGranted(true);
      setNotes(null);
      toast(`Obsidian 폴더 '${h.name}'를 연결했습니다.`);
    });

  const allow = () =>
    run('권한 요청 중…', async () => {
      if (!dir) return;
      const ok = await ensurePermission(dir, true);
      setGranted(ok);
      if (!ok) toast('폴더 접근이 허용되지 않았습니다.', 'error');
    });

  const save = () =>
    run('저장 중…', async () => {
      if (!dir) return;
      if (!targets.length) {
        toast('저장할 변경 자료가 없습니다.', 'info');
        return;
      }
      try {
        localStorage.setItem(SUBDIR_KEY, sub);
      } catch {
        /* 무시 */
      }
      const r = await saveNotes(dir, sub, targets, overwrite, (i) => setBusy(`저장 중… (${i + 1}/${targets.length})`));
      const now = new Date().toISOString();
      if (r.saved.length) dispatch({ type: 'setExternal', updates: r.saved.map((s) => ({ id: s.id, external: { obsidianPath: s.path, obsidianSyncedAt: now } })) });
      toast(`Obsidian 폴더에 Markdown ${r.saved.length}건을 저장했습니다.`);
      if (r.skippedModified.length)
        toast(
          `Obsidian에서 수정된 노트 ${r.skippedModified.length}건은 덮어쓰지 않았습니다 (${r.skippedModified.slice(0, 2).map((x) => x.path).join(', ')}${r.skippedModified.length > 2 ? ' 외' : ''}). 먼저 가져오거나 '수정된 노트도 덮어쓰기'를 선택하세요.`,
          'info',
        );
      if (r.failed.length) toast(`저장 실패 ${r.failed.length}건: ${r.failed[0].title} — ${r.failed[0].message}`, 'error');
      setNotes(null);
    });

  const list = () =>
    run('노트 목록 읽는 중…', async () => {
      if (!dir) return;
      const found = await scanNotes(dir, scope === 'sub' ? sub : '');
      setNotes(found);
      setPicked(new Set(found.filter((n) => n.aiWikiId).map((n) => n.path)));
    });

  const importPicked = () =>
    run('노트 읽는 중…', async () => {
      if (!notes) return;
      const chosen = notes.filter((n) => picked.has(n.path));
      pending.current = new Map(chosen.filter((n) => n.aiWikiId).map((n) => [n.aiWikiId!, { path: n.path, lastModified: n.lastModified }]));
      const files = await Promise.all(chosen.map((n) => n.handle.getFile()));
      if (!files.length) {
        toast('가져올 노트를 선택하세요.', 'info');
        return;
      }
      setIncoming({ files, key: Date.now() });
    });

  function linkApplied(ms: Material[]) {
    const updates = ms
      .filter((m) => pending.current.has(m.id))
      .map((m) => {
        const n = pending.current.get(m.id)!;
        return { id: m.id, external: { obsidianPath: n.path, obsidianSyncedAt: new Date(n.lastModified).toISOString() } };
      });
    pending.current.clear();
    if (updates.length) dispatch({ type: 'setExternal', updates });
  }

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const badge = !supported ? (
    <StatusBadge s="planned">브라우저 미지원</StatusBadge>
  ) : dir && granted ? (
    <StatusBadge s="real">폴더 연결됨</StatusBadge>
  ) : dir ? (
    <span className="warn-tag">권한 필요</span>
  ) : (
    <StatusBadge s="local">연결 안 됨</StatusBadge>
  );

  return (
    <Card title="Obsidian 폴더 연결" extra={badge}>
      {!supported ? (
        <p className="notice">
          이 브라우저는 폴더 직접 접근(File System Access API)을 지원하지 않습니다. Chrome 또는 Edge(데스크톱)에서 사용하거나, 자료 라이브러리의
          Markdown 가져오기·내보내기로 Vault와 파일을 주고받으세요.
        </p>
      ) : (
        <>
          <p className="muted small">
            Obsidian Vault 또는 Vault 안의 폴더를 직접 선택하면, 그 폴더 안에서만 Markdown을 저장하고 불러옵니다. 서지정보·나의 관점·내 연구와의
            연결·연구 메모·논문 활용 위치가 노트에 함께 저장됩니다. 버튼을 누를 때만 동작하며 자동 동기화는 하지 않습니다.
          </p>
          <div className="actions">
            {dir ? (
              <span className="small">
                폴더: <b>{dir.name}</b>
              </span>
            ) : (
              <span className="muted small">연결된 폴더 없음</span>
            )}
            {dir && !granted && (
              <button className="btn btn-primary btn-sm" onClick={allow} disabled={!!busy}>접근 허용</button>
            )}
            <button className={`btn btn-sm ${dir ? '' : 'btn-primary'}`} onClick={pickFolder} disabled={!!busy}>
              {dir ? '폴더 변경' : 'Obsidian 폴더 선택'}
            </button>
            {dir && (
              <button
                className="btn btn-sm"
                disabled={!!busy}
                onClick={() => {
                  void forgetFolder();
                  setDir(null);
                  setGranted(false);
                  setNotes(null);
                  toast('Obsidian 폴더 연결을 해제했습니다. 폴더의 파일은 그대로입니다.', 'info');
                }}
              >
                연결 해제
              </button>
            )}
            {busy && <span className="muted small">{busy}</span>}
          </div>

          {dir && granted && (
            <>
              <div className="io-row">
                <span className="io-label">저장 위치</span>
                <input
                  style={{ flex: 1, minWidth: 120 }}
                  value={subdir}
                  onChange={(e) => setSubdir(e.target.value)}
                  placeholder="비우면 선택한 폴더에 바로 저장"
                />
              </div>
              <p className="muted small">
                → {dir.name}/{sub ? `${sub}/` : ''}자료제목.md · 이미 저장한 자료는 폴더 어디로 옮겼든 같은 노트를 갱신합니다.
              </p>
              <div className="io-row">
                <span className="io-label">저장</span>
                <button className="btn" onClick={save} disabled={!!busy}>Markdown 저장 ({targets.length}건)</button>
              </div>
              <label className="radio small" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
                마지막 저장 이후 바뀐 자료만 (전체 {state.materials.length}건 중 {changed.length}건)
              </label>
              <label className="radio small" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Obsidian에서 수정된 노트도 덮어쓰기 (기본: 건너뛰고 알림)
              </label>

              <div className="io-row">
                <span className="io-label">불러오기</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as 'sub' | 'all')} style={{ width: 'auto' }}>
                  <option value="sub">저장 위치 폴더만</option>
                  <option value="all">선택한 폴더 전체</option>
                </select>
                <button className="btn" onClick={list} disabled={!!busy}>노트 목록 보기</button>
              </div>

              {notes &&
                (notes.length === 0 ? (
                  <Empty>Markdown 노트가 없습니다.</Empty>
                ) : (
                  <>
                    <div className="actions">
                      <span className="small muted">
                        {notes.length}개 노트 · 선택 {picked.size}개 (AI WIKI 노트는 기본 선택)
                      </span>
                      <button className="link small" onClick={() => setPicked(new Set(notes.map((n) => n.path)))}>모두 선택</button>
                      <button className="link small" onClick={() => setPicked(new Set())}>선택 해제</button>
                      <button className="btn btn-sm btn-primary" onClick={importPicked} disabled={!!busy || !picked.size}>
                        선택한 노트 가져오기
                      </button>
                    </div>
                    <ul className="import-list">
                      {notes.slice(0, 300).map((n) => (
                        <li key={n.path}>
                          <input type="checkbox" checked={picked.has(n.path)} onChange={() => toggle(n.path)} />
                          <span className={n.aiWikiId ? 'chip' : 'chip chip-muted'}>{n.aiWikiId ? 'AI WIKI' : '일반 노트'}</span>
                          <span className="import-title">{n.path}</span>
                          <span className="muted small">{time(n.lastModified)}</span>
                        </li>
                      ))}
                    </ul>
                    {notes.length > 300 && <p className="muted small">처음 300개만 표시합니다. 저장 위치 폴더로 범위를 좁혀 보세요.</p>}
                  </>
                ))}
            </>
          )}
        </>
      )}
      <div className="io-row">
        <ImportFlow label="" hideButton incoming={incoming} onApplied={linkApplied} />
      </div>
    </Card>
  );
}
