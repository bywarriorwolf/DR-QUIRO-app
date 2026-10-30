import { Calendar } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReportType } from '../../shared/config';
import { formatFieldDate, type DateParts } from '../../shared/dates';
import { INJURY_KEYS, type FieldKey, type InjuryKey, type ReportForm as Form } from '../../shared/report';
import { S } from '../../shared/strings';
import { DatePicker } from './DatePicker';

interface Props {
  form: Form;
  errors: Partial<Record<FieldKey, true>>;
  hasErrors: boolean;
  onChange(patch: Partial<Form>): void;
  onInjury(key: InjuryKey, value: string): void;
  onType(t: ReportType): void;
  onCreate(): void;
}

const MAX_LEN = 120;

function DateField(props: {
  value: DateParts | null;
  placeholder: string;
  error: boolean;
  disabled: boolean;
  open: boolean;
  onOpen(): void;
}) {
  const { value, placeholder, error, disabled, open, onOpen } = props;
  return (
    <button
      type="button"
      className={`field date-field${error ? ' field--error' : ''}${value ? ' field--filled' : ''}${open ? ' field--open' : ''}`}
      disabled={disabled}
      onClick={onOpen}
      aria-haspopup="dialog"
    >
      <span>{value ? formatFieldDate(value) : error ? S.requiredDate : placeholder}</span>
      <Calendar className="date-field__icon" size={18} strokeWidth={1.6} />
    </button>
  );
}

export function ReportForm({ form, errors, hasErrors, onChange, onInjury, onType, onCreate }: Props) {
  const [picker, setPicker] = useState<'fechaInicial' | 'fechaFinal' | null>(null);
  const inicial = form.type === 'inicial';
  // Fecha Final is the only field that is ever disabled, and only for Reporte Inicial.
  useEffect(() => {
    if (inicial) setPicker((p) => (p === 'fechaFinal' ? null : p));
  }, [inicial]);
  const text = (key: 'nombre' | 'apellido', placeholder: string) => (
    <input
      className={`field field--text${errors[key] ? ' field--error' : ''}`}
      value={form[key]}
      maxLength={MAX_LEN}
      placeholder={errors[key] ? S.requiredField : placeholder}
      onChange={(e) => onChange({ [key]: e.target.value })}
      aria-label={placeholder}
      aria-invalid={!!errors[key]}
      spellCheck={false}
    />
  );

  return (
    <section className="form">
      <div className="form__names">
        {text('nombre', S.nombre)}
        {text('apellido', S.apellidos)}
      </div>
      <div className="form__dates">
        <DateField
          value={form.fechaInicial}
          placeholder={S.fechaInicial}
          error={!!errors.fechaInicial}
          disabled={false}
          open={picker === 'fechaInicial'}
          onOpen={() => setPicker(picker === 'fechaInicial' ? null : 'fechaInicial')}
        />
        <DateField
          value={form.fechaFinal}
          placeholder={S.fechaFinal}
          error={!inicial && !!errors.fechaFinal}
          disabled={inicial}
          open={picker === 'fechaFinal'}
          onOpen={() => setPicker(picker === 'fechaFinal' ? null : 'fechaFinal')}
        />
        {picker && (
          <DatePicker
            key={picker}
            value={form[picker]}
            onChange={(v) => onChange({ [picker]: v })}
            onClose={() => setPicker(null)}
          />
        )}
      </div>
      <div className="divider" />
      <div className="injuries">
        {INJURY_KEYS.map((k) => (
          <label key={k} className="injury">
            <span className="injury__label">{S.injuries[k]}</span>
            <input
              className={`field field--injury${errors[k] ? ' field--error' : ''}`}
              value={form.injuries[k]}
              maxLength={MAX_LEN}
              placeholder={errors[k] ? S.requiredField : S.injuryPlaceholder}
              onChange={(e) => onInjury(k, e.target.value)}
              aria-invalid={!!errors[k]}
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <div className="types" role="radiogroup">
        {(['inicial', 'comparativo'] as const).map((t) => (
          <label key={t} className={`radio${form.type === t ? ' radio--on' : ''}`}>
            <input type="radio" name="type" checked={form.type === t} onChange={() => onType(t)} />
            <span className="radio__dot" aria-hidden />
            {t === 'inicial' ? S.reporteInicial : S.reporteComparativo}
          </label>
        ))}
      </div>
      <button type="button" className={`create${hasErrors ? ' create--error' : ''}`} onClick={onCreate}>
        {S.createFile}
      </button>
    </section>
  );
}
