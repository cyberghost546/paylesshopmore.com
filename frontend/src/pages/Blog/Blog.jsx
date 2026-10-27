// src/pages/Blog/Blog.jsx
//
// The blog's index: one card per published article, newest first, in the
// visitor's language (or Dutch when an article has not been translated).
// The office writes the articles in the staff dashboard (Dashboard > Blog);
// nothing here needs a code change to add one.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /blog
//   Who can open: everybody
//   Links to:     / (Home), /blog/:slug (each post)
//   Linked from:  the Footer, Blog post, the office dashboard's Blog page
//   Backend:      api/blog.js

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { coverUrl, listPosts } from '../../api/blog';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import { BookIcon } from '../../components/Icons/icons';
import Loading from '../../components/Loading/Loading';
import { usePageMeta } from '../../hooks/usePageMeta';
import { useLanguage } from '../../i18n/useLanguage';
import styles from './Blog.module.css';

export default function Blog() {
  const { t, language } = useLanguage();
  const [posts, setPosts] = useState([]);
  // 'loading' | 'ready' | 'error'
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  usePageMeta(t('blog.title'), t('blog.lead'), '/blog');

  // Loaded again when the language changes, so the cards follow it.
  useEffect(() => {
    let cancelled = false;
    listPosts(language)
      .then((rows) => {
        if (cancelled) return;
        setPosts(rows);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [language, attempt]);

  const dateFormat = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <main className={styles.page}>
      <header className={styles.banner} data-tour="blog-intro">
        <div className={styles.bannerInner}>
          <h1 className={styles.title}>{t('blog.title')}</h1>
          <hr className={styles.rule} />
          <p className={styles.breadcrumb}>
            <Link to="/" className={styles.crumbLink}>
              {t('nav.home')}
            </Link>{' '}
            &raquo; {t('blog.title')}
          </p>
        </div>
      </header>

      <section className={styles.index} data-tour="blog-posts">
        <p className={styles.lead}>{t('blog.lead')}</p>

        {state === 'loading' && <Loading inline />}
        {state === 'error' && (
          <ConnectionError
            inline
            onRetry={() => {
              setState('loading');
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {state === 'ready' && posts.length === 0 && (
          <p className={styles.empty}>{t('blog.empty')}</p>
        )}

        {state === 'ready' && posts.length > 0 && (
          <ul className={styles.grid}>
            {posts.map((post) => (
              <li key={post.slug}>
                {/* The whole card is the link. */}
                <Link to={`/blog/${post.slug}`} className={styles.card}>
                  <span className={styles.cardCover}>
                    {post.cover ? (
                      <img src={coverUrl(post.cover)} alt="" loading="lazy" />
                    ) : (
                      // No picture: a calm placeholder in the site's colours.
                      <span className={styles.cardCoverEmpty}>
                        <BookIcon size={40} />
                      </span>
                    )}
                  </span>
                  <span className={styles.cardBody}>
                    {post.published_at && (
                      <time className={styles.cardDate} dateTime={post.published_at}>
                        {dateFormat.format(new Date(post.published_at))}
                      </time>
                    )}
                    <span className={styles.cardTitle}>{post.title}</span>
                    <span className={styles.cardSummary}>{post.summary}</span>
                    <span className={styles.cardMore}>{t('blog.readMore')} →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
