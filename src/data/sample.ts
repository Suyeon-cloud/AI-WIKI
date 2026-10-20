import type { Analysis, Material, ResearchSettings, TranscriptSummary, WritingState } from '../types';

export const DEFAULT_SETTINGS: ResearchSettings = {
  topic: 'AI 모션그래픽 기반 한중문화콘텐츠 개발 연구',
  keywords: ['AI 모션그래픽', '한중문화콘텐츠', '중국 드라마', '생성형 AI', '문화콘텐츠 개발'],
  overview:
    'AI 모션그래픽을 활용하여 드라마 속 언어·문화 정보를 전달하는 한중문화콘텐츠를 개발하고, 생성형 AI가 콘텐츠 기획·정보 정리·구현 과정에서 어떻게 활용될 수 있는지 살펴본다.',
  defaultView:
    '드라마 장면 속 언어·문화 정보를 사용자가 직관적으로 이해할 수 있도록 시각화하고 콘텐츠로 구성하는 방식에 주목한다.',
};

export const DEFAULT_WRITING: WritingState = {
  docType: '학술논문',
  depth: '중급',
  length: 6000,
  outline: [],
  selectedSection: '',
  text: '',
  feedback: [],
  history: [],
};

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

export const SAMPLE_MATERIALS: Material[] = [
  {
    id: 'sample-01',
    title: '샘플 연구자료 01 — 생성형 AI 기반 문화콘텐츠 제작',
    sourceType: 'PDF',
    origin: '원본 자료',
    topic: '생성형 AI와 문화콘텐츠 제작 과정',
    keywords: ['생성형 AI', '문화콘텐츠 개발', '제작 워크플로'],
    relevance: 5,
    para: 'Projects',
    createdAt: d(9),
    fileName: 'sample-01.pdf',
    fileSize: 1_240_000,
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: true,
  },
  {
    id: 'sample-02',
    title: '샘플 연구자료 02 — 모션그래픽의 정보 전달 방식',
    sourceType: 'PDF',
    origin: '원본 자료',
    topic: '모션그래픽의 시각적 정보 전달',
    keywords: ['AI 모션그래픽', '정보 시각화', '타이포그래피'],
    relevance: 4,
    para: 'Areas',
    createdAt: d(7),
    fileName: 'sample-02.pdf',
    fileSize: 860_000,
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: true,
  },
  {
    id: 'sample-03',
    title: '샘플 연구자료 03 — 중국 드라마의 문화적 요소',
    sourceType: 'PDF',
    origin: '원본 자료',
    topic: '중국 드라마 속 언어·문화 요소',
    keywords: ['중국 드라마', '한중문화콘텐츠', '문화 요소'],
    relevance: 4,
    para: 'Resources',
    createdAt: d(5),
    fileName: 'sample-03.pdf',
    fileSize: 2_010_000,
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: false,
  },
  {
    id: 'sample-web',
    title: '샘플 웹자료 — Remotion 기반 모션그래픽 제작 참고자료',
    sourceType: 'Web',
    origin: '원본 자료',
    topic: '코드 기반 모션그래픽 제작 도구',
    keywords: ['AI 모션그래픽', 'Remotion', '제작 도구'],
    relevance: 3,
    para: 'Resources',
    createdAt: d(3),
    url: 'https://www.remotion.dev/',
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: false,
  },
  {
    id: 'sample-yt',
    title: '샘플 YouTube 자료 — 중국 드라마 문화 분석 영상',
    sourceType: 'YouTube',
    origin: '원본 자료',
    topic: '중국 드라마 문화 분석',
    keywords: ['중국 드라마', '문화 분석', '영상 자료'],
    relevance: 3,
    para: 'Resources',
    createdAt: d(2),
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: false,
  },
  {
    id: 'sample-hwpx',
    title: '샘플 HWPX 자료 — 연구계획서 초안 (파싱 추후 지원)',
    sourceType: 'HWPX',
    origin: '원본 자료',
    topic: '연구계획 정리',
    keywords: ['연구계획', '문화콘텐츠 개발'],
    relevance: 2,
    para: 'Archives',
    createdAt: d(12),
    fileName: 'sample-plan.hwpx',
    fileSize: 340_000,
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: false,
  },
  {
    id: 'sample-note',
    title: '샘플 AI 정리 노트 — 키워드별 자료 묶음 (Demo)',
    sourceType: 'Markdown',
    origin: 'AI 생성 자료',
    topic: '키워드 기반 자료 분류',
    keywords: ['생성형 AI', '자료 정리'],
    relevance: 2,
    para: 'Areas',
    createdAt: d(1),
    content:
      '# 키워드별 자료 묶음 (Demo)\n\n- AI 모션그래픽: 샘플 연구자료 02, 샘플 웹자료\n- 중국 드라마: 샘플 연구자료 03, 샘플 YouTube 자료\n- 생성형 AI: 샘플 연구자료 01',
    isSample: true,
    bibStatus: '서지정보 확인 필요',
    citationIncluded: false,
  },
];

/** Demo 분석 결과 생성: 외부 API 호출 없이 자료 메타데이터와 연구 설정을 조합한 준비된 템플릿 */
export function demoAnalysis(m: Material, s: ResearchSettings): Analysis {
  const presets: Record<string, Partial<Analysis>> = {
    'sample-01': {
      relevance: 5,
      summary:
        '생성형 AI를 문화콘텐츠 기획·제작 단계에 도입하는 흐름을 다루는 자료로 가정한 Demo 요약입니다. 아이디어 발상, 자료 정리, 시각 요소 초안 생성 단계에서 AI의 역할을 구분해 볼 수 있습니다.',
      connection: 'AI 기반 콘텐츠 제작 및 모션그래픽 구성 방법을 설계하는 데 참고할 수 있음',
      insights: [
        '언어·문화 정보의 성격에 따라 서로 다른 시각적 표현 방식을 설계할 필요가 있음',
        '생성형 AI는 최종 산출물보다 기획·초안 단계에서 효율을 높이는 도구로 위치시킬 수 있음',
      ],
    },
    'sample-02': {
      relevance: 4,
      summary:
        '모션그래픽이 텍스트·도형·움직임을 결합해 정보를 순차적으로 전달하는 방식을 정리한 자료로 가정한 Demo 요약입니다.',
      connection: '드라마 장면 위 언어 정보(어휘·표현) 자막형 그래픽 설계에 응용할 수 있음',
      insights: [
        '정보의 위계(핵심 어휘 → 의미 → 문화적 맥락)를 움직임의 순서로 표현할 수 있음',
        '화면 체류 시간과 정보량의 균형이 학습 효과에 영향을 줄 수 있음',
      ],
    },
    'sample-03': {
      relevance: 4,
      summary:
        '중국 드라마에 나타나는 호칭, 음식, 명절, 예절 등 문화적 요소를 범주화하는 자료로 가정한 Demo 요약입니다.',
      connection: '콘텐츠에서 다룰 문화 정보의 범주와 선정 기준을 정하는 데 참고할 수 있음',
      insights: [
        '문화 요소를 범주별로 나누면 모션그래픽 템플릿을 범주 단위로 설계할 수 있음',
        '한국 시청자에게 낯선 요소와 익숙한 요소를 구분해 설명 깊이를 조절할 필요가 있음',
      ],
    },
  };
  const p = presets[m.id] ?? {};
  const rel = p.relevance ?? m.relevance;
  return {
    summary:
      p.summary ??
      '현재 연구 주제와 자료 정보를 바탕으로 구성한 Demo 분석 결과입니다.',
    topic: m.topic || '주제 미지정',
    keywords: m.keywords.length ? m.keywords : s.keywords.slice(0, 3),
    relevance: rel,
    rationale: `연구 키워드(${s.keywords.slice(0, 3).join(', ')})와 자료 키워드(${m.keywords.join(', ') || '없음'})의 겹침 정도, 자료 유형(${m.sourceType})을 기준으로 ${rel}/5로 판단한 Demo 근거입니다.`,
    connection: p.connection ?? '연구 주제의 배경 자료 또는 사례 자료로 활용 가능성을 검토할 수 있음',
    insights: p.insights ?? ['자료의 핵심 개념을 연구 키워드와 대응시켜 정리할 필요가 있음'],
    citationCandidate: `${m.title} — 저자·발행처·연도 등 서지정보 확인 필요`,
  };
}

export function demoTranscript(m: Material): TranscriptSummary {
  return {
    points: [
      '영상은 중국 드라마 장면에 등장하는 호칭·인사 표현을 중심으로 문화적 배경을 설명하는 구성으로 가정합니다.',
      '장면별로 등장인물의 관계에 따라 표현이 달라지는 점을 강조합니다.',
      '한국어 화자에게 혼동되기 쉬운 표현을 비교하는 구간이 있다고 가정합니다.',
    ],
    segments: [
      { time: '00:00', text: '[Demo 자막] 영상 소개 및 다룰 드라마 장면 안내' },
      { time: '01:30', text: '[Demo 자막] 가족 간 호칭 표현과 문화적 의미' },
      { time: '04:10', text: '[Demo 자막] 명절 장면에 나타난 음식·예절 요소' },
      { time: '07:45', text: `[Demo 자막] 정리 — 「${m.title}」 핵심 요약` },
    ],
  };
}

export const OUTLINES: Record<string, string[]> = {
  '분석 보고서': ['1. 분석 배경', '2. 자료 현황', '3. 주요 분석 결과', '4. 시사점', '5. 결론 및 제언'],
  학술논문: [
    'Ⅰ. 서론',
    'Ⅱ. 이론적 배경 — 생성형 AI와 모션그래픽',
    'Ⅲ. 중국 드라마 속 언어·문화 정보의 유형',
    'Ⅳ. AI 모션그래픽 기반 콘텐츠 설계',
    'Ⅴ. 결론',
  ],
  학위논문: [
    '제1장 서론',
    '제2장 선행연구 검토',
    '제3장 연구 방법',
    '제4장 한중문화콘텐츠 개발 과정',
    '제5장 결과 및 논의',
    '제6장 결론',
  ],
  강의노트: ['1주차 개요', '2. 핵심 개념', '3. 사례 살펴보기', '4. 토론 질문', '5. 정리'],
};
