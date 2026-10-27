// src/pages/Blog/parseBody.js
//
// An article's plain text as a list of blocks, for BlogBody.jsx to draw (and
// the dashboard's live preview). The rules: an empty line starts a paragraph,
// "## " starts a heading, "- " starts a bullet point.

/**
 * The text as a list of blocks: { type: 'heading' | 'list' | 'paragraph' }.
 */
export function parseBody(text) {
  const blocks = [];
  // Paragraphs are separated by one or more empty lines.
  for (const chunk of String(text ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    };
    const flushList = () => {
      if (list) blocks.push({ type: 'list', items: list });
      list = null;
    };

    for (const line of lines) {
      if (line.startsWith('## ')) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'heading', text: line.slice(3).trim() });
      } else if (line.startsWith('- ')) {
        flushParagraph();
        list = list ?? [];
        list.push(line.slice(2).trim());
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}
