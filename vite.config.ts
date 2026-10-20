import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // localStorage는 주소(포트)별로 따로 저장되므로 포트를 고정한다.
  // 5173이 사용 중이면 다른 포트로 바꾸지 않고 오류를 내서, 저장 자료가 사라진 것처럼 보이는 일을 막는다.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
