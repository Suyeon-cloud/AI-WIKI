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

import { joinItems, type TextItem } from './pdf-text';

/**
 * 한글·한자 CID 글꼴의 글자 코드를 유니코드로 바꾸는 CMap (pdfjs-dist/cmaps).
 * 넘기지 않으면 한글이 빠지거나 깨진다. 앱에 포함해 두고 PDF가 요구하는 것만 불러온다.
 */
const CMAPS = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
class BundledCMapReaderFactory {
  constructor(_: { baseUrl?: string | null; isCompressed?: boolean }) {}
  async fetch({ name }: { name: string }) {
    const load = CMAPS[`/node_modules/pdfjs-dist/cmaps/${name}.bcmap`];
    if (!load) throw new Error(`CMap을 찾을 수 없습니다: ${name}`);
    const res = await fetch(await load());
    if (!res.ok) throw new Error(`CMap을 불러오지 못했습니다: ${name}`);
    return { cMapData: new Uint8Array(await res.arrayBuffer()), isCompressed: true };
  }
}

let lib: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  return lib;
}

export async function readPdf(file: Blob, maxPages = 40): Promise<PdfText> {
  const m = await pdfjs();
  const doc = await m.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    cMapPacked: true,
    useWorkerFetch: false,
    CMapReaderFactory: BundledCMapReaderFactory,
  } as Parameters<typeof m.getDocument>[0]).promise;
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
