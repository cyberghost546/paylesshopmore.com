// src/pages/Blog/slugify.js
//
// A post's web address from its title, for the dashboard's editor:
// lowercase, accents dropped, anything else becomes a dash.

/** "Sea or air freight?" becomes "sea-or-air-freight". */
export function slugify(text) {
  return (
    String(text)
      .normalize('NFKD')
      // The accents NFKD split off ("é" -> "e" + accent), removed.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
  );
}
