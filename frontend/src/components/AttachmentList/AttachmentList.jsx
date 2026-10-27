// src/components/AttachmentList/AttachmentList.jsx
//
// The screenshots and photos a customer added to a booking, as a row of
// thumbnails. A click opens the full picture (or downloads the PDF) in a new
// tab. Used in two places with the same look:
//   - the customer's own booking pop-up (src/pages/Profile/MyBookings.jsx)
//   - the office's booking list (src/pages/Dashboard/Bookings.jsx)
//
// Each attachment comes from the API as { id, name, is_image, url }. The url
// is a protected address that checks who is asking, so the picture only
// loads for the customer and for staff - the session cookie goes with it
// because it is the same site.

import { attachmentUrl } from '../../api/booking';
import styles from './AttachmentList.module.css';

/**
 * @param {object} props
 * @param {object[]} props.attachments as listed with the booking
 * @param {(name: string) => string} [props.openLabel] the link's accessible
 *   name, e.g. name => `Open ${name}`
 */
export default function AttachmentList({ attachments, openLabel = (name) => name }) {
  if (!attachments?.length) return null;

  return (
    <ul className={styles.list}>
      {attachments.map((attachment) => {
        const href = attachmentUrl(attachment.url);
        return (
          <li key={attachment.id}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.tile}
              aria-label={openLabel(attachment.name)}
              title={attachment.name}
            >
              {attachment.is_image ? (
                <img src={href} alt="" className={styles.thumb} loading="lazy" />
              ) : (
                <span className={styles.file} aria-hidden="true">
                  PDF
                </span>
              )}
              <span className={styles.name}>{attachment.name}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
