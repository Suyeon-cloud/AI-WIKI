/**
 * 프로젝트 단위 외부 폴더 연동 (Obsidian · Google Drive 공통 흐름)
 * - 프로젝트를 만들면 두 곳에 같은 이름의 폴더(<프로젝트>/자료, <프로젝트>/AI 생성)를 만든다.
 * - 원본 자료 Markdown → '자료' 폴더, AI가 만든 결과물 → 'AI 생성' 폴더 (섞지 않음)
 * - 연결되지 않은 곳은 건너뛰고 결과에 알린다. 나중에 대시보드에서 다시 만들 수 있다.
 */
import type { AiOutput, Material, Project } from '../types';
import { PROJECT_SUBFOLDERS, folderName } from './projects';
import { DriveError, driveState, ensureProjectFolders, saveText, uploadBinary } from './drive';
import { ensurePermission, ensureProjectDirs, saveNotes, vaultState, writeTextFile, type SaveResult } from './obsidian';
import { materialToMarkdown, safeFileName } from './utils';

export interface FolderResult {
  patch: Partial<Project>;
  done: string[];
  skipped: string[];
  errors: string[];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const driveReady = () => driveState().status === 'connected';
export const obsidianReady = () => {
  const v = vaultState();
  return !!v.handle && v.granted;
};

/** 프로젝트 폴더를 Obsidian·Drive에 만든다 (이미 있으면 그대로 사용) */
export async function createProjectFolders(p: Project): Promise<FolderResult> {
  const r: FolderResult = { patch: {}, done: [], skipped: [], errors: [] };
  const name = folderName(p);
  const now = new Date().toISOString();
  const v = vaultState();
  if (v.handle && v.granted) {
    try {
      r.patch.obsidianPath = await ensureProjectDirs(v.handle, name, PROJECT_SUBFOLDERS);
      r.patch.obsidianCreatedAt = now;
      r.done.push(`Obsidian: ${v.handle.name}/${r.patch.obsidianPath}`);
    } catch (e) {
      r.errors.push(`Obsidian 폴더 생성 실패: ${msg(e)}`);
    }
  } else r.skipped.push('Obsidian (폴더 미연결)');
  if (driveReady()) {
    try {
      const f = await ensureProjectFolders(name, PROJECT_SUBFOLDERS, p.driveFolderId);
      r.patch.driveFolderId = f.project;
      r.patch.driveCreatedAt = now;
      r.done.push(`Google Drive: AI WIKI/${name}`);
    } catch (e) {
      r.errors.push(`Drive 폴더 생성 실패: ${e instanceof DriveError ? e.message : msg(e)}`);
    }
  } else r.skipped.push('Google Drive (계정 미연결)');
  return r;
}

/** 원본 자료 Markdown을 Obsidian 프로젝트 '자료' 폴더로 */
export async function sendToObsidian(p: Project, ms: Material[], overwriteModified = false): Promise<SaveResult & { base: string }> {
  const v = vaultState();
  if (!v.handle) throw new Error('Obsidian 폴더가 연결되지 않았습니다. 연구 설정에서 Vault 폴더를 선택하세요.');
  if (!(await ensurePermission(v.handle, true))) throw new Error('Obsidian 폴더 접근이 허용되지 않았습니다.');
  const base = await ensureProjectDirs(v.handle, folderName(p), PROJECT_SUBFOLDERS);
  const res = await saveNotes(v.handle, `${base}/${PROJECT_SUBFOLDERS.materials}`, ms, overwriteModified);
  return { ...res, base };
}

/** 원본 자료 Markdown을 Drive 프로젝트 '자료' 폴더로 (같은 자료는 같은 파일 갱신) */
export async function sendToDrive(p: Project, ms: Material[], onProgress?: (i: number) => void) {
  const f = await ensureProjectFolders(folderName(p), PROJECT_SUBFOLDERS, p.driveFolderId);
  const updates: { id: string; external: { driveFileId: string; driveModifiedAt: string; driveSyncedAt: string } }[] = [];
  const failed: string[] = [];
  for (const [i, m] of ms.entries()) {
    onProgress?.(i);
    try {
      const file = await saveText(`${safeFileName(m.title)}.md`, materialToMarkdown(m), 'text/markdown', f.materials, m.external?.driveFileId);
      updates.push({ id: m.id, external: { driveFileId: file.id, driveModifiedAt: file.modifiedTime, driveSyncedAt: new Date().toISOString() } });
    } catch (e) {
      if (e instanceof DriveError && (e.kind === 'auth' || e.kind === 'network')) throw Object.assign(e, { partial: updates });
      failed.push(m.title);
    }
  }
  return { updates, failed, folderId: f.project };
}

export function outputToMarkdown(o: AiOutput, p: Project): string {
  return [
    '---',
    `ai_wiki_output_id: ${o.id}`,
    `project: "${p.name.replace(/"/g, "'")}"`,
    `kind: ${o.kind}`,
    `created: ${o.createdAt}`,
    `model: ${o.model || 'unknown'}`,
    'origin: AI 생성 (연구자 검토 필요)',
    '---',
    '',
    `# ${o.title}`,
    '',
    '> 이 문서는 AI가 생성한 결과물입니다. 원본 연구자료가 아니며, 인용·제출 전에 연구자가 원문과 대조해 확인해야 합니다.',
    '',
    o.content,
    '',
  ].join('\n');
}

const outputFileName = (o: AiOutput) => `${o.createdAt.slice(0, 10)} ${o.kind} - ${safeFileName(o.title)}`.slice(0, 120);

/** AI 산출물 → Drive 'AI 생성' 폴더 (Markdown). 바이너리(HWPX)는 blob으로 함께 저장 */
export async function saveOutputToDrive(o: AiOutput, p: Project, binary?: { blob: Blob; name: string; mime: string }) {
  const f = await ensureProjectFolders(folderName(p), PROJECT_SUBFOLDERS, p.driveFolderId);
  if (binary) {
    const file = await uploadBinary(binary.name, binary.blob, binary.mime, f.ai);
    return { fileId: file.id, folderId: f.project };
  }
  const file = await saveText(`${outputFileName(o)}.md`, outputToMarkdown(o, p), 'text/markdown', f.ai, o.driveFileId);
  return { fileId: file.id, folderId: f.project };
}

/** AI 산출물 → Obsidian 'AI 생성' 폴더 */
export async function saveOutputToObsidian(o: AiOutput, p: Project): Promise<string> {
  const v = vaultState();
  if (!v.handle) throw new Error('Obsidian 폴더가 연결되지 않았습니다.');
  if (!(await ensurePermission(v.handle, true))) throw new Error('Obsidian 폴더 접근이 허용되지 않았습니다.');
  const base = await ensureProjectDirs(v.handle, folderName(p), PROJECT_SUBFOLDERS);
  const path = `${base}/${PROJECT_SUBFOLDERS.ai}/${outputFileName(o)}.md`;
  await writeTextFile(v.handle, path, outputToMarkdown(o, p));
  return path;
}
