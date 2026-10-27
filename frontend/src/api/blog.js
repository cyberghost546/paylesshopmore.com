// src/api/blog.js
//
// The blog: published articles for the public site, and the office's own
// view for writing them (backend: the `blog` app).
//
// The public half is open to anyone. The staff half lives under /api/staff/
// and is refused with a 403 unless the session is a staff account.

import { apiUrl, request } from './client';

/**
 * The published articles, one card each, in `lang` where the article has
 * been written in it and in Dutch otherwise. Newest first.
 *
 * @param {string} lang 'nl' | 'en' | 'pap'
 */
export async function listPosts(lang) {
  const data = await request(`/blog/?lang=${encodeURIComponent(lang)}`);
  return Array.isArray(data) ? data : (data?.results ?? []);
}

/**
 * One published article, in `lang` or Dutch. Rejects with a 404 ApiError for
 * an address that has no article.
 */
export async function getPost(slug, lang) {
  return request(
    `/blog/${encodeURIComponent(slug)}/?lang=${encodeURIComponent(lang)}`,
  );
}

/** The full address of a cover picture, for an <img>. */
export function coverUrl(path) {
  return path ? apiUrl(path) : null;
}

/* -------------------------------------------------------------- the office */

/** Every post, drafts included, newest first. */
export async function listAllPosts() {
  const data = await request('/staff/blog/');
  return Array.isArray(data) ? data : (data?.results ?? []);
}

/**
 * How a post travels: as a form when it carries a new cover picture (a File
 * cannot be JSON), as JSON otherwise - so editing the text does not upload
 * the picture again, and clearing it (null) stays null. The same approach as
 * the shops' logos (api/shops.js).
 */
function asRequest(method, changes) {
  if (!(changes.cover instanceof File)) return { method, body: changes };

  const form = new FormData();
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null) continue;
    form.append(key, value instanceof File ? value : String(value));
  }
  return { method, formData: form };
}

export async function createPost(post) {
  return request('/staff/blog/', asRequest('POST', post));
}

export async function updatePost(id, changes) {
  return request(`/staff/blog/${id}/`, asRequest('PATCH', changes));
}

export async function deletePost(id) {
  return request(`/staff/blog/${id}/`, { method: 'DELETE' });
}
