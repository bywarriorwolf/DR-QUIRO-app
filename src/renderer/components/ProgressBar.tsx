export function ProgressBar({ fraction, className = '' }: { fraction: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className={`progress ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
