// src/pages/Dashboard/invoice/InvoiceEditor.jsx
//
// THE INVOICE EDITOR PAGE.
//
//   /dashboard/invoices/new        write a new invoice
//   /dashboard/invoices/:id/edit   open a saved one (review or correct it)
//
// HOW THIS PAGE WORKS - read this before changing it:
//
// 1. All typed values live in ONE object, `form` (shape: emptyForm() in
//    invoiceForm.js). Sections change it through `update({ field: value })`.
//
// 2. On every render, two things are worked out from `form`:
//      computed   = computeInvoice(form, ...)  lines, volume, insurance, totals
//      validation = validate(form, ...)        what is missing or wrong
//    Nothing is stored twice, so the totals can never be out of date.
//
// 3. The right-hand column shows <InvoiceTemplate>, the printable invoice,
//    built from the same `computed` - a live preview.
//
// 4. The buttons talk to the server (api/invoiceEditor.js). The server checks
//    and recalculates everything again; what it says wins.
//
// The page is wrapped in <BootstrapScope>, so Bootstrap classes work here
// without changing the rest of the website.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  calculateInvoice,
  createInvoice,
  deleteInvoice,
  getInvoiceConfig,
  getInvoiceForEditing,
  getInvoiceHistory,
  getShipmentDefaults,
  pdfBlobFromBase64,
  previewInvoicePdf,
  updateInvoice,
} from '../../../api/invoiceEditor';
import ChargesSection from './ChargesSection';
import HeaderSection from './HeaderSection';
import InsuranceSection from './InsuranceSection';
import { printSheet } from './printSheet';
import InvoiceTemplate from './InvoiceTemplate';
import LookupSection from './LookupSection';
import ShipmentSection from './ShipmentSection';
import SummarySection from './SummarySection';
import {
  buildDocument,
  computeInvoice,
  defaultPort,
  emptyForm,
  formFromDefaults,
  formFromSaved,
  hasContent,
  toApiBody,
  validate,
} from './invoiceForm';
import { centsToDecimal } from './invoiceMath';
import { BootstrapScope, ConfirmDialog } from './ui';
import { useInvoiceText } from './useInvoiceText';

// The width of an A4 sheet on screen at 100%: 210 mm at 96 dots per inch.
const SHEET_WIDTH_PX = (210 / 25.4) * 96;

/** A new, empty form with the default ports for sea freight filled in. */
function startingForm(config) {
  const form = emptyForm();
  form.port_of_loading = defaultPort(config.ports, 'sea', 'loading');
  form.port_of_discharge = defaultPort(config.ports, 'sea', 'discharge');
  return form;
}

/**
 * The server's error answer as a list of sentences a person can read.
 * `fallback` is shown when the server sent nothing readable (no connection).
 * The server's own sentences are in English, like the rest of the API.
 */
function serverMessages(failure, fallback) {
  const fields = failure?.fields;
  if (!fields || typeof fields !== 'object') return [fallback];
  const messages = Object.values(fields)
    .flat()
    .filter((message) => typeof message === 'string');
  return messages.length > 0 ? messages : [fallback];
}

/**
 * Keeps the A4 preview as wide as its column by shrinking it with a CSS
 * scale. Returns a "callback ref" for the column, and the scale to apply.
 *
 * A callback ref (a function React calls with the element) rather than
 * useRef: the column only appears once the invoice has loaded, and a plain
 * ref would still be empty when the effect first ran.
 */
function useSheetScale() {
  const [element, setElement] = useState(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, (entry.contentRect.width - 24) / SHEET_WIDTH_PX));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, scale];
}

export default function InvoiceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  // ?package=<id>: opened from a booking ("Make the invoice"), with that
  // shipment already chosen and filled in - see the effect after loading.
  const [params] = useSearchParams();
  const startPackage = id ? null : Number(params.get('package')) || null;
  // tr('editor.save') -> "Factuur opslaan" / "Save invoice" / "Warda factura",
  // in the language chosen in the dashboard's language menu.
  const tr = useInvoiceText();

  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  // null, 'failed' (could not load) or the server's own sentence.
  const [loadError, setLoadError] = useState(null);

  // Errors are shown after the first time somebody presses a button, not
  // while they are still filling the form in for the first time.
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const [busy, setBusy] = useState(''); // which button is working, if any
  const [notice, setNotice] = useState('');
  const [serverCheck, setServerCheck] = useState(null);
  const [existing, setExisting] = useState(null); // shipment already invoiced
  const [saveStatus, setSaveStatus] = useState('pending_review');
  const [pdfUrl, setPdfUrl] = useState(''); // the server PDF shown in the dialog
  const [confirm, setConfirm] = useState(null); // 'clear' | 'delete' | null
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('form'); // small screens: form or preview
  const [previewRef, scale] = useSheetScale();
  // The sheet in the preview, which "Factuur afdrukken" prints (printSheet.js).
  const printArea = useRef(null);

  // ---- loading -------------------------------------------------------------

  // Load the configuration once, then either the saved invoice or a blank form.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await getInvoiceConfig();
        if (cancelled) return;
        setConfig(loaded);
        if (id) {
          const saved = await getInvoiceForEditing(id);
          if (cancelled) return;
          setForm(formFromSaved(saved));
          getInvoiceHistory(id).then((rows) => !cancelled && setHistory(rows)).catch(() => {});
        } else {
          setForm(startingForm(loaded));
        }
      } catch (failure) {
        if (!cancelled) {
          setLoadError(failure?.status === 409 ? serverMessages(failure, '')[0] : 'failed');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // A PDF shown in the dialog is a blob: URL; release it when done.
  useEffect(() => () => pdfUrl && URL.revokeObjectURL(pdfUrl), [pdfUrl]);

  // ---- changing the form -----------------------------------------------------

  const update = useCallback((changes) => {
    setForm((current) => ({ ...current, ...changes }));
    // Anything typed makes an earlier server check out of date.
    setServerCheck(null);
    setNotice('');
  }, []);

  function pickCustomer(customer) {
    // A different customer means the chosen shipment no longer fits.
    setForm((current) => ({
      ...current,
      customer: { id: customer.id, name: customer.name || customer.username },
      package: current.customer?.id === customer.id ? current.package : null,
    }));
    setExisting(null);
  }

  async function pickShipment(shipment) {
    setBusy('lookup');
    setServerErrors([]);
    try {
      const defaults = await getShipmentDefaults(shipment.id);
      // Keep the charges already typed; take everything else from the shipment.
      setForm((current) => ({ ...formFromDefaults(defaults), lines: current.lines }));
      setExisting(defaults.existing_invoice);
      setServerCheck(null);
    } catch (failure) {
      setServerErrors(serverMessages(failure, tr('common.genericError')));
    } finally {
      setBusy('');
    }
  }

  // Opened from a booking with ?package=: choose that shipment once the
  // blank form is there, exactly as picking it from the list would.
  const startedWith = useRef(null);
  useEffect(() => {
    if (!startPackage || !form || form.package || startedWith.current === startPackage) return;
    startedWith.current = startPackage;
    pickShipment({ id: startPackage });
    // pickShipment is a plain function of this render; run once per package.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPackage, form]);

  // ---- worked out on every render --------------------------------------------

  const computed = useMemo(
    () => (form && config ? computeInvoice(form, config.settings) : null),
    [form, config],
  );
  const validation = useMemo(
    () => (form && config ? validate(form, config.settings, config.permissions) : null),
    [form, config],
  );

  if (loadError) {
    return (
      <BootstrapScope>
        <div className="alert alert-danger m-3">
          {loadError === 'failed' ? tr('editor.loadFailed') : loadError}
        </div>
        <Link to="/dashboard/invoices">{tr('common.back')}</Link>
      </BootstrapScope>
    );
  }
  if (!config || !form || !computed) {
    return (
      <BootstrapScope>
        <p className="text-muted p-3">{tr('common.loading')}</p>
      </BootstrapScope>
    );
  }

  const disabled = !form.editable || Boolean(busy);
  // validate() gives message keys ('noLines'); turn them into sentences in
  // the chosen language before handing them to the sections.
  const message = (key) => tr(`errors.${key}`);
  const translate = (keys) => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, message(key)]));
  const errors = showErrors ? translate(validation.fields) : {};
  const lineErrors = showErrors ? translate(validation.lines) : {};
  const doc = buildDocument(form, config, computed);
  const blockedByExisting = existing && !form.invoiceId;

  /** Runs `action` only when the form is valid; otherwise shows what is wrong. */
  async function whenValid(name, action) {
    setShowErrors(true);
    setServerErrors([]);
    setNotice('');
    if (!validation.ok) return;
    setBusy(name);
    try {
      await action();
    } catch (failure) {
      if (failure?.status === 409 && failure.fields?.existing_invoice) {
        setExisting({ id: failure.fields.existing_invoice, number: '', status: failure.fields.status });
      } else {
        setServerErrors(serverMessages(failure, tr('common.genericError')));
      }
    } finally {
      setBusy('');
    }
  }

  // ---- the buttons -------------------------------------------------------------

  /** "Bereken factuur": ask the server for its totals and compare. */
  const calculate = () =>
    whenValid('calculate', async () => {
      const answer = await calculateInvoice(toApiBody(form));
      const mine = computed.totals;
      const pairs = [
        [tr('summary.subtotalWord'), mine?.subtotal, answer.totals.subtotal],
        [tr('summary.vatWord'), mine?.vat, answer.totals.vat],
        [tr('summary.totalWord'), mine?.total, answer.totals.total],
      ];
      const different = pairs.filter(([, local, server]) => centsToDecimal(local) !== server);
      setServerCheck(
        different.length === 0
          ? { state: 'match' }
          : { state: 'mismatch', detail: different.map(([name, , server]) => `${name} ${server}`).join(', ') },
      );
    });

  /** The PDF exactly as the server draws it. */
  async function fetchPdf() {
    const answer = await previewInvoicePdf(toApiBody(form), form.invoiceId);
    return { blob: pdfBlobFromBase64(answer.pdf), number: answer.number };
  }

  const showPdf = () =>
    whenValid('preview', async () => {
      const { blob } = await fetchPdf();
      setPdfUrl(URL.createObjectURL(blob));
    });

  const downloadPdf = () =>
    whenValid('download', async () => {
      const { blob, number } = await fetchPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Factuur-${number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  /**
   * Print the live preview: the sheet alone, at A4, from a frame of its own
   * (printSheet.js) - so the dashboard around it, the preview's zoom and the
   * scroll position cannot spoil it.
   */
  function print() {
    printSheet(printArea.current?.firstElementChild, { title: form?.number || undefined });
  }

  const save = () =>
    whenValid('save', async () => {
      const body = toApiBody(form, saveStatus);
      const saved = form.invoiceId ? await updateInvoice(form.invoiceId, body) : await createInvoice(body);
      // Reload from the server so the page shows exactly what was stored,
      // including the real invoice number.
      const fresh = await getInvoiceForEditing(saved.id);
      setForm(formFromSaved(fresh));
      setHistory(await getInvoiceHistory(saved.id).catch(() => []));
      setShowErrors(false);
      setNotice(
        tr(saveStatus === 'sent' ? 'editor.savedSent' : 'editor.savedQueued', { number: fresh.number }),
      );
      if (!form.invoiceId) navigate(`/dashboard/invoices/${saved.id}/edit`, { replace: true });
    });

  function clearForm() {
    setConfirm(null);
    setShowErrors(false);
    setServerErrors([]);
    setServerCheck(null);
    setExisting(null);
    setNotice('');
    if (form.invoiceId) navigate('/dashboard/invoices/new');
    else setForm(startingForm(config));
  }

  async function removeInvoice() {
    setConfirm(null);
    setBusy('delete');
    try {
      await deleteInvoice(form.invoiceId);
      navigate('/dashboard/invoices');
    } catch (failure) {
      setServerErrors(serverMessages(failure, tr('common.genericError')));
      setBusy('');
    }
  }

  const sectionProps = { form, update, errors, disabled, config, computed };

  return (
    <BootstrapScope>
      <div className="container-fluid px-0">
        {/* ---- title and status ---- */}
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <div>
            <h1 className="h3 mb-0">
              {form.invoiceId ? tr('editor.titleSaved', { number: form.number }) : tr('editor.titleNew')}
            </h1>
            {form.status && <span className="badge text-bg-secondary">{tr(`status.${form.status}`)}</span>}
          </div>
          <div className="d-flex gap-2">
            <Link className="btn btn-sm btn-outline-secondary" to="/dashboard/invoices">
              {tr('common.back')}
            </Link>
            {config.permissions.can_configure && (
              <Link className="btn btn-sm btn-outline-secondary" to="/dashboard/invoices/settings">
                {tr('common.settings')}
              </Link>
            )}
          </div>
        </div>

        {!form.editable && (
          <div className="alert alert-info">{tr('editor.readOnly')}</div>
        )}
        {form.rejectionReason && form.status === 'rejected' && (
          <div className="alert alert-warning">
            <strong>{tr('editor.rejected')}</strong> {form.rejectionReason} — {tr('editor.rejectedFix')}
          </div>
        )}
        {blockedByExisting && (
          <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
            <span>{tr('editor.existing', { number: existing.number ? ` (${existing.number})` : '' })}</span>
            <Link className="btn btn-sm btn-warning" to={`/dashboard/invoices/${existing.id}/edit`}>
              {tr('editor.openExisting')}
            </Link>
          </div>
        )}
        {form?.measuredByWarehouse && !form.invoiceId && (
          <div className="alert alert-info" role="status">
            {tr('editor.fromWarehouse')}
          </div>
        )}
        {notice && (
          <div className="alert alert-success" role="status">
            {notice}
          </div>
        )}
        {serverErrors.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <ul className="mb-0 ps-3">
              {serverErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}
        {showErrors && !validation.ok && (
          <div className="alert alert-danger" role="alert">
            <p className="fw-semibold mb-1">{tr('editor.checkForm')}</p>
            <ul className="mb-0 ps-3">
              {validation.list.map((key) => (
                <li key={key}>{message(key)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Small screens: switch between the form and the preview. */}
        <ul className="nav nav-tabs d-xl-none mb-3">
          <li className="nav-item">
            <button type="button" className={`nav-link ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>
              {tr('editor.tabForm')}
            </button>
          </li>
          <li className="nav-item">
            <button type="button" className={`nav-link ${tab === 'preview' ? 'active' : ''}`} onClick={() => setTab('preview')}>
              {tr('editor.tabPreview')}
            </button>
          </li>
        </ul>

        <div className="row g-4">
          {/* ---- the form ---- */}
          <div className={`col-xl-7 ${tab === 'form' ? '' : 'd-none d-xl-block'}`}>
            <form onSubmit={(event) => event.preventDefault()} noValidate aria-label={tr('editor.formLabel')}>
              <LookupSection
                form={form}
                onPickCustomer={pickCustomer}
                onPickShipment={pickShipment}
                disabled={disabled}
                error={errors.package}
              />
              <HeaderSection {...sectionProps} />
              <ShipmentSection {...sectionProps} />
              <ChargesSection {...sectionProps} lineErrors={lineErrors} />
              <InsuranceSection {...sectionProps} />
              <SummarySection {...sectionProps} serverCheck={serverCheck} />

              {/* ---- the buttons ---- */}
              <div className="border-top pt-3 mb-4">
                {form.editable && (
                  <div className="mb-3" style={{ maxWidth: '24rem' }}>
                    <label className="form-label small fw-semibold" htmlFor="save-status">
                      {tr('editor.afterSave')}
                    </label>
                    <select
                      id="save-status"
                      className="form-select form-select-sm"
                      value={saveStatus}
                      disabled={disabled}
                      onChange={(event) => setSaveStatus(event.target.value)}
                    >
                      <option value="pending_review">{tr('editor.afterSaveQueue')}</option>
                      <option value="sent">{tr('editor.afterSaveSend')}</option>
                    </select>
                  </div>
                )}

                <div className="d-flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline-primary" disabled={Boolean(busy)} onClick={calculate}>
                    {busy === 'calculate' ? tr('common.busy') : tr('editor.calculate')}
                  </button>
                  <button type="button" className="btn btn-outline-primary" disabled={Boolean(busy)} onClick={showPdf}>
                    {busy === 'preview' ? tr('common.busy') : tr('editor.preview')}
                  </button>
                  {form.editable && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={Boolean(busy) || blockedByExisting}
                      onClick={save}
                    >
                      {busy === 'save' ? tr('editor.saving') : tr('editor.save')}
                    </button>
                  )}
                  <button type="button" className="btn btn-outline-secondary" disabled={Boolean(busy)} onClick={downloadPdf}>
                    {busy === 'download' ? tr('common.busy') : tr('editor.download')}
                  </button>
                  <button type="button" className="btn btn-outline-secondary" disabled={Boolean(busy)} onClick={print}>
                    {tr('editor.print')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    disabled={Boolean(busy)}
                    onClick={() => (hasContent(form) ? setConfirm('clear') : clearForm())}
                  >
                    {tr('editor.clear')}
                  </button>
                  {form.invoiceId && form.editable && config.permissions.can_delete && (
                    <button type="button" className="btn btn-danger ms-auto" disabled={Boolean(busy)} onClick={() => setConfirm('delete')}>
                      {tr('editor.delete')}
                    </button>
                  )}
                </div>
              </div>

              {history.length > 0 && (
                <details className="mb-4">
                  <summary className="small fw-semibold">{tr('editor.history', { count: history.length })}</summary>
                  <ul className="list-unstyled small mt-2 mb-0">
                    {history.map((row) => (
                      <li key={`${row.at}-${row.action}`}>
                        {new Date(row.at).toLocaleString('nl-NL')} — {row.action_display}
                        {row.actor ? tr('editor.historyBy', { actor: row.actor }) : ''}
                        {row.totals?.total ? tr('editor.historyTotal', { total: row.totals.total.replace('.', ',') }) : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </form>
          </div>

          {/* ---- the live preview ---- */}
          <div className={`col-xl-5 ${tab === 'preview' ? '' : 'd-none d-xl-block'}`} ref={previewRef}>
            <div className="invoice-preview-frame" aria-label={tr('editor.previewLabel')}>
              <div
                ref={printArea}
                className="pls-print-area"
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  width: SHEET_WIDTH_PX,
                  // The transform shrinks how it looks, not the space it takes;
                  // a negative margin hands the unused space back.
                  marginBottom: `calc((${scale} - 1) * 297mm)`,
                }}
              >
                <InvoiceTemplate doc={doc} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- dialogs ---- */}
      <ConfirmDialog
        open={confirm === 'clear'}
        title={tr('editor.clearTitle')}
        confirmLabel={tr('editor.clearConfirm')}
        danger
        onConfirm={clearForm}
        onCancel={() => setConfirm(null)}
      >
        {tr('editor.clearBody')}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        title={tr('editor.deleteTitle', { number: form.number })}
        confirmLabel={tr('editor.deleteConfirm')}
        danger
        onConfirm={removeInvoice}
        onCancel={() => setConfirm(null)}
      >
        {tr('editor.deleteBody')}
      </ConfirmDialog>

      {pdfUrl && (
        <>
          <div className="modal d-block" role="dialog" aria-modal="true" aria-label={tr('editor.pdfTitle')}>
            <div className="modal-dialog modal-xl modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h2 className="modal-title fs-5">{tr('editor.pdfTitle')}</h2>
                  <button type="button" className="btn-close" aria-label={tr('editor.close')} onClick={() => setPdfUrl('')} />
                </div>
                <div className="modal-body p-0">
                  <iframe title={tr('editor.pdfFrame')} src={pdfUrl} style={{ width: '100%', height: '80vh', border: 0 }} />
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show" />
        </>
      )}
    </BootstrapScope>
  );
}
