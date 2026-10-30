import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { compareDates, daysInMonth, formatMonthYear, formatPickerHeader, todayParts, weekday, type DateParts } from '../../shared/dates';
import { S, WEEKDAYS_NARROW } from '../../shared/strings';

interface Props {
  value: DateParts | null;
  onChange(v: DateParts | null): void;
  onClose(): void;
}

/** Material-style date picker, as drawn in the Figma frame "Filled_Dropdate". */
export function DatePicker({ value, onChange, onClose }: Props) {
  const today = todayParts();
  const [sel, setSel] = useState<DateParts | null>(value);
  const [view, setView] = useState({ year: (value ?? today).year, month: (value ?? today).month });
  const [years, setYears] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.date-field')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const step = (delta: number) =>
    setView((v) => {
      const m = v.month + delta;
      return m < 1 ? { year: v.year - 1, month: 12 } : m > 12 ? { year: v.year + 1, month: 1 } : { year: v.year, month: m };
    });

  const first = weekday({ ...view, day: 1 });
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysInMonth(view.year, view.month) }, (_, i) => i + 1)];
  const header = sel ?? today;

  return (
    <div className="picker" ref={ref} role="dialog" aria-label={S.pickerTitle}>
      <div className="picker__title">{S.pickerTitle}</div>
      <div className="picker__header">{formatPickerHeader(header)}</div>
      <div className="picker__rule" />
      <div className="picker__nav">
        <button type="button" className="picker__month" onClick={() => setYears((y) => !y)} aria-expanded={years}>
          {formatMonthYear(view.year, view.month)} <ChevronDown size={14} strokeWidth={2.6} />
        </button>
        {!years && (
          <div className="picker__arrows">
            <button type="button" className="icon-button" aria-label={S.prevMonth} onClick={() => step(-1)}>
              <ChevronLeft size={20} strokeWidth={2.4} />
            </button>
            <button type="button" className="icon-button" aria-label={S.nextMonth} onClick={() => step(1)}>
              <ChevronRight size={20} strokeWidth={2.4} />
            </button>
          </div>
        )}
      </div>
      {years ? (
        <div className="picker__years">
          {Array.from({ length: 21 }, (_, i) => today.year - 15 + i).map((y) => (
            <button
              key={y}
              type="button"
              className={`picker__year${y === view.year ? ' picker__year--on' : ''}`}
              onClick={() => {
                setView((v) => ({ ...v, year: y }));
                setYears(false);
              }}
            >
              {y}
            </button>
          ))}
        </div>
      ) : (
        <div className="picker__grid">
          {WEEKDAYS_NARROW.map((d, i) => (
            <div key={`h${i}`} className="picker__dow">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />;
            const date = { ...view, day: d };
            const isSel = !!sel && compareDates(sel, date) === 0;
            const isToday = compareDates(today, date) === 0;
            return (
              <button
                key={d}
                type="button"
                className={`picker__day${isSel ? ' picker__day--on' : ''}${isToday ? ' picker__day--today' : ''}`}
                onClick={() => setSel(date)}
                aria-pressed={isSel}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}
      <div className="picker__actions">
        <button type="button" className="picker__text-btn" onClick={() => { onChange(null); onClose(); }}>
          {S.pickerClear}
        </button>
        <span className="picker__spacer" />
        <button type="button" className="picker__text-btn" onClick={onClose}>
          {S.pickerCancel}
        </button>
        <button type="button" className="picker__text-btn" onClick={() => { onChange(sel); onClose(); }}>
          {S.pickerOk}
        </button>
      </div>
    </div>
  );
}
