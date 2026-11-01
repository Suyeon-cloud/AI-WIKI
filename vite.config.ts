import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiServerPlugin } from './server/dev.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  if (Object.keys(env).some((name) => /^VITE_.*(ANTHROPIC|CLAUDE|KCI|SECRET|SERVICE_ROLE|PASSWORD)/i.test(name) && env[name])) {
    throw new Error('비밀키를 VITE_ 환경변수에 넣을 수 없습니다. 서버 전용 환경변수로 옮겨 주세요.');
  }
  return {
  plugins: [react(), aiServerPlugin(env)],
  // localStorage는 주소(포트)별로 따로 저장되므로 포트를 고정한다.
  // 5173이 사용 중이면 다른 포트로 바꾸지 않고 오류를 내서, 저장 자료가 사라진 것처럼 보이는 일을 막는다.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  };
});
