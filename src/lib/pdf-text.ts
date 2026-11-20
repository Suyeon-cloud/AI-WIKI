/** pdf.js 텍스트 조각 → 줄 복원 (브라우저·테스트 공통, pdf.js 없이 동작) */
export type TextItem = { str: string; hasEOL?: boolean; transform: number[]; height?: number; width?: number };

/** 페이지 텍스트를 줄 단위로 복원 (같은 줄의 조각은 이어 붙이고, y좌표가 바뀌면 줄바꿈, 조각 사이 간격이 있으면 띄어쓰기) */
export function joinItems(items: TextItem[]): { text: string; lines: { text: string; size: number }[] } {
  const lines: { text: string; size: number }[] = [];
  let cur = '';
  let size = 0;
  let lastY: number | null = null;
  let lastEnd: number | null = null;
  const flush = () => {
    if (cur.trim()) lines.push({ text: cur.replace(/\s+/g, ' ').trim(), size });
    cur = '';
    size = 0;
  };
  for (const it of items) {
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 0;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, h * 0.5)) {
      flush();
      lastEnd = null;
    }
    const x = it.transform[4];
    // 같은 줄에서 앞 조각 끝과 이 조각 시작 사이가 글자 크기의 15% 이상 떨어져 있으면 띄어쓰기
    if (cur && lastEnd !== null && x - lastEnd > Math.max(1, h * 0.15) && !/s$/.test(cur) && !/^s/.test(it.str)) cur += ' ';
    cur += it.str;
    lastEnd = typeof it.width === 'number' && it.width > 0 ? x + it.width : null;
    size = Math.max(size, h);
    lastY = y;
    if (it.hasEOL) {
      flush();
      lastY = null;
      lastEnd = null;
    }
  }
  flush();
  return { text: lines.map((l) => l.text).join('\n'), lines };
}
