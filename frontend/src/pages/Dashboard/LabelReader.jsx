// src/pages/Dashboard/LabelReader.jsx
//
// "Label scannen" on the intake sheet: photograph the shipping label, and the
// text on it is read (src/ocr/readLabel.js) and shown as a list of lines. Tap
// the line(s) you need - a name, or a name and its address - then tap where
// they go: Leverancier, Bestemming, Afzender, Ontvanger or Opmerkingen.
//
// TWO WAYS OF READING, tried in this order:
//
//   1. With AI (backend warehouse/label_ai.py), when `onAiFill` is given and
//      the AI is set up: the photo goes to our server, which says which part
//      of the label is the supplier, sender, recipient and destination, and
//      looks up whose parcel it is (our shipment, a pre-alert, or the
//      customer number). The page fills in the EMPTY boxes - nothing typed is
//      overwritten - and the worker checks them before releasing the sheet.
//      The photo is read, not stored.
//   2. On the device (src/ocr/readLabel.js), when the AI is off, offline or
//      fails: the text is read in the browser and nothing leaves the device.
//      Nothing is filled in by guessing then - the person holding the box
//      knows which name is the sender.
//
// Either way the label's lines are shown afterwards, so a line can still be
// tapped into a box by hand: tap the line(s), then the box.
//
// "Label scannen" opens the camera on the page (webcam on a computer, back
// camera on a phone); "Foto van label kiezen" reads a photo already on the
// device.

import { useEffect, useRef, useState } from 'react';
import { readLabelWithAi } from '../../api/staff';
import { captureJpeg } from '../../measurement/cameraService';
import { readLabel } from '../../ocr/readLabel';
import { useCamera } from '../Warehouse/camera/useCamera';
import { cameraProblem } from './cameraProblems';
import { Banner } from './ui';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

// Where a line can go: the form field, and the label on its button.
const TARGETS = ['supplier', 'destination', 'sender', 'recipient', 'notes'];

/** The match the server found, as one line for the floor. */
function matchLine(match, d) {
  if (!match) return '';
  const customer = match.customer || '—';
  if (match.kind === 'shipment') return d('matchShipment', { number: match.tracking_number, customer });
  if (match.kind === 'customer') return d('matchCustomer', { code: match.customer_code, customer });
  // A courier number a customer pre-alerted: the shop and what was bought help
  // put the box with the right order.
  return [d('matchCourier', { customer }), match.shop_name, match.order_description].filter(Boolean).join(' · ');
}

/**
 * @param {{ onPick: (field: string, text: string) => void,
 *           onAiFill?: (result: object) => string[],
 *           disabled?: boolean }} props
 *   onPick    called with the form field and the chosen text
 *   onAiFill  called with the AI's reading ({ fields, tracking_number });
 *             returns the names of the fields it filled in. Without it the
 *             label is only ever read on the device.
 *   disabled  the sheet is released: nothing can be filled in
 */
export default function LabelReader({ onPick, onAiFill, disabled = false }) {
  const d = usePageText('intakeCamera');
  const fileInput = useRef(null);
  // The label's lines, once read. null = nothing read yet.
  const [lines, setLines] = useState(null);
  // Indexes of the lines tapped, in the order they were tapped.
  const [selected, setSelected] = useState([]);
  // Indexes of lines already put into a field - shown dimmed, still tappable.
  const [used, setUsed] = useState([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // Whose parcel it is, when the AI's reading found it in our records.
  const [match, setMatch] = useState(null);
  const [readingWithAi, setReadingWithAi] = useState(false);

  const {
    videoRef,
    status: cameraStatus,
    error: cameraError,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraShown = cameraOpen && !disabled;

  // Camera on while the panel shows, off when it goes (see IntakePhotos.jsx).
  useEffect(() => {
    if (cameraShown) startCamera();
    else stopCamera();
  }, [cameraShown, startCamera, stopCamera]);

  if (disabled) return null;

  /** Read with AI. True when it worked; false means: read on the device instead. */
  async function readWithAi(image) {
    setReadingWithAi(true);
    try {
      const result = await readLabelWithAi(image);
      const filled = onAiFill(result);
      setLines(result.lines?.length ? result.lines : null);
      setSelected([]);
      setUsed([]);
      setMatch(result.match ?? null);
      setCameraOpen(false);
      setNote(
        filled.length
          ? d('aiFilled', { fields: filled.map((field) => d(`field.${field}`)).join(', ') })
          : d('aiNothing'),
      );
      return true;
    } catch {
      return false;
    } finally {
      setReadingWithAi(false);
    }
  }

  async function read(image) {
    setReading(true);
    setError('');
    setNote('');
    setMatch(null);
    try {
      if (onAiFill && (await readWithAi(image))) return;
      const found = await readLabel(image);
      if (found.length === 0) {
        setError(d('noText'));
        return;
      }
      setLines(found);
      setSelected([]);
      setUsed([]);
      setCameraOpen(false);
      // Said only when the AI was tried and could not help.
      if (onAiFill) setNote(d('onDevice'));
    } catch {
      setError(d('readFailed'));
    } finally {
      setReading(false);
    }
  }

  // "Lees label": the picture on screen right now.
  async function readFromCamera() {
    const picture = await captureJpeg(videoRef.current);
    if (!picture) {
      setError(d('starting'));
      return;
    }
    await read(picture);
  }

  // Tap a line: select it, or tap again to unselect.
  function toggle(index) {
    setSelected((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
    setNote('');
  }

  // Tap a field: the selected lines go into it, joined with commas
  // ("J. Jansen, Kaya Grandi 12, Willemstad").
  function put(field, label) {
    const text = selected.map((index) => lines[index]).join(', ');
    onPick(field, text);
    setUsed((current) => [...new Set([...current, ...selected])]);
    setSelected([]);
    setNote(d('filledIn', { field: label }));
  }

  const busy = reading;

  return (
    <div className={styles.labelReader}>
      <Banner tone="error">{error}</Banner>

      {/* The live camera, while it is open. */}
      {cameraShown && (
        <div className={styles.intakeCamera}>
          {cameraError ? (
            <p className={styles.intakeHint}>{cameraProblem(cameraError, d)}</p>
          ) : (
            <>
              <video ref={videoRef} className={styles.intakeCameraVideo} muted playsInline />
              <p className={styles.intakeHint}>{d('holdLabel')}</p>
            </>
          )}
          <div className={styles.intakeCameraButtons}>
            {!cameraError && (
              <button
                type="button"
                className={styles.intakeRelease}
                disabled={busy || cameraStatus !== 'live'}
                onClick={readFromCamera}
              >
                {cameraStatus !== 'live'
                  ? d('cameraStarting')
                  : readingWithAi
                    ? d('aiReading')
                    : busy
                      ? d('readingLabel')
                      : d('readLabel')}
              </button>
            )}
            <button type="button" className={styles.rowButton} onClick={() => setCameraOpen(false)}>
              {d('close')}
            </button>
          </div>
        </div>
      )}

      {/* Hidden: "Foto van label kiezen" opens it. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className={styles.srOnly}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const [file] = event.target.files;
          if (file) read(file);
          // Cleared, so choosing the same photo again still counts as a change.
          event.target.value = '';
        }}
      />

      {!cameraShown && (
        <div className={styles.intakeCameraButtons}>
          <button
            type="button"
            className={styles.rowButton}
            disabled={busy}
            onClick={() => setCameraOpen(true)}
          >
            {lines ? d('scanAnother') : d('scanLabel')}
          </button>
          <button
            type="button"
            className={styles.rowButton}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {d('pickLabelPhoto')}
          </button>
        </div>
      )}

      {/* Reading takes a few seconds; the very first time longer, while the
          reader itself downloads. */}
      {reading && !cameraShown && (
        <p className={styles.intakeHint}>{readingWithAi ? d('aiReading') : d('reading')}</p>
      )}

      {/* Whose parcel it is - from our own records, not from the AI. */}
      {match && <Banner tone="info">{matchLine(match, d)}</Banner>}
      {note && !lines && <p className={styles.intakeHint}>{note}</p>}

      {lines && (
        <>
          <p className={styles.intakeHint}>{d('tapLines')}</p>
          <div className={styles.labelLines}>
            {lines.map((line, index) => {
              const order = selected.indexOf(index);
              return (
                <button
                  // Lines can repeat on a label, so the index is part of the key.
                  key={`${index}-${line}`}
                  type="button"
                  aria-pressed={order !== -1}
                  className={[
                    styles.labelLine,
                    order !== -1 ? styles.labelLineOn : '',
                    used.includes(index) ? styles.labelLineUsed : '',
                  ].join(' ')}
                  onClick={() => toggle(index)}
                >
                  {/* With more than one line selected, the number says in
                      which order they will be joined. */}
                  {order !== -1 && selected.length > 1 && (
                    <span className={styles.labelLineOrder}>{order + 1}</span>
                  )}
                  {line}
                </button>
              );
            })}
          </div>

          {selected.length > 0 && (
            <div className={styles.labelTargets}>
              <span className={styles.intakeLabel}>{d('putIn')}</span>
              {TARGETS.map((field) => (
                <button
                  key={field}
                  type="button"
                  className={styles.intakeRelease}
                  onClick={() => put(field, d(`field.${field}`))}
                >
                  {d(`field.${field}`)}
                </button>
              ))}
            </div>
          )}

          {note && <p className={styles.intakeHint}>{note}</p>}
        </>
      )}
    </div>
  );
}
