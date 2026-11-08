/**
 * 자동 저장 순서 관리 (React 밖에서도 시험할 수 있도록 store.tsx에서 분리).
 * - 저장은 들어온 순서대로 하나씩 실행한다.
 * - 실패하면 멈추고(resume 전까지 다음 저장을 건너뜀), 성공하면 마지막 저장 상태와 비교해 바뀐 프로젝트를 알려 준다.
 * - 비교 기준(lastSaved)은 저장에 성공했을 때만 바뀐다 → 실패 후 다시 저장하면 그동안의 변경이 한 번에 잡힌다.
 */
import type { AppState } from '../types';
import { changedProjects, type SaveChange } from './project-history';

export interface SaveEngine { save(state: AppState): Promise<void> }
export interface SaveLoopHooks {
  isMounted(): boolean;
  /** 저장 직후 정리 작업 (복구 사본 정리 등). 오류를 던지면 저장 실패로 처리 */
  afterSave?(edits: number): Promise<void>;
  onSaved(edits: number, changes: SaveChange[]): void;
  onError(message: string): void;
}

export class SaveLoop {
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private lastSaved: AppState;
  constructor(private engine: SaveEngine, boot: AppState, private hooks: SaveLoopHooks) {
    this.lastSaved = boot;
  }
  get blocked() { return this.failed; }
  /** 저장 실패 후 사용자가 다시 시도를 누르면 호출 */
  resume() { this.failed = false; }
  enqueue(state: AppState, edits: number): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.hooks.isMounted() || this.failed) return;
      try {
        await this.engine.save(state);
        // 저장 성공한 상태 기준으로 바뀐 프로젝트를 찾는다 (실패하면 여기 오지 않으므로 기록 없음)
        const changes = changedProjects(this.lastSaved, state);
        this.lastSaved = state;
        await this.hooks.afterSave?.(edits);
        if (this.hooks.isMounted()) this.hooks.onSaved(edits, changes);
      } catch (e) {
        this.failed = true;
        if (this.hooks.isMounted()) this.hooks.onError(e instanceof Error ? e.message : '저장하지 못했습니다.');
      }
    });
    return this.queue;
  }
}
