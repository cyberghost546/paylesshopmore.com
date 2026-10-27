// src/pages/Blog/BlogPost.jsx
//
// One article: /blog/<slug>. Shown in the visitor's language when it has
// been written in it, otherwise in Dutch - with a short note saying so, so a
// visitor reading English is not left wondering why the text is Dutch.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /blog/:slug
//   Who can open: everybody
//   Links to:     /blog, /contact, /destinations
//   Linked from:  Blog, the office dashboard's Blog page
//   Backend:      api/blog.js

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { coverUrl, getPost } from '../../api/blog';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { usePageMeta } from '../../hooks/usePageMeta';
import { useLanguage } from '../../i18n/useLanguage';
import BlogBody from './BlogBody';
import styles from './Blog.module.css';

export default function BlogPost() {
  const { slug } = useParams();
  const { t, language } = useLanguage();
  const [post, setPost] = useState(null);
  // 'loading' | 'ready' | 'missing' | 'error'
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  usePageMeta(post?.title ?? t('blog.title'), post?.summary ?? t('blog.lead'), `/blog/${slug}`);

  useEffect(() => {
    let cancelled = false;
    getPost(slug, language)
      .then((data) => {
        if (cancelled) return;
        setPost(data);
        setState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setState(error?.status === 404 ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, language, attempt]);

  const dateFormat = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const back = (
    <Link to="/blog" className={styles.back} data-tour="blog-back">
      ← {t('blog.back')}
    </Link>
  );

  if (state === 'loading') {
    return (
      <main className={styles.page}>
        <Loading />
      </main>
    );
  }

  if (state === 'missing' || state === 'error') {
    return (
      <main className={`${styles.page} ${styles.article}`}>
        {state === 'missing' ? (
          <>
            <h1 className={styles.articleTitle}>{t('blog.notFound')}</h1>
            <p className={styles.lead}>{t('blog.notFoundText')}</p>
          </>
        ) : (
          <ConnectionError
            inline
            onRetry={() => {
              setState('loading');
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {back}
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <article className={styles.article} data-tour="blog-article">
        {back}

        {post.published_at && (
          <time className={styles.cardDate} dateTime={post.published_at}>
            {dateFormat.format(new Date(post.published_at))}
          </time>
        )}
        <h1 className={styles.articleTitle}>{post.title}</h1>
        <p className={styles.articleSummary}>{post.summary}</p>

        {/* Not in the visitor's language: say which one it is in. */}
        {post.language !== language && (
          <p className={styles.otherLanguage}>
            {t('blog.otherLanguage')} {t(`blog.languages.${post.language}`)}.
          </p>
        )}

        {post.cover && (
          <img className={styles.articleCover} src={coverUrl(post.cover)} alt="" />
        )}

        <BlogBody text={post.body} />

        {/* The natural next step after reading. */}
        <aside className={styles.cta} data-tour="blog-cta">
          <p className={styles.ctaTitle}>{t('blog.ctaTitle')}</p>
          <div className={styles.ctaButtons}>
            <Link to="/destinations" className={styles.ctaPrimary}>
              {t('blog.ctaQuote')}
            </Link>
            <Link to="/contact" className={styles.ctaSecondary}>
              {t('blog.ctaContact')}
            </Link>
          </div>
        </aside>
      </article>
    </main>
  );
}
