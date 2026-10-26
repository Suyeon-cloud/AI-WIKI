/**
 * PDF 텍스트 추출 (pdf.js, 브라우저 안에서만 처리 — 파일을 업로드하지 않음)
 * pdf.js는 용량이 커서 PDF를 처음 읽을 때 불러온다.
 */

export interface PdfText {
  pages: string[]; // 페이지별 텍스트 (줄바꿈 유지)
  numPages: number;
  title?: string; // PDF 문서 정보의 제목
  author?: string;
  /** 1쪽에서 가장 큰 글자로 쓰인 줄 (논문 제목 후보) */
  largestLines: string[];
}

type TextItem = { str: string; hasEOL?: boolean; transform: number[]; height?: number };

let lib: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  return lib;
}

/** 페이지 텍스트를 줄 단위로 복원 (같은 줄의 조각은 이어 붙이고, y좌표가 바뀌면 줄바꿈) */
function joinItems(items: TextItem[]): { text: string; lines: { text: string; size: number }[] } {
  const lines: { text: string; size: number }[] = [];
  let cur = '';
  let size = 0;
  let lastY: number | null = null;
  const flush = () => {
    if (cur.trim()) lines.push({ text: cur.replace(/\s+/g, ' ').trim(), size });
    cur = '';
    size = 0;
  };
  for (const it of items) {
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 0;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, h * 0.5)) flush();
    cur += it.str;
    size = Math.max(size, h);
    lastY = y;
    if (it.hasEOL) {
      flush();
      lastY = null;
    }
  }
  flush();
  return { text: lines.map((l) => l.text).join('\n'), lines };
}

export async function readPdf(file: Blob, maxPages = 40): Promise<PdfText> {
  const m = await pdfjs();
  const doc = await m.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    let largestLines: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const { text, lines } = joinItems(tc.items.filter((x) => 'str' in x) as unknown as TextItem[]);
      pages.push(text);
      if (i === 1 && lines.length) {
        const max = Math.max(...lines.map((l) => l.size));
        largestLines = lines.filter((l) => l.size >= max * 0.92 && l.text.length > 1).map((l) => l.text);
      }
      page.cleanup();
    }
    const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as { Title?: string; Author?: string };
    return {
      pages,
      numPages: doc.numPages,
      title: info.Title?.trim() || undefined,
      author: info.Author?.trim() || undefined,
      largestLines,
    };
  } finally {
    void doc.destroy();
  }
}
