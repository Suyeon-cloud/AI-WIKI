import { SCHEMA_VERSION, type AppState, type Material } from '../types';
import { parseFullState } from './data';

export interface CloudRow { state: unknown; revision: number }
export interface MaterialRow { id: string; position: number; data: unknown }
export interface SplitRows { meta: CloudRow; materials: MaterialRow[] }
export interface Changes {
  expectedRevision: number;
  /** null이면 서버의 메타 문서를 그대로 둔다 (여러 번에 나눠 보낼 때 마지막 묶음만 메타를 보냄) */
  meta: Record<string, unknown> | null;
  upserts: { position: number; data: Material }[];
  deletes: string[];
}
export interface StateRepository {
  read(userId: string): Promise<CloudRow | null>;
  write(userId: string, state: unknown, expectedRevision: number | null): Promise<number>;
  /** 변경분 저장 방식으로 전환된 계정이면 메타와 자료 행, 아니면 null */
  readSplit?(userId: string): Promise<SplitRows | null>;
  saveChanges?(userId: string, changes: Changes): Promise<{ revision: number; count: number }>;
}
export type StorageMode = 'legacy' | 'split';

// 한 번에 보내는 자료 묶음의 최대 크기(UTF-8 바이트). 서버 처리 시간 제한(8초)보다 훨씬 작게 잡는다.
// 한글은 1자가 3바이트라 문자 수가 아니라 바이트로 잰다.
const CHUNK_BYTES = 1_000_000;
const encoder = new TextEncoder();

// The database compares revisions atomically, protecting newer data in other tabs.
// Accounts are switched to split storage only by the manual SQL migration; this class never migrates.
export class CloudState {
  private revision: number | null = null;
  private loaded = false;
  mode: StorageMode = 'legacy';
  /** split 모드에서 서버에 마지막으로 저장된 자료 (같은 객체면 바뀌지 않은 것으로 본다) */
  private saved = new Map<string, { ref: Material; json: string }>();
  private savedMeta = '';
  constructor(private repo: StateRepository, private userId: string, private isCurrent: () => boolean, private chunkBytes = CHUNK_BYTES) {}
  private checkOwner() { if (!this.isCurrent()) throw new Error('계정이 변경되어 저장을 중지했습니다.'); }
  private static checkRevision(revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('저장 버전을 확인하지 못했습니다. 원본은 변경하지 않았습니다.');
  }
  private static parse(raw: Record<string, unknown>): AppState {
    const parsed = parseFullState(raw);
    if (raw.schemaVersion === SCHEMA_VERSION) {
      for (const key of ['materials', 'projects', 'events', 'aiOutputs', 'theses'] as const) {
        if (!Array.isArray(raw[key]) || raw[key].length !== parsed.state[key].length)
          throw new Error('저장 자료 구조를 확인하지 못했습니다. 원본을 보호하기 위해 저장을 중지했습니다.');
      }
    }
    if (parsed.dropped) throw new Error('저장 자료 일부를 읽지 못했습니다. 원본을 보호하기 위해 저장을 중지했습니다.');
    return parsed.state;
  }
  private static metaOf(state: AppState): Record<string, unknown> {
    const { materials, ...rest } = state;
    return { ...rest, schemaVersion: SCHEMA_VERSION, materialOrder: materials.map((m) => m.id) };
  }
  async load(): Promise<AppState | null> {
    this.checkOwner();
    const split = this.repo.readSplit ? await this.repo.readSplit(this.userId) : null;
    this.checkOwner();
    if (split) return this.loadSplit(split);
    const row = await this.repo.read(this.userId);
    this.checkOwner();
    if (!row) { this.loaded = true; return null; }
    CloudState.checkRevision(row.revision);
    const state = CloudState.parse(row.state as Record<string, unknown>);
    this.revision = row.revision;
    this.loaded = true;
    return state;
  }
  private loadSplit({ meta, materials }: SplitRows): AppState {
    CloudState.checkRevision(meta.revision);
    const { materialOrder, ...rest } = meta.state as Record<string, unknown>;
    if (!Array.isArray(materialOrder)) throw new Error('자료 순서 정보를 확인하지 못했습니다. 원본을 보호하기 위해 저장을 중지했습니다.');
    const byId = new Map(materials.map((r) => [r.id, r]));
    const ordered: unknown[] = [];
    for (const id of materialOrder) {
      const row = byId.get(id as string);
      if (!row) throw new Error('자료 순서에 있는 자료를 서버에서 찾지 못했습니다. 원본을 보호하기 위해 저장을 중지했습니다.');
      ordered.push(row.data);
      byId.delete(id as string);
    }
    // 순서 정보보다 나중에 저장된 자료(여러 묶음 저장이 중간에 멈춘 경우)는 잃지 않도록 뒤에 붙인다.
    ordered.push(...[...byId.values()].sort((a, b) => a.position - b.position).map((r) => r.data));
    const state = CloudState.parse({ ...rest, materials: ordered });
    this.mode = 'split';
    this.revision = meta.revision;
    this.saved = new Map(state.materials.map((m) => [m.id, { ref: m, json: JSON.stringify(m) }]));
    this.savedMeta = JSON.stringify(CloudState.metaOf(state));
    this.loaded = true;
    return state;
  }
  async save(state: AppState): Promise<void> {
    this.checkOwner();
    if (!this.loaded) throw new Error('자료를 불러오기 전에는 저장할 수 없습니다.');
    if (this.mode === 'split') return this.saveSplit(state);
    const next = await this.repo.write(this.userId, { ...state, schemaVersion: SCHEMA_VERSION }, this.revision);
    this.checkOwner();
    this.revision = next;
  }
  private async saveSplit(state: AppState): Promise<void> {
    const saveChanges = this.repo.saveChanges;
    if (!saveChanges) throw new Error('변경분 저장을 지원하지 않습니다.');
    const meta = CloudState.metaOf(state);
    const metaJson = JSON.stringify(meta);
    const upserts: { position: number; data: Material; json: string; bytes: number }[] = [];
    state.materials.forEach((m, position) => {
      const prev = this.saved.get(m.id);
      if (prev?.ref === m) return;
      const json = JSON.stringify(m);
      if (prev?.json === json) { prev.ref = m; return; }
      upserts.push({ position, data: m, json, bytes: encoder.encode(json).length });
    });
    const live = new Set(state.materials.map((m) => m.id));
    const deletes = [...this.saved.keys()].filter((id) => !live.has(id));
    if (!upserts.length && !deletes.length && metaJson === this.savedMeta) return;

    // 큰 변경은 여러 묶음으로 나눠 보낸다. 메타(자료 순서 포함)와 삭제는 마지막 묶음에서만 반영한다.
    const chunks: (typeof upserts)[] = [[]];
    let size = 0;
    for (const u of upserts) {
      if (size && size + u.bytes > this.chunkBytes) { chunks.push([]); size = 0; }
      chunks[chunks.length - 1].push(u);
      size += u.bytes;
    }
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1;
      const result = await saveChanges.call(this.repo, this.userId, {
        expectedRevision: this.revision!,
        meta: last ? meta : null,
        upserts: chunks[i].map(({ position, data }) => ({ position, data })),
        deletes: last ? deletes : [],
      });
      this.checkOwner();
      this.revision = result.revision;
      for (const u of chunks[i]) this.saved.set(u.data.id, { ref: u.data, json: u.json });
      if (last) {
        for (const id of deletes) this.saved.delete(id);
        this.savedMeta = metaJson;
        if (result.count !== state.materials.length)
          throw new Error(`저장 확인 실패: 서버 자료 ${result.count}건, 화면 자료 ${state.materials.length}건이 다릅니다. 새로고침하기 전에 현재 내용을 백업해 주세요.`);
      }
    }
  }
}
