// src/pages/Terms/Terms.jsx
//
// The Terms & Conditions: the Forwarding Conditions and the Warehousing
// Conditions, one after the other, with a table of contents at the top.
//
// The conditions themselves are in English for every visitor and live in
// src/data/terms.js (read the note at the top of that file before changing
// them). Only the page around them - title, the language note, "Contents" -
// is translated, in translations.js (terms.*).
//
// The company's address and contact details at the bottom come from
// src/data/company.js, the one place they are kept.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /terms
//   Who can open: everybody
//   Links to:     / (Home), /contact
//   Linked from:  the Footer, Sign up, Booking
//   Backend:      -

import { Link } from 'react-router-dom';
import { CONTACT, COMPANY, WAREHOUSE_ADDRESS } from '../../data/company';
import { FORWARDING, WAREHOUSING } from '../../data/terms';
import { useLanguage } from '../../i18n/useLanguage';
import { usePageMeta } from '../../hooks/usePageMeta';
import styles from './Terms.module.css';

/** A bullet (or a., b., c.) list. An item can have a sub-list of its own. */
function List({ items, lettered }) {
  const Tag = lettered ? 'ol' : 'ul';

  return (
    <Tag className={lettered ? styles.lettered : styles.list}>
      {items.map((item) =>
        typeof item === 'string' ? (
          <li key={item}>{item}</li>
        ) : (
          <li key={item.text}>
            {item.text}
            <List items={item.items} />
          </li>
        ),
      )}
    </Tag>
  );
}

/** One paragraph: plain text, or text followed by a list. */
function Paragraph({ paragraph }) {
  if (typeof paragraph === 'string') return <p className={styles.paragraph}>{paragraph}</p>;

  return (
    <>
      {paragraph.text && <p className={styles.paragraph}>{paragraph.text}</p>}
      <List items={paragraph.items} lettered={paragraph.lettered} />
    </>
  );
}

/**
 * An Article (Forwarding) or Section (Warehousing).
 *
 * When there is more than one paragraph they are numbered 1, 2, 3... because
 * the text refers to them ("paragraph 3 of this article"). The Warehousing
 * Conditions already carry their numbers ("7.1") in the text, so they set
 * `numbered: false`.
 */
function Article({ docId, label, article }) {
  const { t } = useLanguage();
  const numbered = article.numbered !== false && article.paragraphs.length > 1;

  return (
    <section id={`${docId}-${article.number}`} className={styles.article}>
      <h3 className={styles.articleTitle}>
        <span className={styles.number}>
          {article.kind === 'article' ? t('terms.article') : label} {article.number}
        </span>{' '}
        {article.title}
      </h3>
      {numbered ? (
        <ol className={styles.numbered}>
          {article.paragraphs.map((paragraph, index) => (
            <li key={index}>
              <Paragraph paragraph={paragraph} />
            </li>
          ))}
        </ol>
      ) : (
        article.paragraphs.map((paragraph, index) => (
          <Paragraph key={index} paragraph={paragraph} />
        ))
      )}
    </section>
  );
}

/** The table of contents for one set of conditions. */
function Contents({ doc, groups, label }) {
  const { t } = useLanguage();

  return (
    <li>
      <a href={`#${doc.id}`} className={styles.tocDoc}>
        {doc.title}
      </a>
      <ol className={styles.tocList}>
        {groups.flatMap((group) =>
          group.items.map((item) => (
            <li key={item.number}>
              <a href={`#${doc.id}-${item.number}`} className={styles.tocLink}>
                {item.kind === 'article' ? t('terms.article') : label} {item.number}.{' '}
                {item.title}
              </a>
            </li>
          )),
        )}
      </ol>
    </li>
  );
}

export default function Terms() {
  const { t, language } = useLanguage();

  usePageMeta(t('terms.title'), t('terms.summary'), '/terms');

  // Both documents in the same shape: a list of groups, each with a heading
  // and the Articles/Sections in it.
  const forwardingGroups = FORWARDING.groups.map((group) => ({
    heading: group.heading,
    items: group.articles,
  }));
  const warehousingGroups = WAREHOUSING.parts.map((part) => ({
    heading: part.heading,
    items: part.sections,
  }));

  const documents = [
    { doc: FORWARDING, groups: forwardingGroups, label: t('terms.article') },
    { doc: WAREHOUSING, groups: warehousingGroups, label: t('terms.section') },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.banner} id="top">
        <div className={styles.bannerInner}>
          <h1 className={styles.title}>{t('terms.title')}</h1>
          <hr className={styles.rule} />
          <p className={styles.breadcrumb}>
            <Link to="/" className={styles.crumbLink}>
              {t('nav.home')}
            </Link>{' '}
            &raquo; {t('terms.title')}
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <p className={styles.note} role="note" data-tour="terms-note">
          {t('terms.languageNote')}
        </p>

        <nav className={styles.toc} aria-labelledby="terms-contents" data-tour="terms-contents">
          <h2 id="terms-contents" className={styles.tocTitle}>
            {t('terms.contents')}
          </h2>
          <ol className={styles.tocDocs}>
            {documents.map(({ doc, groups, label }) => (
              <Contents key={doc.id} doc={doc} groups={groups} label={label} />
            ))}
          </ol>
        </nav>

        {documents.map(({ doc, groups, label }) => (
          // lang="en": the conditions are English whatever language the rest
          // of the page is in, so screen readers pronounce them correctly.
          <article
            key={doc.id}
            id={doc.id}
            className={styles.document}
            lang="en"
            // The tour points at the first set of conditions.
            data-tour={doc.id === FORWARDING.id ? 'terms-conditions' : undefined}
          >
            <h2 className={styles.docTitle}>{doc.title}</h2>

            {groups.map((group) => (
              <div key={group.heading} className={styles.group}>
                {/* A group with one Article of the same name needs no
                    heading of its own: it would just say the same twice. */}
                {!(group.items.length === 1 && group.items[0].title === group.heading) && (
                  <p className={styles.groupHeading}>{group.heading}</p>
                )}
                {group.items.map((article) => (
                  <Article key={article.number} docId={doc.id} label={label} article={article} />
                ))}
              </div>
            ))}

            {doc.complete === false && (
              // Translated, unlike the conditions around it.
              <p className={styles.incomplete} lang={language}>
                {t('terms.incomplete')}
              </p>
            )}

            <address className={styles.company}>
              <strong>{COMPANY.name}</strong>
              <br />
              {WAREHOUSE_ADDRESS.street}, {WAREHOUSE_ADDRESS.postcode} {WAREHOUSE_ADDRESS.town}, The
              Netherlands
              <br />
              <a href={CONTACT.phoneHref} className={styles.link}>
                {CONTACT.phone}
              </a>{' '}
              /{' '}
              <a href={`mailto:${CONTACT.email}`} className={styles.link}>
                {CONTACT.email}
              </a>{' '}
              / www.paylesshopmore.com
            </address>

            <p className={styles.top}>
              <a href="#top" className={styles.link}>
                {t('terms.backToTop')}
              </a>
            </p>
          </article>
        ))}

        <p className={styles.contact} data-tour="terms-contact">
          {t('terms.questions')}{' '}
          <Link to="/contact" className={styles.link}>
            {t('nav.contact')}
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
