// src/pages/Dashboard/FloorDevices.jsx
//
// "Floor devices": the shared phones and scanners on which a warehouse worker
// signs in by tapping their name and typing a PIN, which areas of the
// warehouse each one may be used in, and the record of who signed in on which
// one. Admins only; the server refuses everybody else.
//
// A device is registered from the device itself: open this page on it, signed
// in as an admin, name it and press the button. The server answers by putting
// the device's token in a cookie no script can read - this page never sees it
// - and the admin then signs out. Revoking stops the device at once.
//
// Locations: an admin names the areas of the warehouse ("Packing area") and
// ticks which parts of the warehouse app are worked there. Each device is then
// granted the locations it is used in, and on that device only those parts of
// the app work. Deny by default: once the first location exists, a device with
// no location cannot use any of those parts. Scanning, the package page and
// moving a package along always work. The server enforces this on every
// request (backend accounts/floor.py, warehouse/access.py); this page only
// sets it.
//
// What makes a four-digit PIN acceptable is mostly that it only works on one
// of these. See backend accounts/floor.py.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/floor-devices
//   Who can open: office staff
//   Links to:     nothing
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js, api/warehouse.js (section names)

import { useEffect, useState } from 'react';
import {
  createFloorLocation,
  deleteFloorLocation,
  grantFloorDeviceLocation,
  listFloorDevices,
  listFloorEvents,
  listFloorLocations,
  registerThisFloorDevice,
  revokeFloorDevice,
  revokeFloorDeviceLocation,
  updateFloorLocation,
} from '../../api/staff';
import { getWarehouseAccess } from '../../api/warehouse';
import { useAuth } from '../../auth/useAuth';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { formatDateTime } from './format';
import { Field } from './PeopleFields';
import { Banner, Empty, StatusBadge } from './ui';
import { canManageWarehouse } from './managerAccess';
import { usePageText } from './usePageText';
import styles from './Dashboard.module.css';

/** Tones for the audit trail, so a lock stands out from a hundred sign-ins. */
const EVENT_TONE = {
  pin_sign_in: 'neutral',
  code_sign_in: 'neutral',
  wrong_pin: 'progress',
  pin_locked: 'off',
  pin_set: 'neutral',
  pin_reset: 'progress',
  access_granted: 'done',
  access_revoked: 'progress',
};

const NO_LOCATION_FORM = null;
const EMPTY_LOCATION = { id: null, name: '', description: '', sections: [] };

/** The first message the server gave for a field, or for the request as a whole. */
function serverMessage(error, fallback) {
  const fields = error?.fields;
  if (fields && typeof fields === 'object') {
    for (const value of Object.values(fields)) {
      if (Array.isArray(value) && value.length) return String(value[0]);
      if (typeof value === 'string') return value;
    }
  }
  return fallback;
}

export default function FloorDevices() {
  const { user } = useAuth();
  const d = usePageText('floorDevices');
  // Admins and warehouse managers run the floor's devices.
  const isAdmin = canManageWarehouse(user);

  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [devices, setDevices] = useState([]);
  const [events, setEvents] = useState([]);
  const [locations, setLocations] = useState([]);
  // The warehouse app's sections, [{ key, title, description }], so a
  // location can say what work is done there in the same words as the
  // Warehouse access page.
  const [sections, setSections] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  // The location being added or edited, or null when the form is closed.
  const [locationForm, setLocationForm] = useState(NO_LOCATION_FORM);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    Promise.all([listFloorDevices(), listFloorEvents(), listFloorLocations(), getWarehouseAccess()])
      .then(([deviceRows, eventRows, locationRows, access]) => {
        if (!live) return;
        setDevices(deviceRows);
        setEvents(eventRows);
        setLocations(locationRows);
        setSections(access?.choices ?? []);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [isAdmin, attempt]);

  function load() {
    setState('loading');
    setAttempt((n) => n + 1);
  }

  if (!isAdmin) {
    return (
      <>
        <header className={styles.head} data-tour="db-devices-intro">
          <h1 className={styles.title}>{d('title')}</h1>
        </header>
        <Banner tone="info">{d('adminOnly')}</Banner>
      </>
    );
  }

  if (state === 'loading') return <Loading inline />;
  if (state === 'error') return <ConnectionError inline onRetry={load} />;

  const thisDevice = devices.find((device) => device.is_this_device && !device.revoked_at);
  const activeDevices = devices.filter((device) => !device.revoked_at);
  const devicesWithoutAccess = locations.length
    ? activeDevices.filter((device) => (device.locations ?? []).length === 0)
    : [];
  const sectionTitle = Object.fromEntries(sections.map((section) => [section.key, section.title]));

  async function register(event) {
    event.preventDefault();
    setBusy('register');
    setMessage(null);
    try {
      const device = await registerThisFloorDevice(name.trim());
      setName('');
      setMessage({ tone: 'success', text: d('registered', { name: device.name }) });
      load();
    } catch {
      setMessage({ tone: 'error', text: d('registerFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(device) {
    if (!window.confirm(d('revokeConfirm', { name: device.name }))) {
      return;
    }
    setBusy(device.id);
    setMessage(null);
    try {
      await revokeFloorDevice(device.id);
      setMessage({ tone: 'success', text: d('revoked', { name: device.name }) });
      load();
    } catch {
      setMessage({ tone: 'error', text: d('revokeFailed') });
    } finally {
      setBusy(null);
    }
  }

  // ---- Location access per device ------------------------------------------

  /** Swap one device's row for the updated one the server answered with. */
  function replaceDevice(updated) {
    setDevices((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
  }

  async function grant(device, location) {
    const key = `grant-${device.id}-${location.id}`;
    setBusy(key);
    setMessage(null);
    try {
      replaceDevice(await grantFloorDeviceLocation(device.id, location.id));
      setMessage({ tone: 'success', text: d('granted', { device: device.name, location: location.name }) });
    } catch (error) {
      setMessage({ tone: 'error', text: serverMessage(error, d('grantFailed')) });
    } finally {
      setBusy(null);
    }
  }

  async function revokeLocation(device, location) {
    if (!window.confirm(d('revokeLocationConfirm', { location: location.name, device: device.name }))) {
      return;
    }
    const key = `revoke-${device.id}-${location.id}`;
    setBusy(key);
    setMessage(null);
    try {
      replaceDevice(await revokeFloorDeviceLocation(device.id, location.id));
      setMessage({ tone: 'success', text: d('locationRevoked', { device: device.name, location: location.name }) });
    } catch (error) {
      setMessage({ tone: 'error', text: serverMessage(error, d('locationRevokeFailed')) });
    } finally {
      setBusy(null);
    }
  }

  // ---- Locations -----------------------------------------------------------

  function toggleSection(key) {
    setLocationForm((form) => ({
      ...form,
      sections: form.sections.includes(key)
        ? form.sections.filter((existing) => existing !== key)
        : [...form.sections, key],
    }));
  }

  async function saveLocation(event) {
    event.preventDefault();
    const body = {
      name: locationForm.name.trim(),
      description: locationForm.description.trim(),
      sections: locationForm.sections,
    };
    setBusy('location');
    setMessage(null);
    try {
      if (locationForm.id) {
        await updateFloorLocation(locationForm.id, body);
      } else {
        await createFloorLocation(body);
      }
      setMessage({ tone: 'success', text: d('locationSaved', { name: body.name }) });
      setLocationForm(NO_LOCATION_FORM);
      load();
    } catch (error) {
      setMessage({ tone: 'error', text: serverMessage(error, d('locationSaveFailed')) });
    } finally {
      setBusy(null);
    }
  }

  async function removeLocation(location) {
    const used = location.device_count ? d('deleteLocationUsed', { count: location.device_count }) : '';
    if (!window.confirm(d('deleteLocationConfirm', { name: location.name }) + used)) return;
    setBusy(`delete-${location.id}`);
    setMessage(null);
    try {
      await deleteFloorLocation(location.id);
      setMessage({ tone: 'success', text: d('locationDeleted', { name: location.name }) });
      load();
    } catch {
      setMessage({ tone: 'error', text: d('locationDeleteFailed') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* data-tour hooks: this page's tour ("dashboardFloorDevices" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-devices-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Banner tone={message?.tone}>{message?.text}</Banner>

      {devicesWithoutAccess.length > 0 && (
        <Banner tone="error">
          {d(devicesWithoutAccess.length === 1 ? 'noAccessOne' : 'noAccessMany', {
            names: devicesWithoutAccess.map((device) => `“${device.name}”`).join(', '),
          })}
        </Banner>
      )}

      {thisDevice ? (
        <Banner tone="info">{d('onThisDevice', { name: thisDevice.name })}</Banner>
      ) : (
        <form className={styles.officeBox} onSubmit={register} data-tour="db-devices-register">
          <p className={styles.officeHead}>{d('registerHead')}</p>
          <div className={styles.officeGrid}>
            <Field
              label={d('registerName')}
              name="name"
              value={name}
              onChange={setName}
              errors={{}}
            />
          </div>
          <p className={styles.officeNote}>{d('registerNote')}</p>
          <button type="submit" className={styles.rowButton} disabled={busy === 'register' || !name.trim()}>
            {busy === 'register' ? d('registering') : d('registerButton')}
          </button>
        </form>
      )}

      {/* ---- Locations ---- */}
      <div className={styles.floorHeadingRow}>
        <h2 className={`${styles.detailTitle} ${styles.floorSection}`}>{d('locationsTitle')}</h2>
        {!locationForm && (
          <button type="button" className={styles.rowButton} onClick={() => setLocationForm({ ...EMPTY_LOCATION })}>
            {d('addLocation')}
          </button>
        )}
      </div>
      <p className={styles.officeNote}>{d('locationsNote')}</p>

      {locationForm && (
        <form className={styles.officeBox} onSubmit={saveLocation} aria-label={d('locationFormLabel')}>
          <p className={styles.officeHead}>{locationForm.id ? d('editLocation') : d('newLocation')}</p>
          <div className={styles.officeGrid}>
            <Field
              label={d('locationName')}
              name="location-name"
              value={locationForm.name}
              onChange={(value) => setLocationForm((form) => ({ ...form, name: value }))}
              errors={{}}
            />
            <Field
              label={d('locationDescription')}
              name="location-description"
              value={locationForm.description}
              onChange={(value) => setLocationForm((form) => ({ ...form, description: value }))}
              errors={{}}
            />
          </div>
          <fieldset className={styles.floorSections}>
            <legend className={styles.officeLabel}>{d('workDoneHere')}</legend>
            {sections.map((section) => (
              <label key={section.key} className={styles.floorCheck}>
                <input
                  type="checkbox"
                  checked={locationForm.sections.includes(section.key)}
                  onChange={() => toggleSection(section.key)}
                />
                <span>
                  <span className={styles.accessTitle}>{section.title}</span>
                  <span className={styles.accessDescription}>{section.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className={styles.floorActions}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={busy === 'location' || !locationForm.name.trim()}
            >
              {busy === 'location' ? d('saving') : d('saveLocation')}
            </button>
            <button type="button" className={styles.linkButton} onClick={() => setLocationForm(NO_LOCATION_FORM)}>
              {d('cancel')}
            </button>
          </div>
        </form>
      )}

      {locations.length === 0 ? (
        <Empty>{d('noLocations')}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{d('colLocation')}</th>
                <th scope="col">{d('colWork')}</th>
                <th scope="col">{d('colDevices')}</th>
                <th scope="col">
                  <span className={styles.srOnly}>{d('colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id}>
                  <td>
                    <div className={styles.primaryCell}>{location.name}</div>
                    {location.description && <div className={styles.mutedCell}>{location.description}</div>}
                  </td>
                  <td>
                    {location.sections.length
                      ? location.sections.map((key) => sectionTitle[key] ?? key).join(', ')
                      : <span className={styles.mutedCell}>{d('nothingYet')}</span>}
                  </td>
                  <td>{location.device_count}</td>
                  <td className={styles.floorRowActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      aria-label={d('editLabel', { name: location.name })}
                      onClick={() =>
                        setLocationForm({
                          id: location.id,
                          name: location.name,
                          description: location.description ?? '',
                          sections: [...location.sections],
                        })
                      }
                    >
                      {d('edit')}
                    </button>
                    <button
                      type="button"
                      className={styles.linkButton}
                      aria-label={d('deleteLabel', { name: location.name })}
                      disabled={busy === `delete-${location.id}`}
                      onClick={() => removeLocation(location)}
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

      {/* ---- Devices ---- */}
      <h2 className={`${styles.detailTitle} ${styles.floorSection}`}>{d('devicesTitle')}</h2>
      {devices.length === 0 ? (
        <Empty>{d('noDevices')}</Empty>
      ) : (
        <div className={styles.tableWrap} data-tour="db-devices-table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{d('colDevice')}</th>
                {/* Second, so the Grant/Revoke buttons are on screen on a
                    phone without scrolling the table sideways. */}
                <th scope="col">{d('colLocations')}</th>
                <th scope="col">{d('colRegistered')}</th>
                <th scope="col">{d('colLastUsed')}</th>
                <th scope="col">{d('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const granted = new Set((device.locations ?? []).map((location) => location.id));
                return (
                  <tr key={device.id}>
                    <td>
                      <div className={styles.primaryCell}>{device.name}</div>
                      {device.is_this_device && <StatusBadge tone="neutral">{d('thisDevice')}</StatusBadge>}
                    </td>
                    <td>
                      {device.revoked_at || locations.length === 0 ? (
                        <span className={styles.mutedCell}>{device.revoked_at ? '—' : d('allWork')}</span>
                      ) : (
                        <ul className={styles.floorAccessList} aria-label={d('locationsFor', { device: device.name })}>
                          {locations.map((location) => {
                            const has = granted.has(location.id);
                            const key = `${has ? 'revoke' : 'grant'}-${device.id}-${location.id}`;
                            return (
                              <li key={location.id} className={styles.floorAccessItem}>
                                <StatusBadge tone={has ? 'done' : 'off'}>{has ? d('allowed') : d('noAccess')}</StatusBadge>
                                <span>{location.name}</span>
                                <button
                                  type="button"
                                  className={has ? styles.linkButton : styles.rowButton}
                                  disabled={busy === key}
                                  aria-label={d(has ? 'revokeLabel' : 'grantLabel', { location: location.name, device: device.name })}
                                  onClick={() => (has ? revokeLocation(device, location) : grant(device, location))}
                                >
                                  {busy === key ? '…' : has ? d('revokeAccess') : d('grantAccess')}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td className={styles.dateCell}>
                      {formatDateTime(device.created_at)}
                      {device.created_by && <div className={styles.mutedCell}>{d('by', { name: device.created_by })}</div>}
                    </td>
                    <td className={styles.dateCell}>
                      {device.last_seen_at ? formatDateTime(device.last_seen_at) : '—'}
                    </td>
                    <td>
                      {device.revoked_at ? (
                        <div className={styles.mutedCell}>
                          <StatusBadge tone="off">{d('revokedBadge')}</StatusBadge>
                          <div>
                            {formatDateTime(device.revoked_at)}
                            {device.revoked_by && ` ${d('by', { name: device.revoked_by })}`}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.linkButton}
                          disabled={busy === device.id}
                          onClick={() => revoke(device)}
                          aria-label={d('revokeDeviceLabel', { name: device.name })}
                        >
                          {busy === device.id ? d('revoking') : d('revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={`${styles.detailTitle} ${styles.floorSection}`}>{d('logTitle')}</h2>
      <p className={styles.officeNote}>{d('logNote')}</p>
      {events.length === 0 ? (
        <Empty>{d('nothingLogged')}</Empty>
      ) : (
        <div className={styles.tableWrap} data-tour="db-devices-log">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{d('colWhen')}</th>
                <th scope="col">{d('colWhat')}</th>
                <th scope="col">{d('colWorker')}</th>
                <th scope="col">{d('colDevice')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className={styles.dateCell}>{formatDateTime(event.created_at)}</td>
                  <td>
                    <StatusBadge tone={EVENT_TONE[event.kind] ?? 'neutral'}>
                      {event.kind_display}
                    </StatusBadge>
                    {event.location && <div>{event.location}</div>}
                    {event.actor && <div className={styles.mutedCell}>{d('by', { name: event.actor })}</div>}
                  </td>
                  <td>{event.user ?? '—'}</td>
                  <td className={styles.mutedCell}>{event.device ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
