// src/pages/Dashboard/Customers.jsx
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/customers
//   Who can open: office staff
//   Links to:     /dashboard/workers
//   Linked from:  the dashboard sidebar, Overview, Bookings, Invoices, Workers
//   Backend:      api/staff.js

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import {
  ADDRESS_COUNTRIES,
  CUSTOMER_ROLES,
  createCustomer,
  deleteCustomer,
  listCustomers,
  saveCustomerAddress,
  setCustomerRole,
  updateCustomer,
} from '../../api/staff';
import { useAuth } from '../../auth/useAuth';
import { useCollection } from './useCollection';
import { AddressLines, ContactFields, Field } from './PeopleFields';
import { initialsOf, whyRoleIsFixed } from './people';
import { formatDate, formatMoney } from './format';
import {
  Banner,
  Empty,
  FilterSelect,
  Pagination,
  SearchInput,
  StatusBadge,
  StatusSelect,
  Toolbar,
} from './ui';
import styles from './Dashboard.module.css';
import { translatedOptions, usePageText } from './usePageText';

const ERASED_OPTIONS = [
  { value: 'false', key: 'activeAccounts' },
  { value: 'true', key: 'erasedAccounts' },
];

/** An empty new-account form. Written out so a reset is one assignment. */
const BLANK_CUSTOMER = {
  first_name: '',
  last_name: '',
  email: '',
  phone_number: '',
  role: 'customer',
};

/**
 * Opening an account for somebody who is not here to open it themselves.
 *
 * There is no password field, and its absence is the feature rather than an
 * omission: the account is created unusable and its owner is e-mailed a link
 * to choose their own. Nobody in the office ever knows it, so nobody has to be
 * trusted with it and nothing has to be read out over a phone.
 */
function NewCustomerFields({ onCreate, busy, errors }) {
  const d = usePageText('customers');
  const c = usePageText('common');
  const [draft, setDraft] = useState(BLANK_CUSTOMER);

  function set(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <form
      className={styles.officeBox}
      onSubmit={(event) => {
        event.preventDefault();
        // Cleared only on success, which is the caller's business: a failed
        // save must not throw away what somebody just typed.
        onCreate(draft, () => setDraft(BLANK_CUSTOMER));
      }}
    >
      <p className={styles.officeHead}>{d('newAccount')}</p>

      <div className={styles.officeGrid}>
        <Field
          label={c('firstName')}
          name="first_name"
          value={draft.first_name}
          onChange={(value) => set('first_name', value)}
          errors={errors}
        />
        <Field
          label={d('lastName')}
          name="last_name"
          value={draft.last_name}
          onChange={(value) => set('last_name', value)}
          errors={errors}
        />
        <Field
          label={c('email')}
          name="email"
          type="email"
          value={draft.email}
          onChange={(value) => set('email', value)}
          errors={errors}
        />
        <Field
          label={c('phone')}
          name="phone_number"
          type="tel"
          value={draft.phone_number}
          onChange={(value) => set('phone_number', value)}
          errors={errors}
        />
        <Field
          label={d('role')}
          name="role"
          value={draft.role}
          onChange={(value) => set('role', value)}
          options={translatedOptions(CUSTOMER_ROLES, c, 'role')}
          errors={errors}
        />
      </div>

      <p className={styles.officeNote}>{d('newNote')}</p>

      <button type="submit" className={styles.rowButton} disabled={busy}>
        {busy ? d('creating') : d('create')}
      </button>
    </form>
  );
}

/**
 * The customer's default delivery address — the one their next order is
 * pre-filled from, and the one their profile page edits.
 *
 * Only the default: a customer may keep several addresses, and choosing
 * between them is theirs to do. What the office needs is to fix the one an
 * agent is delivering against. If they have none, this adds it.
 */
function AddressFields({ customer, onSave, busy, errors }) {
  const d = usePageText('customers');
  const c = usePageText('common');
  const existing =
    customer.addresses.find((address) => address.is_default) ??
    customer.addresses[0] ??
    null;

  const [draft, setDraft] = useState({
    label: existing?.label ?? '',
    street: existing?.street ?? '',
    house_number: existing?.house_number ?? '',
    postal_code: existing?.postal_code ?? '',
    city: existing?.city ?? '',
    country: existing?.country ?? ADDRESS_COUNTRIES[0].value,
  });

  const dirty = Object.entries(draft).some(
    ([field, value]) => String(existing?.[field] ?? '') !== String(value),
  );
  // A new address has to arrive complete; the server would refuse a blank
  // street or city anyway, this just says so before the round trip.
  const complete = draft.street.trim() && draft.city.trim();

  const set = (field) => (value) =>
    setDraft((current) => ({ ...current, [field]: value }));

  return (
    <div className={styles.officeBox}>
      <p className={styles.officeHead}>
        {existing ? d('defaultAddress') : d('noAddress')}
      </p>

      <div className={styles.officeGrid}>
        <Field
          label={d('label')}
          name="label"
          value={draft.label}
          onChange={set('label')}
          errors={errors}
        />
        <Field
          label={d('street')}
          name="street"
          value={draft.street}
          onChange={set('street')}
          errors={errors}
        />
        <Field
          label={d('houseNumber')}
          name="house_number"
          value={draft.house_number}
          onChange={set('house_number')}
          errors={errors}
        />
        <Field
          label={d('postalCode')}
          name="postal_code"
          value={draft.postal_code}
          onChange={set('postal_code')}
          errors={errors}
        />
        <Field
          label={d('city')}
          name="city"
          value={draft.city}
          onChange={set('city')}
          errors={errors}
        />
        <Field
          label={d('country')}
          name="country"
          value={draft.country}
          onChange={set('country')}
          options={ADDRESS_COUNTRIES}
          errors={errors}
        />
      </div>

      <button
        type="button"
        className={styles.rowButton}
        disabled={!dirty || !complete || busy}
        onClick={() =>
          onSave({
            // The id is what tells the server to correct this address rather
            // than add another one beside it.
            id: existing?.id ?? null,
            ...draft,
            is_default: true,
          })
        }
      >
        {busy ? c('saving') : existing ? d('saveAddress') : d('addAddress')}
      </button>
    </div>
  );
}

/**
 * A pop-up window over the page: a dark see-through layer with a white card in
 * the middle. Closes with the X button, the Escape key, or a click on the dark
 * layer around the card.
 */
function Modal({ titleId, onClose, children }) {
  const c = usePageText('common');
  const closeButton = useRef(null);

  useEffect(() => {
    // Put the keyboard on the X, so Enter/Escape work straight away.
    closeButton.current?.focus();
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Stop the table behind the pop-up from scrolling while it is open, and
    // put scrolling back the way it was when it closes.
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = before;
    };
    // onClose must stay the same function between renders (useCallback in the
    // page), or this would run again on every keystroke and pull the focus
    // out of the field being typed in, back to the X.
  }, [onClose]);

  return (
    // onMouseDown, not onClick: so selecting text inside the card and letting
    // go of the mouse outside it does not close the window by accident.
    <div
      className={styles.modalOverlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={styles.modalPanel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button
          ref={closeButton}
          type="button"
          className={styles.modalClose}
          aria-label={c('close')}
          onClick={onClose}
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export default function Customers() {
  const [params] = useSearchParams();
  // `user` for two things: wording the greyed-out role, and noticing when the
  // row being edited is the account this staff member is signed in as — the
  // header renders from the same copy and would otherwise go stale.
  const { user, refreshUser } = useAuth();
  const d = usePageText('customers');
  const c = usePageText('common');
  const roles = translatedOptions(CUSTOMER_ROLES, c, 'role');

  // Customers only, unless the Role filter is widened. The people who work
  // here have their own page — see Workers — so that this table is the
  // customer base rather than the customer base with the office mixed into
  // it. Both pages read the same rows from the same endpoint; only the
  // question they ask it differs.
  const list = useCollection(
    listCustomers,
    { erased: params.get('erased') ?? '', role: params.get('role') ?? 'customer' },
    params.get('search') ?? '',
  );

  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  // Which customer's edit panel is open, and the server's last per-field
  // complaints about it.
  const [openId, setOpenId] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // The new-account form: whether it is open, what the server said about it,
  // and what it said when the account was made. Kept apart from the edit
  // panel's own error state above, because the two forms can be on screen
  // together and a complaint about one must not appear under the other.
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [createErrors, setCreateErrors] = useState({});
  const [created, setCreated] = useState('');

  async function addCustomer(draft, clear) {
    setCreatingBusy(true);
    setCreateErrors({});
    setCreated('');
    setError('');

    try {
      const row = await createCustomer(draft);

      clear();
      setCreating(false);
      setCreated(
        d('created', { name: row.name || row.email, email: row.email }),
      );
      // Refetched rather than spliced in: the list is sorted and paged by the
      // server, and a row pushed onto the front of page three would sit
      // somewhere it does not belong.
      list.reload();
    } catch (caught) {
      // The server names the field it refused — a duplicate address, a phone
      // number that is not one — and those go under the boxes themselves.
      if (caught?.fields) setCreateErrors(caught.fields);
      else setError(d('createFailed'));
    } finally {
      setCreatingBusy(false);
    }
  }

  async function changeRole(customer, role) {
    setSavingId(customer.id);
    setError('');

    try {
      // The response is the whole row, including a recomputed
      // can_change_role, so the table updates without a refetch.
      list.replaceRow(await setCustomerRole(customer.id, role));
    } catch (caught) {
      setError(
        caught?.status === 403
          ? d('roleRefused')
          : c('changeFailed'),
      );
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Runs one of the two saves in the edit panel.
   *
   * Both answer with the whole customer row, so the table swaps it in rather
   * than refetching the page and losing the scroll position.
   */
  async function save(customer, write) {
    setSavingId(customer.id);
    setError('');
    setFieldErrors({});

    try {
      list.replaceRow(await write());

      // Editing your own row means editing the account you are signed in as.
      // The header, and this page's own idea of who you are, come from the
      // copy <AuthProvider> holds, so it has to be re-read.
      if (user?.id === customer.id) await refreshUser();
    } catch (caught) {
      // A 400 carries the server's reasons per field; anything else has no
      // more to say than that it did not happen.
      if (caught?.fields) setFieldErrors(caught.fields);

      setError(
        caught?.fields
          ? d('saveRefused')
          : c('changeFailed'),
      );
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Delete an account, after asking. A customer with shipments is erased
   * rather than removed (see deleteCustomer), and the message says which.
   */
  async function removeCustomer(customer) {
    const sure = window.confirm(d('deleteConfirm', { name: customer.name }));
    if (!sure) return;

    setSavingId(customer.id);
    setError('');
    setCreated('');

    try {
      const { anonymised } = await deleteCustomer(customer.id);

      setOpenId(null);
      setCreated(
        anonymised
          ? d('erased', { name: customer.name })
          : d('deleted', { name: customer.name }),
      );
      // Refetched, like after creating: a removed row changes what belongs
      // on this page, and an erased one may now fall outside the filter.
      list.reload();
    } catch (caught) {
      setError(
        caught?.status === 403
          ? d('deleteRefused')
          : d('deleteFailed'),
      );
    } finally {
      setSavingId(null);
    }
  }

  function openDetails(customer) {
    setFieldErrors({});
    setError('');
    setOpenId(customer.id);
  }

  // useCallback keeps this the same function on every render: the pop-up
  // re-runs its setup (focus on the X) whenever onClose changes.
  const closeDetails = useCallback(() => {
    setFieldErrors({});
    setOpenId(null);
  }, []);

  const open = list.rows.find((customer) => customer.id === openId) ?? null;

  return (
    <>
      {/* data-tour hooks: the Customers tour ("dashboardCustomers" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-cust-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>
          {d('subtitleBefore')}{' '}
          <Link className={styles.link} to="/dashboard/workers">
            {d('workersLink')}
          </Link>
          {d('subtitleAfter')}
        </p>
      </header>

      <Toolbar tour="db-cust-filters">
        <SearchInput
          value={list.searchInput}
          onChange={list.setSearchInput}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          label={d('account')}
          value={list.filters.erased}
          onChange={(value) => list.setFilter('erased', value)}
          options={ERASED_OPTIONS.map((option) => ({ value: option.value, label: d(option.key) }))}
          allLabel={d('allAccounts')}
        />
        <FilterSelect
          label={d('role')}
          value={list.filters.role}
          onChange={(value) => list.setFilter('role', value)}
          options={roles}
          allLabel={d('everyone')}
        />
        <button
          type="button"
          className={styles.newButton}
          data-tour="db-cust-new"
          onClick={() => {
            setCreating((open) => !open);
            setCreateErrors({});
            setCreated('');
          }}
        >
          {creating ? d('cancel') : d('newAccount')}
        </button>
      </Toolbar>

      <Banner tone="error">{error}</Banner>
      <Banner tone="success">{created}</Banner>

      {creating && (
        <NewCustomerFields
          onCreate={addCustomer}
          busy={creatingBusy}
          errors={createErrors}
        />
      )}

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>{d('noMatch')}</Empty>
        ) : (
          <div className={styles.tableWrap} data-tour="db-cust-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colId')}</th>
                  <th scope="col">{d('colCustomer')}</th>
                  {/* Username and e-mail share one column, and paid and
                      outstanding share another, so the whole table fits on a
                      laptop screen without scrolling sideways. */}
                  <th scope="col">{d('colContact')}</th>
                  <th scope="col">{d('colPhone')}</th>
                  <th scope="col">{d('colAddresses')}</th>
                  <th scope="col">{d('colShipments')}</th>
                  <th scope="col">{d('colPayments')}</th>
                  <th scope="col">{d('colJoined')}</th>
                  <th scope="col">{d('role')}</th>
                  <th scope="col">{d('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((customer) => (
                  <tr key={customer.id}>
                    {/* The database id, which is what the Django admin, the API
                        and a support conversation all refer to a customer by.
                        Monospaced and tabular so a column of them lines up and
                        reads back accurately over the phone. */}
                    <td className={styles.numberCell}>
                      <span className={styles.mono}>{customer.id}</span>
                    </td>

                    <td>
                      <div className={styles.person}>
                        <span className={styles.personAvatar} aria-hidden="true">
                          {initialsOf(customer.name)}
                        </span>
                        <div>
                          <div className={styles.primaryCell}>{customer.name}</div>
                          <div className={styles.tagRow}>
                            {customer.is_staff && (
                              <StatusBadge tone="progress">{d('staff')}</StatusBadge>
                            )}
                            {/* Said out loud in the table, because it is the
                                one role that looks like a customer at a
                                glance and is not one. */}
                            {customer.is_warehouse && !customer.is_staff && (
                              <StatusBadge tone="progress">{d('warehouse')}</StatusBadge>
                            )}
                            {/* An erased account is a row kept only so its
                                shipment records still hold together. Saying so
                                stops anyone trying to phone the customer. */}
                            {customer.is_erased && (
                              <StatusBadge tone="off">{d('erasedBadge')}</StatusBadge>
                            )}
                            {!customer.is_active && !customer.is_erased && (
                              <StatusBadge tone="neutral">{d('inactive')}</StatusBadge>
                            )}
                          </div>
                          {/* Nothing to correct on an erased row: it holds no
                              personal data, and putting a name back on one
                              would undo the erasure it was asked for. */}
                          {!customer.is_erased && (
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => openDetails(customer)}
                            >
                              {d('editDetails')}
                            </button>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className={`${styles.contactCell} ${styles.contactStack}`}>
                      <div>
                        {customer.email ? (
                          <a className={styles.link} href={`mailto:${customer.email}`}>
                            {customer.email}
                          </a>
                        ) : (
                          <span className={styles.mutedCell}>{d('noEmail')}</span>
                        )}
                      </div>
                      {/* The username is what the customer types to log in.
                          Usually it is the e-mail address, so it is only shown
                          when it differs — an account made with
                          createsuperuser has a different one. */}
                      {customer.username !== customer.email && (
                        <div className={styles.mutedCell}>
                          {d('login')} <span className={styles.mono}>{customer.username}</span>
                        </div>
                      )}
                    </td>

                    {/* nowrap so a number stays on one line: it is read out
                        and dialled, and a number broken in two is misread. */}
                    <td className={styles.numberCell}>
                      {customer.phone_number ? (
                        // tel: so it dials from a phone and from a desktop
                        // softphone — this is a number staff actually ring.
                        <a className={styles.link} href={`tel:${customer.phone_number}`}>
                          {customer.phone_number}
                        </a>
                      ) : (
                        <span className={styles.mutedCell}>—</span>
                      )}
                    </td>

                    <td>
                      {customer.addresses.length === 0 ? (
                        <span className={styles.mutedCell}>—</span>
                      ) : (
                        customer.addresses.map((address) => (
                          <AddressLines key={address.id} address={address} />
                        ))
                      )}
                    </td>

                    <td className={styles.numberCell}>{customer.package_count}</td>

                    <td className={styles.numberCell}>
                      <div>{d('paid', { amount: formatMoney(customer.paid_eur) })}</div>
                      {/* Amber when there is something outstanding, plain when
                          there is not. A column of zeros in warning colour
                          would make every settled customer look like a debt. */}
                      {Number(customer.outstanding_eur) > 0 ? (
                        <div className={styles.owed}>
                          {d('open', { amount: formatMoney(customer.outstanding_eur) })}
                        </div>
                      ) : (
                        <div className={styles.mutedCell}>
                          {d('open', { amount: formatMoney(customer.outstanding_eur) })}
                        </div>
                      )}
                    </td>

                    <td className={styles.dateCell}>
                      {formatDate(customer.date_joined)}
                    </td>

                    <td>
                      {/* can_change_role comes from the server, which refuses
                          the same three cases itself — your own account, a
                          superuser, an erased row. Disabling the select is
                          only so nobody presses a button that was always
                          going to be refused. */}
                      {customer.can_change_role ? (
                        <StatusSelect
                          label={d('roleFor', { name: customer.name })}
                          value={customer.role}
                          options={roles}
                          busy={savingId === customer.id}
                          onChange={(value) => changeRole(customer, value)}
                        />
                      ) : (
                        <div className={styles.mutedCell}>
                          <div>{c(`role.${customer.role}`)}</div>
                          <div className={styles.roleReason}>
                            {whyRoleIsFixed(customer, user?.id === customer.id, c)}
                          </div>
                        </div>
                      )}
                    </td>

                    <td>
                      {/* can_change_role is the server's answer to the same
                          question delete asks: you are an admin, and this is
                          not your own account, a superuser or an erased one.
                          The server checks again, so hiding it is only so
                          nobody presses a button that would be refused. */}
                      {customer.can_change_role && (
                        <button
                          type="button"
                          className={styles.deleteButton}
                          disabled={savingId === customer.id}
                          onClick={() => removeCustomer(customer)}
                        >
                          {d('delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* The edit forms in a pop-up rather than inside the table: a form
          crammed into a table cell is unusable. Keyed by the customer, so
          opening another row rebuilds the drafts instead of carrying one
          person's half-typed e-mail onto another's row. */}
      {open && (
        <Modal key={open.id} titleId="customer-details-title" onClose={closeDetails}>
          <h2 className={styles.detailTitle} id="customer-details-title">
            {open.name}
            {user?.id === open.id && (
              <span className={styles.roleReason}>{d('ownAccount')}</span>
            )}
          </h2>

          {/* A save that fails shows its message here too: the banner at the
              top of the page is hidden behind the pop-up. */}
          <Banner tone="error">{error}</Banner>

          {/* The row's figures at a glance, before the forms. */}
          <dl className={styles.modalFacts}>
            <div>
              <dt>{d('colId')}</dt>
              <dd className={styles.mono}>{open.id}</dd>
            </div>
            <div>
              <dt>{d('colShipments')}</dt>
              <dd>{open.package_count}</dd>
            </div>
            <div>
              <dt>{d('colPayments')}</dt>
              <dd>
                {d('paid', { amount: formatMoney(open.paid_eur) })}
                <br />
                <span className={Number(open.outstanding_eur) > 0 ? styles.owed : styles.mutedCell}>
                  {d('open', { amount: formatMoney(open.outstanding_eur) })}
                </span>
              </dd>
            </div>
            <div>
              <dt>{d('colJoined')}</dt>
              <dd>{formatDate(open.date_joined)}</dd>
            </div>
          </dl>

          {/* Keyed on the stored values, so a save the server tidied — a
              lowercased e-mail — leaves the form showing what was actually
              stored rather than what was typed. Typing does not change these,
              so a draft survives editing; only a save resets it. */}
          <ContactFields
            key={`${open.first_name}|${open.last_name}|${open.email}|${open.phone_number}`}
            customer={open}
            busy={savingId === open.id}
            errors={fieldErrors}
            onSave={(changes) =>
              save(open, () => updateCustomer(open.id, changes))
            }
          />

          <AddressFields
            key={JSON.stringify(open.addresses)}
            customer={open}
            busy={savingId === open.id}
            errors={fieldErrors}
            onSave={(address) =>
              save(open, () => saveCustomerAddress(open.id, address))
            }
          />
        </Modal>
      )}

      <Pagination
        page={list.page}
        count={list.count}
        hasNext={list.hasNext}
        hasPrevious={list.hasPrevious}
        onChange={list.setPage}
      />
    </>
  );
}
