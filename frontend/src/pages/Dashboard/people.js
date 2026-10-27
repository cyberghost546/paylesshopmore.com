// src/pages/Dashboard/people.js
//
// The two plain helpers the people pages share. Apart from PeopleFields.jsx
// because that file exports only components, which is what lets the dev
// server hot-reload it without a full page refresh.

const ROLE_FIXED_ENGLISH = {
  roleFixedSelf: 'Your own account',
  roleFixedSuperuser: 'Superuser — managed in the Django admin',
  roleFixedErased: 'Erased account',
  roleFixedNotAdmin: 'Only an admin can change roles',
};

/**
 * Why the role select is fixed on this row, in the words that fit the case.
 * `c` translates (usePageText('common')); without it the answer is English.
 */
export function whyRoleIsFixed(customer, isSelf, c = (key) => ROLE_FIXED_ENGLISH[key]) {
  if (isSelf) return c('roleFixedSelf');
  if (customer.is_superuser) return c('roleFixedSuperuser');
  if (customer.is_erased) return c('roleFixedErased');
  // The server only lets admins hand out roles.
  if (!customer.can_change_role) return c('roleFixedNotAdmin');
  return '';
}

/** "Voorbeeld Klant" becomes "VK". */
export function initialsOf(name) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}
