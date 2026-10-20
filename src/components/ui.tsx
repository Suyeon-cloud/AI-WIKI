import type { ReactNode } from 'react';
import type { SourceType } from '../types';
import { useStore } from '../store';

export type Status = 'real' | 'demo' | 'planned' | 'local';
const STATUS_TEXT: Record<Status, string> = {
  real: '실제 기능',
  demo: 'Demo',
  planned: '연동 예정',
  local: '브라우저 로컬',
};
const STATUS_TITLE: Record<Status, string> = {
  real: '브라우저에서 실제로 동작하는 기능입니다.',
  demo: '외부 AI/서비스를 호출하지 않고 준비된 샘플 결과를 보여줍니다.',
  planned: '현재 프로토타입에서는 동작하지 않으며 추후 연동 예정입니다.',
  local: '이 브라우저의 localStorage에만 저장됩니다. 서버·클라우드에 저장되지 않습니다.',
};

export function StatusBadge({ s, children }: { s: Status; children?: ReactNode }) {
  return (
    <span className={`badge badge-${s}`} title={STATUS_TITLE[s]}>
      {children ?? STATUS_TEXT[s]}
    </span>
  );
}

export function SourceTag({ type }: { type: SourceType }) {
  return <span className={`src src-${type.toLowerCase()}`}>{type}</span>;
}

export function Relevance({ value }: { value: number }) {
  return (
    <span className="rel" title={`논문 관련도 ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= value ? 'on' : ''} />
      ))}
      <b>{value}</b>
    </span>
  );
}

export function PageHeader({ title, desc, badges }: { title: string; desc: string; badges?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {badges && <div className="page-badges">{badges}</div>}
    </header>
  );
}

export function Card({
  title,
  extra,
  children,
  className = '',
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {extra && <div className="card-extra">{extra}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
