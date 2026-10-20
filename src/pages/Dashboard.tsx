import { hasMyView, type PageKey } from '../types';
import { useStore } from '../store';
import { PARAS, SOURCE_TYPES, formatDate } from '../lib/utils';
import { Card, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';

const PARA_COLORS = ['#3d6bb3', '#5a9a78', '#c48a3a', '#8a8f98'];

function Donut({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="PARA 분류 비율">
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="18" />
      {data.map((d) => {
        const len = (d.value / total) * c;
        const el = (
          <circle
            key={d.label}
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth="18"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          />
        );
        offset += len;
        return el;
      })}
      <text x="70" y="66" textAnchor="middle" className="donut-num">
        {data.reduce((s, d) => s + d.value, 0)}
      </text>
      <text x="70" y="86" textAnchor="middle" className="donut-cap">
        전체 자료
      </text>
    </svg>
  );
}

export function Dashboard({ go }: { go: (p: PageKey) => void }) {
  const { state, dispatch } = useStore();
  const ms = state.materials;
  const bySource = SOURCE_TYPES.map((t) => ({ t, n: ms.filter((m) => m.sourceType === t).length }));
  const maxSource = Math.max(1, ...bySource.map((x) => x.n));
  const byRel = [5, 4, 3, 2, 1].map((r) => ({ r, n: ms.filter((m) => m.relevance === r).length }));
  const maxRel = Math.max(1, ...byRel.map((x) => x.n));
  const byPara = PARAS.map((p, i) => ({ label: p, value: ms.filter((m) => m.para === p).length, color: PARA_COLORS[i] }));
  const recent = [...ms].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const userAdded = ms.filter((m) => !m.isSample).length;
  const analyzed = ms.filter((m) => m.analysis).length;
  const cited = ms.filter((m) => m.citationIncluded).length;
  const viewDone = ms.filter(hasMyView).length;

  // 자료 키워드 빈도
  const freq = new Map<string, number>();
  ms.forEach((m) => m.keywords.forEach((k) => freq.set(k, (freq.get(k) ?? 0) + 1)));
  const topKw = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <>
      <PageHeader
        title="대시보드"
        desc="연구자료 수집 현황과 논문 관련도, PARA 분류를 한눈에 확인합니다."
        badges={<StatusBadge s="real">자료 추가·삭제 시 자동 반영</StatusBadge>}
      />

      <Card className="topic-card">
        <div className="topic-label">현재 연구 주제</div>
        <div className="topic-title">{state.settings.topic}</div>
        <p className="topic-overview">{state.settings.overview}</p>
        <div className="chips">
          {state.settings.keywords.map((k, i) => (
            <span key={i} className="chip chip-strong">
              {i + 1}. {k}
            </span>
          ))}
        </div>
      </Card>

      <div className="stats">
        <div className="stat">
          <span>전체 연구자료</span>
          <b>{ms.length}</b>
          <small>샘플 {ms.length - userAdded} · 직접 추가 {userAdded}</small>
        </div>
        <div className="stat">
          <span>관련도 4~5등급</span>
          <b>{ms.filter((m) => m.relevance >= 4).length}</b>
          <small>논문 핵심 자료 후보</small>
        </div>
        <div className="stat">
          <span>AI 분석 완료</span>
          <b>{analyzed}</b>
          <small>Demo 분석 기준</small>
        </div>
        <div className="stat">
          <span>나의 관점 작성</span>
          <b>{viewDone} / {ms.length}</b>
          <small>
            작성 완료 {viewDone} · <span className={ms.length - viewDone ? 'view-missing' : ''}>작성 필요 {ms.length - viewDone}</span>
            {ms.length > 0 && ` (${Math.round((viewDone / ms.length) * 100)}%)`}
          </small>
        </div>
        <div className="stat">
          <span>참고문헌 선택</span>
          <b>{cited}</b>
          <small>서지정보 확인 필요 {ms.filter((m) => m.citationIncluded && m.bibStatus !== '서지정보 입력됨').length}건</small>
        </div>
      </div>

      <div className="grid-3">
        <Card title="소스 유형별 자료 수">
          <div className="hbars">
            {bySource.map(({ t, n }) => (
              <div key={t} className="hbar">
                <span className="hbar-label">
                  <SourceTag type={t} />
                </span>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${(n / maxSource) * 100}%` }} />
                </span>
                <span className="hbar-num">{n}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="논문 관련도 분포 (1~5)">
          <div className="vbars">
            {byRel.map(({ r, n }) => (
              <div key={r} className="vbar">
                <span className="vbar-num">{n}</span>
                <span className="vbar-col">
                  <span className={`vbar-fill rel-${r}`} style={{ height: `${(n / maxRel) * 100}%` }} />
                </span>
                <span className="vbar-label">{r}등급</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="PARA 분류별 자료 수">
          <div className="donut-wrap">
            <Donut data={byPara} />
            <ul className="legend-list">
              {byPara.map((p) => (
                <li key={p.label}>
                  <i style={{ background: p.color }} />
                  {p.label}
                  <b>{p.value}</b>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid-2-1">
        <Card title="최근 추가 자료" extra={<button className="btn btn-sm" onClick={() => go('library')}>라이브러리 열기</button>}>
          <table className="table">
            <thead>
              <tr>
                <th>제목</th>
                <th>유형</th>
                <th>관련도</th>
                <th>등록일</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr
                  key={m.id}
                  className="clickable"
                  onClick={() => {
                    dispatch({ type: 'select', id: m.id });
                    go('library');
                  }}
                >
                  <td className="cell-title">{m.title}</td>
                  <td>
                    <SourceTag type={m.sourceType} />
                  </td>
                  <td>
                    <Relevance value={m.relevance} />
                  </td>
                  <td className="muted">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="핵심 키워드" extra={<span className="muted small">자료 키워드 빈도</span>}>
          <div className="kw-cloud">
            {topKw.map(([k, n]) => (
              <span key={k} className="chip" style={{ fontSize: `${12 + Math.min(n, 4) * 1.5}px` }}>
                {k} <small>{n}</small>
              </span>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
