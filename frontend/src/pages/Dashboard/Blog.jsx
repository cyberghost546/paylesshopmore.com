// src/pages/Dashboard/Blog.jsx
//
// The blog's posts, as the office writes them. What appears at /blog is
// what is published here - no code change or deploy needed.
//
//   New post   opens the editor at the top of the page
//   Edit       opens the same editor with the post's current text
//   Published  unticked = a draft, invisible on the website. Ticking it the
//              first time sets the post's date; the date stays if it is
//              unpublished and published again later
//   Language   one post per language. The same article in another language
//              is a second post with the SAME address (slug): the website
//              then shows each visitor their own language, or Dutch
//   The text   plain text with three rules, shown under the box and in the
//              live preview: empty line = new paragraph, "## " = heading,
//              "- " = bullet point
//
// Every write is refused by the server unless the session is staff.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/blog
//   Who can open: office staff
//   Links to:     /blog, /blog/:slug (the post on the website)
//   Linked from:  the dashboard sidebar
//   Backend:      api/blog.js

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  coverUrl,
  createPost,
  deletePost,
  listAllPosts,
  updatePost,
} from '../../api/blog';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import FileDrop from '../../components/FileDrop/FileDrop';
import Loading from '../../components/Loading/Loading';
import BlogBody from '../Blog/BlogBody';
import { slugify } from '../Blog/slugify';
import { Banner, Empty, StatusBadge } from './ui';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

const COVER_TYPES = 'image/png,image/jpeg,image/webp';

const LANGUAGES = [
  { value: 'nl', label: 'Nederlands' },
  { value: 'en', label: 'English' },
  { value: 'pap', label: 'Papiamentu' },
];

const BLANK = {
  title: '',
  slug: '',
  language: 'nl',
  summary: '',
  body: '',
  is_published: false,
  cover: undefined,
};

/** The first message the server gave for a refused save, as one line. */
function firstError(error, fallback) {
  const detail = error?.fields ?? error?.data ?? error?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    for (const value of Object.values(detail)) {
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return fallback;
}

/**
 * The editor for a new post (post = null) or an existing one.
 *
 * @param {{ post: object|null, onSaved: () => void, onCancel: () => void }} props
 */
function PostEditor({ post, onSaved, onCancel }) {
  const d = usePageText('blog');
  const [draft, setDraft] = useState(() =>
    post
      ? {
          title: post.title,
          slug: post.slug,
          language: post.language,
          summary: post.summary,
          body: post.body,
          is_published: post.is_published,
          cover: undefined,
        }
      : BLANK,
  );
  // The address follows the title until somebody types one themselves.
  const [slugTouched, setSlugTouched] = useState(Boolean(post));
  const [removeCover, setRemoveCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (event) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  function setTitle(event) {
    const title = event.target.value;
    setDraft((current) => ({
      ...current,
      title,
      slug: slugTouched ? current.slug : slugify(title),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const changes = {
      title: draft.title.trim(),
      slug: slugify(draft.slug),
      language: draft.language,
      summary: draft.summary.trim(),
      body: draft.body,
      is_published: draft.is_published,
    };
    // A new picture is sent as a file; "remove" as null; otherwise the
    // current one is left alone.
    if (draft.cover instanceof File) changes.cover = draft.cover;
    else if (removeCover) changes.cover = null;

    try {
      if (post) await updatePost(post.id, changes);
      else await createPost(changes);
      onSaved(changes);
    } catch (failure) {
      setError(firstError(failure, d('saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  const currentCover = post?.cover_url && !removeCover ? coverUrl(post.cover_url) : null;

  return (
    <form className={styles.officeBox} onSubmit={submit}>
      <p className={styles.officeHead}>{post ? d('edit', { title: post.title }) : d('newPost')}</p>

      <div className={styles.officeGrid}>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('title')}</span>
          <input
            className={styles.officeInput}
            value={draft.title}
            onChange={setTitle}
            required
            maxLength={160}
          />
        </label>

        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('address')}</span>
          <input
            className={styles.officeInput}
            value={draft.slug}
            onChange={(event) => {
              setSlugTouched(true);
              set('slug')(event);
            }}
            required
            maxLength={120}
            placeholder="sea-or-air-freight"
          />
        </label>

        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('language')}</span>
          <select
            className={styles.officeInput}
            value={draft.language}
            onChange={set('language')}
          >
            {LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>

        <label className={`${styles.officeField} ${styles.officeCheck}`}>
          <input
            type="checkbox"
            checked={draft.is_published}
            onChange={(event) =>
              setDraft((current) => ({ ...current, is_published: event.target.checked }))
            }
          />
          <span>{d('published')}</span>
        </label>
      </div>

      <label className={styles.officeField}>
        <span className={styles.officeLabel}>{d('summary')}</span>
        <textarea
          className={styles.officeInput}
          rows={2}
          value={draft.summary}
          onChange={set('summary')}
          required
          maxLength={300}
        />
      </label>

      <label className={styles.officeField}>
        <span className={styles.officeLabel}>{d('text')}</span>
        <textarea
          className={styles.officeInput}
          rows={14}
          value={draft.body}
          onChange={set('body')}
          required
        />
      </label>
      <p className={styles.officeNote}>
        {d('formatHelpBefore')} <code>## </code> {d('formatHelpMiddle')} <code>- </code>{' '}
        {d('formatHelpAfter')}
      </p>

      {/* What the text will look like on the website. */}
      {draft.body.trim() && (
        <div className={styles.blogPreview}>
          <p className={styles.officeLabel}>{d('preview')}</p>
          <BlogBody text={draft.body} />
        </div>
      )}

      <div className={styles.officeField}>
        <FileDrop
          label={d('cover')}
          optionalLabel={d('optional')}
          hint={d('coverHint')}
          accept={COVER_TYPES}
          chooseLabel={d('choosePicture')}
          dropLabel={d('dropPicture')}
          disabled={busy}
          onFile={(file) => {
            setRemoveCover(false);
            setDraft((current) => ({ ...current, cover: file }));
          }}
        />
        {draft.cover instanceof File && (
          <p className={styles.officeNote}>
            {d('newPicture', { name: draft.cover.name })}{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setDraft((current) => ({ ...current, cover: undefined }))}
            >
              {d('undo')}
            </button>
          </p>
        )}
        {currentCover && !(draft.cover instanceof File) && (
          <p className={styles.officeNote}>
            <img src={currentCover} alt="" className={styles.blogCoverThumb} />{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setRemoveCover(true)}
            >
              {d('removePicture')}
            </button>
          </p>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className={styles.blogActions}>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? d('saving') : post ? d('saveChanges') : d('savePost')}
        </button>
        <button type="button" className={styles.linkButton} onClick={onCancel}>
          {d('cancel')}
        </button>
      </div>
    </form>
  );
}

export default function Blog() {
  const d = usePageText('blog');
  const [posts, setPosts] = useState([]);
  // 'loading' | 'ready' | 'error'
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  // null = no editor; 'new' = a new post; a post object = editing that one.
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    listAllPosts()
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
  }, [attempt]);

  function saved(changes) {
    setEditing(null);
    setNotice(
      changes.is_published
        ? d('savedLive', { title: changes.title })
        : d('savedDraft', { title: changes.title }),
    );
    reload();
  }

  async function remove(post) {
    // Deleting cannot be undone, so it asks first.
    if (!window.confirm(d('deleteConfirm', { title: post.title }))) return;
    setError('');
    try {
      await deletePost(post.id);
      setNotice(d('deleted', { title: post.title }));
      reload();
    } catch {
      setError(d('deleteFailed'));
    }
  }

  const dateFormat = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div>
      {/* data-tour hooks: this page's tour ("dashboardBlog" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-blog-intro">
        <h1 className={styles.title}>{d('pageTitle')}</h1>
        <p className={styles.subtitle}>
          {d('subtitleBefore')} <Link to="/blog">/blog</Link> {d('subtitleAfter')}
        </p>
      </header>

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {editing ? (
        <PostEditor
          // A fresh editor per post, so switching posts never mixes texts.
          key={editing === 'new' ? 'new' : editing.id}
          post={editing === 'new' ? null : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          className={styles.primaryButton}
          data-tour="db-blog-new"
          onClick={() => {
            setNotice('');
            setEditing('new');
          }}
        >
          {d('newPost')}
        </button>
      )}

      {state === 'loading' && <Loading inline />}
      {state === 'error' && <ConnectionError inline onRetry={reload} />}
      {state === 'ready' && posts.length === 0 && (
        <Empty>{d('noPosts')}</Empty>
      )}

      {state === 'ready' && posts.length > 0 && (
        <div className={`${styles.tableWrap} ${styles.blogTable}`} data-tour="db-blog-table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{d('title')}</th>
                <th>{d('language')}</th>
                <th>{d('colStatus')}</th>
                <th>{d('colDate')}</th>
                <th>{d('colAuthor')}</th>
                <th aria-label={d('colActions')} />
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <strong>{post.title}</strong>
                    <div className={styles.mutedCell}>/blog/{post.slug}</div>
                  </td>
                  <td>{post.language.toUpperCase()}</td>
                  <td>
                    <StatusBadge tone={post.is_published ? 'done' : 'neutral'}>
                      {post.is_published ? d('isPublished') : d('draft')}
                    </StatusBadge>
                  </td>
                  <td>
                    {post.published_at
                      ? dateFormat.format(new Date(post.published_at))
                      : '—'}
                  </td>
                  <td>{post.author_name ?? '—'}</td>
                  <td className={styles.blogRowActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => {
                        setNotice('');
                        setEditing(post);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      {d('editButton')}
                    </button>
                    {post.is_published && (
                      <Link to={`/blog/${post.slug}`} className={styles.linkButton}>
                        {d('view')}
                      </Link>
                    )}
                    <button
                      type="button"
                      className={`${styles.linkButton} ${styles.blogDelete}`}
                      onClick={() => remove(post)}
                    >
                      {d('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
