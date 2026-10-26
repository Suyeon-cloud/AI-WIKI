import { useEffect, type ReactNode } from 'react';
import type { SourceType } from '../types';
import { useStore } from '../store';

export type Status = 'real' | 'demo' | 'planned' | 'local' | 'ai';
const STATUS_TEXT: Record<Status, string> = {
  real: '실제 기능',
  demo: 'Demo',
  planned: '연동 예정',
  local: '브라우저 로컬',
  ai: 'Claude AI',
};
const STATUS_TITLE: Record<Status, string> = {
  real: '브라우저에서 실제로 동작하는 기능입니다.',
  demo: '외부 AI/서비스를 호출하지 않고 준비된 샘플 결과를 보여줍니다.',
  planned: '현재 프로토타입에서는 동작하지 않으며 추후 연동 예정입니다.',
  local: '이 브라우저의 localStorage에만 저장됩니다. 서버·클라우드에 저장되지 않습니다.',
  ai: 'Claude API를 실제로 호출합니다. 결과는 연구자가 검토해야 하는 AI 생성물입니다.',
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

/** 가운데 팝업 창. Esc 또는 바깥 클릭으로 닫는다 (busy 중에는 닫지 않음) */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  busy,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose} disabled={busy} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** 프로젝트가 없을 때 안내 */
export function NeedProject({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="need-project">
      <div className="need-icon">📁</div>
      <h2>먼저 연구 프로젝트를 만드세요</h2>
      <p>프로젝트(논문 주제) 단위로 자료 라이브러리 폴더, Obsidian·Google Drive 폴더, AI 분석과 집필이 묶여 관리됩니다.</p>
      <button className="btn btn-primary" onClick={onCreate}>
        ＋ 새 프로젝트 만들기
      </button>
    </div>
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
