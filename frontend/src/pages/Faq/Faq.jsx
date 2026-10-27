// src/pages/Faq/Faq.jsx
//
// The FAQ page: a heading band, then one fold-open box per topic (shipping
// goods, shipping a car, ...). The first topic starts open so the page never
// looks empty; the others open with a click.
//
// The topics and questions are listed in faqContent.js and their words live
// in translations.js (faq.*). Read the note at the top of faqContent.js
// before adding a question.
//
// The folding uses the browser's own <details>/<summary>: it works without
// JavaScript, with the keyboard, and with a screen reader, for free.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /faq
//   Who can open: everybody
//   Links to:     / (Home), /contact
//   Linked from:  the Footer
//   Backend:      -

import { Link } from 'react-router-dom';
import { WAREHOUSE_ADDRESS } from '../../data/company';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { usePageMeta } from '../../hooks/usePageMeta';
import { FAQ_CATEGORIES } from './faqContent';
import styles from './Faq.module.css';

// What {address} in an answer stands for.
const VALUES = {
  address: `${WAREHOUSE_ADDRESS.street}, ${WAREHOUSE_ADDRESS.postcode} ${WAREHOUSE_ADDRESS.town}`,
};

function Category({ category, open }) {
  const { t } = useLanguage();
  const base = `faq.categories.${category.id}`;

  return (
    <details className={styles.category} open={open}>
      <summary className={styles.summary}>
        <span>{t(`${base}.title`)}</span>
        {/* The round marker on the right, like the old site. It turns into
            a minus when the topic is open (see the CSS). */}
        <span className={styles.marker} aria-hidden="true" />
      </summary>

      <dl className={styles.questions}>
        {category.questions.map((question) => {
          const key = `${base}.questions.${question.id}`;
          return (
            <div key={question.id} className={styles.question}>
              <dt className={styles.q}>{t(`${key}.q`)}</dt>
              <dd className={styles.a}>
                {fill(t(`${key}.a`), VALUES)}
                {question.link && (
                  <>
                    {' '}
                    <Link to={question.link} className={styles.link}>
                      {t(`${key}.link`)} &rarr;
                    </Link>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

export default function Faq() {
  const { t } = useLanguage();

  usePageMeta(t('faq.title'), t('faq.summary'), '/faq');

  const important = t('faq.important.items');

  return (
    <main className={styles.page}>
      <header className={styles.banner}>
        <div className={styles.bannerInner}>
          <h1 className={styles.title}>{t('faq.title')}</h1>
          <hr className={styles.rule} />
          <p className={styles.breadcrumb}>
            <Link to="/" className={styles.crumbLink}>
              {t('nav.home')}
            </Link>{' '}
            &raquo; {t('faq.title')}
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <p className={styles.intro}>{t('faq.intro')}</p>

        <div className={styles.list} data-tour="faq-topics">
          {FAQ_CATEGORIES.map((category, index) => (
            <Category key={category.id} category={category} open={index === 0} />
          ))}
        </div>

        {/* The documents customs asks for: important enough to show to
            everybody, not hidden inside a topic. */}
        <aside
          className={styles.important}
          aria-labelledby="faq-important"
          data-tour="faq-important"
        >
          <h2 id="faq-important" className={styles.importantTitle}>
            {t('faq.important.title')}
          </h2>
          <p>{t('faq.important.lead')}</p>
          <ul>
            {(Array.isArray(important) ? important : []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.importantAfter}>{t('faq.important.after')}</p>
        </aside>

        <p className={styles.more} data-tour="faq-more">
          {t('faq.more')}{' '}
          <Link to="/contact" className={styles.link}>
            {t('faq.contactUs')}
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
