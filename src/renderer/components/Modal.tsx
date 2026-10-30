import { CircleCheckBig, X } from 'lucide-react';
import { useEffect } from 'react';
import type { ErrorCode } from '../../shared/ipc';
import { S } from '../../shared/strings';
import yoda from '../assets/baby-yoda-waiting-modal.webp';
import { ProgressBar } from './ProgressBar';

export type ModalState =
  | { kind: 'progress'; fraction: number }
  | { kind: 'done'; url: string }
  | { kind: 'error'; code: ErrorCode; detail?: string }
  | null;

interface Props {
  state: ModalState;
  onOpenDoc(url: string): void;
  onRetry(): void;
  onClose(): void;
}

export function Modal({ state, onOpenDoc, onRetry, onClose }: Props) {
  useEffect(() => {
    if (!state || state.kind === 'progress') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose]);
  if (!state) return null;
  return (
    <div className="backdrop" onClick={state.kind === 'done' ? onClose : undefined}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {state.kind === 'progress' && (
          <>
            <img className="modal__yoda" src={yoda} alt="" draggable={false} />
            <div className="modal__title">{S.creatingDocument}</div>
            <ProgressBar className="progress--modal" fraction={state.fraction} />
          </>
        )}
        {state.kind === 'done' && (
          <>
            <CircleCheckBig className="modal__check" size={48} strokeWidth={2} />
            <div className="modal__title modal__title--tight">{S.completed}</div>
            <button type="button" className="pill-button" onClick={() => onOpenDoc(state.url)} autoFocus>
              {S.reviewDocument}
            </button>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <button type="button" className="icon-button modal__close" aria-label={S.close} onClick={onClose}>
              <X size={24} strokeWidth={2.4} />
            </button>
            <div className="modal__title modal__title--error">{S.errorTitle}</div>
            <div className="modal__body">{S.errors[state.code]}</div>
            {state.detail && <div className="modal__detail">{state.detail}</div>}
            <button type="button" className="pill-button" onClick={onRetry} autoFocus>
              {S.retry}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
