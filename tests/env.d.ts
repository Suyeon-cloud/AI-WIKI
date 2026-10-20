// 검증 스크립트 전용 선언 — esbuild가 .md 픽스처를 문자열로 읽어 넣는다 (package.json의 verify 스크립트 참고).
declare module '*.md' {
  const text: string;
  export default text;
}
declare const process: { exit(code: number): never };
