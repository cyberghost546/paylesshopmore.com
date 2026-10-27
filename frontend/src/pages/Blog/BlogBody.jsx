// src/pages/Blog/BlogBody.jsx
//
// Turns an article's plain text into paragraphs, headings and lists. Staff
// write the text in the dashboard with three simple rules (see the backend's
// blog/models.py):
//
//   - an empty line starts a new paragraph
//   - a line starting with "## " is a heading
//   - lines starting with "- " are a bullet list
//
// Everything is rendered as text, never as HTML, so nothing typed into a post
// can add markup or script to the page.

import { parseBody } from './parseBody';
import styles from './Blog.module.css';

/** @param {{ text: string }} props */
export default function BlogBody({ text }) {
  return (
    <div className={styles.body}>
      {parseBody(text).map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h2 key={index} className={styles.bodyHeading}>
              {block.text}
            </h2>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className={styles.bodyList}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className={styles.bodyParagraph}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
