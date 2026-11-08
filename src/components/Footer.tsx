/** 모든 화면 하단의 제작자 정보 (로그인 화면은 배경에 맞춘 밝은 글자) */
export function Footer({ variant = 'app' }: { variant?: 'app' | 'login' }) {
  return (
    <footer className={`site-footer site-footer-${variant}`}>
      <strong>AI-WIKI</strong>
      <span>AI 기반 학술 연구자료 관리 및 논문 집필 지원 플랫폼</span>
      <span>© 2026 이수연</span>
      <span>한국외국어대학교 일반대학원 한중문화학과</span>
    </footer>
  );
}
