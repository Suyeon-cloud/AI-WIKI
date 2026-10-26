/**
 * 학위논문 원고(JSON) → 한국외대 서식 HWPX 파일
 * 사용: npm run thesis:hwpx -- <원고.json> <출력.hwpx>
 * JSON 형식은 src/lib/hwpx.ts의 ThesisDoc 참고 (.claude/skills/hufs-thesis-writing/SKILL.md에 예시)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildThesisHwpx, type ThesisDoc } from '../src/lib/hwpx';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('사용법: npm run thesis:hwpx -- <원고.json> <출력.hwpx>');
  process.exit(1);
}
const doc = JSON.parse(readFileSync(input, 'utf8').replace(/^﻿/, '')) as ThesisDoc;
for (const k of ['titleKo', 'department', 'student', 'advisor', 'year', 'month'] as const)
  if (typeof doc[k] !== 'string') {
    console.error(`원고 JSON에 '${k}' 값이 없습니다.`);
    process.exit(1);
  }
doc.degree = doc.degree === '박사' ? '박사' : '석사';
doc.chapters ??= [];
doc.references ??= [];
writeFileSync(output, buildThesisHwpx(doc));
console.log(`HWPX 생성: ${output} (장 ${doc.chapters.length}개, 참고문헌 ${doc.references.length}건)`);
