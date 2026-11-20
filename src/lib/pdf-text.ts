/** pdf.js 텍스트 조각 → 줄 복원 (브라우저·테스트 공통, pdf.js 없이 동작) */
export type TextItem = { str: string; hasEOL?: boolean; transform: number[]; height?: number; width?: number };

/**
 * 페이지 텍스트를 줄 단위로 복원.
 * y좌표가 같은 조각을 한 줄로 모은 뒤 x좌표 순서로 다시 놓는다 (PDF에 따라 '1.1.' 같은 번호가 제목 뒤에 기록되어
 * '연구 배경 및 필요성1.1.'처럼 뒤바뀌는 것을 막음). 조각 사이 간격이 있으면 띄어쓰기.
 */
export function joinItems(items: TextItem[]): { text: string; lines: { text: string; size: number }[] } {
  const lines: { text: string; size: number }[] = [];
  let group: TextItem[] = [];
  let lastY: number | null = null;
  const flush = () => {
    if (!group.length) return;
    const ordered = group.map((it, i) => ({ it, i })).sort((a, b) => a.it.transform[4] - b.it.transform[4] || a.i - b.i).map((x) => x.it);
    let cur = '';
    let size = 0;
    let lastEnd: number | null = null;
    for (const it of ordered) {
      const x = it.transform[4];
      const h = Math.abs(it.transform[3]) || it.height || 0;
      // 앞 조각 끝과 이 조각 시작 사이가 글자 크기의 15% 이상 떨어져 있으면 띄어쓰기
      if (cur && lastEnd !== null && x - lastEnd > Math.max(1, h * 0.15) && !/\s$/.test(cur) && !/^\s/.test(it.str)) cur += ' ';
      cur += it.str;
      lastEnd = typeof it.width === 'number' && it.width > 0 ? x + it.width : null;
      size = Math.max(size, h);
    }
    if (cur.trim()) lines.push({ text: cur.replace(/\s+/g, ' ').trim(), size });
    group = [];
  };
  for (const it of items) {
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 0;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, h * 0.5)) flush();
    if (it.str || group.length) group.push(it);
    lastY = y;
  }
  flush();
  return { text: lines.map((l) => l.text).join('\n'), lines };
}
