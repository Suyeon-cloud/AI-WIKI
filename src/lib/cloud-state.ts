import { SCHEMA_VERSION, type AppState } from '../types';
import { parseFullState } from './data';

export interface CloudRow { state: unknown; revision: number }
export interface StateRepository {
  read(userId: string): Promise<CloudRow | null>;
  write(userId: string, state: unknown, expectedRevision: number | null): Promise<number>;
}

// The database compares revisions atomically, protecting newer data in other tabs.
export class CloudState {
  private revision: number | null = null;
  private loaded = false;
  constructor(private repo: StateRepository, private userId: string, private isCurrent: () => boolean) {}
  private checkOwner() { if (!this.isCurrent()) throw new Error('계정이 변경되어 저장을 중지했습니다.'); }
  async load(): Promise<AppState | null> {
    this.checkOwner();
    const row = await this.repo.read(this.userId);
    this.checkOwner();
    if (!row) { this.loaded = true; return null; }
    if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('저장 버전을 확인하지 못했습니다. 원본은 변경하지 않았습니다.');
    const parsed = parseFullState(row.state);
    const raw = row.state as Record<string, unknown>;
    if (raw.schemaVersion === SCHEMA_VERSION) {
      for (const key of ['materials', 'projects', 'events', 'aiOutputs', 'theses'] as const) {
        if (!Array.isArray(raw[key]) || raw[key].length !== parsed.state[key].length)
          throw new Error('저장 자료 구조를 확인하지 못했습니다. 원본을 보호하기 위해 저장을 중지했습니다.');
      }
    }
    if (parsed.dropped) throw new Error('저장 자료 일부를 읽지 못했습니다. 원본을 보호하기 위해 저장을 중지했습니다.');
    this.revision = row.revision;
    this.loaded = true;
    return parsed.state;
  }
  async save(state: AppState): Promise<void> {
    this.checkOwner();
    if (!this.loaded) throw new Error('자료를 불러오기 전에는 저장할 수 없습니다.');
    const next = await this.repo.write(this.userId, { ...state, schemaVersion: SCHEMA_VERSION }, this.revision);
    this.checkOwner();
    this.revision = next;
  }
}
