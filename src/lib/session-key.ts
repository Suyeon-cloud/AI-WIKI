/** Deliberately has no browser storage, database or logging dependencies. */
export function createSessionKey() {
  let owner: string | null = null;
  let key = '';
  return {
    syncOwner(next: string | null) { if (owner !== next) { key = ''; owner = next; } },
    set(userId: string, value: string) { owner = userId; key = value.trim(); },
    get(userId: string | null) { return userId && userId === owner ? key : ''; },
    clear() { key = ''; owner = null; },
  };
}
