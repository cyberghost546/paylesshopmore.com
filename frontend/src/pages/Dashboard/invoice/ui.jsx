// src/pages/Dashboard/invoice/ui.jsx
//
// Small building blocks shared by the invoice editor and its settings page:
//
//   BootstrapScope  - the wrapper that switches Bootstrap styling on
//   Field           - a label, an input, and its error or hint underneath
//   SearchSelect    - a search box with a dropdown of results (customers,
//                     shipments) fetched from the server as you type
//   ConfirmDialog   - "Are you sure?" before something you cannot undo
//
// All of them use Bootstrap's CSS classes only. No Bootstrap JavaScript is
// loaded: React already decides what is on screen, and two libraries
// toggling the same dropdown fight each other.

import { useEffect, useId, useRef, useState } from 'react';
import './invoice.scss';
import { useInvoiceText } from './useInvoiceText';

/**
 * Everything inside gets Bootstrap styles; nothing outside does.
 * See invoice.scss for why there are two nested elements.
 */
export function BootstrapScope({ children }) {
  return (
    <div className="pls-bs">
      <div data-bs-theme="light">{children}</div>
    </div>
  );
}

/**
 * A labelled form field with room for an error message.
 *
 * Pass the input as a function so it receives the id and the Bootstrap
 * classes - that is what links the <label> to the <input> for screen readers
 * and makes a click on the label focus the input:
 *
 *   <Field label="Gewicht (kg)" error={errors.weight_kg}>
 *     {(props) => <input {...props} value={...} onChange={...} />}
 *   </Field>
 */
export function Field({ label, error, hint, className = '', children }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={`mb-3 ${className}`}>
      <label htmlFor={id} className="form-label fw-semibold small mb-1">
        {label}
      </label>
      {children({
        id,
        className: `form-control${error ? ' is-invalid' : ''}`,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {error && (
        <div id={`${id}-error`} className="invalid-feedback d-block">
          {error}
        </div>
      )}
      {!error && hint && (
        <div id={`${id}-hint`} className="form-text">
          {hint}
        </div>
      )}
    </div>
  );
}

// How long to wait after the last keystroke before searching, so typing
// "Smith" is one request rather than five.
const TYPING_PAUSE_MS = 250;

/**
 * A search box with a dropdown of matches, loaded from the server.
 *
 * @param {object} props
 * @param {string} props.label         what the box is for
 * @param {(text: string) => Promise<object[]>} props.search  fetches matches
 * @param {(row: object) => string} props.renderRow   one line per match
 * @param {(row: object) => void} props.onPick        called with the chosen row
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 */
export function SearchSelect({ label, search, renderRow, onPick, placeholder, disabled = false }) {
  const id = useId();
  const tr = useInvoiceText();
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const box = useRef(null);

  // Search when the text changes (after a short pause), but only while the
  // dropdown is open - i.e. while somebody is actually using this box.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState('loading');
      search(text)
        .then((found) => {
          if (cancelled) return;
          setRows(found);
          setState('ready');
        })
        .catch(() => {
          if (!cancelled) setState('error');
        });
    }, text ? TYPING_PAUSE_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, open, search]);

  // Close the dropdown when the user clicks anywhere else.
  useEffect(() => {
    function onClick(event) {
      if (box.current && !box.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="mb-3 position-relative" ref={box}>
      <label htmlFor={id} className="form-label fw-semibold small mb-1">
        {label}
      </label>
      <input
        id={id}
        type="search"
        className="form-control"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div id={`${id}-list`} className="list-group shadow-sm search-select-menu" role="listbox">
          {state === 'loading' && <div className="list-group-item text-muted small">{tr('common.searching')}</div>}
          {state === 'error' && (
            <div className="list-group-item text-danger small">{tr('common.listFailed')}</div>
          )}
          {state === 'ready' && rows.length === 0 && (
            <div className="list-group-item text-muted small">{tr('common.noResults')}</div>
          )}
          {state === 'ready' &&
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected="false"
                className="list-group-item list-group-item-action small"
                onClick={() => {
                  onPick(row);
                  setOpen(false);
                  setText('');
                }}
              >
                {renderRow(row)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * A modal "are you sure?" box, drawn with Bootstrap's modal classes.
 * Rendered only while `open` is true.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, onConfirm, onCancel }) {
  const titleId = useId();
  const tr = useInvoiceText();
  if (!open) return null;

  return (
    <>
      <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title fs-5" id={titleId}>
                {title}
              </h2>
            </div>
            <div className="modal-body">{children}</div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
                {tr('common.cancel')}
              </button>
              <button
                type="button"
                className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}
