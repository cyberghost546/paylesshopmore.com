// src/pages/Dashboard/invoice/ShipmentSection.jsx
//
// STEP 3: THE SHIPMENT - how it travels, from where to where, and what it is.
//
// Changing the shipping method (Zeevracht / Luchtvracht) changes:
//   - which ports are offered (airports for air freight),
//   - which charges are offered in step 4 (no Bunkertoeslag on a plane),
//   - which weight matters (the calculator shows the chargeable weight for air).
//
// The ports come from the invoice settings page, where an admin can add more.

import { defaultPort, portsFor } from './invoiceForm';
import MeasurementCalculator from './MeasurementCalculator';
import { Field } from './ui';
import { useInvoiceText } from './useInvoiceText';

function PortSelect({ label, value, options, onChange, disabled }) {
  const tr = useInvoiceText();
  // A port typed on an older invoice may no longer be in the list; keep it
  // as an option so the field still shows what the invoice says.
  const names = options.map((port) => port.name);
  const all = value && !names.includes(value) ? [value, ...names] : names;

  return (
    <Field label={label}>
      {(props) => (
        <select
          {...props}
          className="form-select"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{tr('shipment.choose')}</option>
          {all.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export default function ShipmentSection({ form, update, errors, disabled, config }) {
  const tr = useInvoiceText();
  function changeFreight(freight) {
    // A new method means new ports: move to that method's defaults.
    update({
      freight,
      port_of_loading: defaultPort(config.ports, freight, 'loading'),
      port_of_discharge: defaultPort(config.ports, freight, 'discharge'),
    });
  }

  return (
    <section aria-labelledby="shipment-title" className="mb-4">
      <h2 id="shipment-title" className="invoice-section-title">
        {tr('shipment.title')}
      </h2>

      <div className="row g-3">
        <div className="col-md-4">
          <Field label={tr('shipment.method')}>
            {(props) => (
              <select
                {...props}
                className="form-select"
                value={form.freight}
                disabled={disabled}
                onChange={(event) => changeFreight(event.target.value)}
              >
                <option value="sea">{tr('shipment.sea')}</option>
                <option value="air">{tr('shipment.air')}</option>
              </select>
            )}
          </Field>
        </div>
        <div className="col-md-4">
          <PortSelect
            label={tr(form.freight === 'air' ? 'shipment.loadingAir' : 'shipment.loading')}
            value={form.port_of_loading}
            options={portsFor(config.ports, form.freight, 'loading')}
            onChange={(value) => update({ port_of_loading: value })}
            disabled={disabled}
          />
        </div>
        <div className="col-md-4">
          <PortSelect
            label={tr(form.freight === 'air' ? 'shipment.dischargeAir' : 'shipment.discharge')}
            value={form.port_of_discharge}
            options={portsFor(config.ports, form.freight, 'discharge')}
            onChange={(value) => update({ port_of_discharge: value })}
            disabled={disabled}
          />
        </div>

        <div className="col-md-8">
          <Field label={tr('shipment.goods')}>
            {(props) => (
              <input
                {...props}
                value={form.goods_description}
                disabled={disabled}
                maxLength={300}
                onChange={(event) => update({ goods_description: event.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="col-md-4">
          <Field label={tr('shipment.orderNumber')}>
            {(props) => (
              <input
                {...props}
                value={form.order_number}
                disabled={disabled}
                maxLength={50}
                onChange={(event) => update({ order_number: event.target.value })}
              />
            )}
          </Field>
        </div>

        <div className="col-sm-4">
          <Field
            label={tr('shipment.pieces')}
            error={errors.pieces}
            hint={form.useMeasurements ? tr('shipment.piecesHint') : undefined}
          >
            {(props) => (
              <input
                {...props}
                inputMode="numeric"
                value={form.pieces}
                disabled={disabled}
                onChange={(event) => update({ pieces: event.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="col-sm-4">
          <Field label={tr('shipment.weight')} error={errors.weight_kg}>
            {(props) => (
              <input
                {...props}
                inputMode="decimal"
                value={form.weight_kg}
                disabled={disabled}
                onChange={(event) => update({ weight_kg: event.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="col-sm-4">
          <Field
            label={tr('shipment.volume')}
            error={errors.volume_m3}
            hint={tr(form.useMeasurements ? 'shipment.volumeCalcHint' : 'shipment.volumeManualHint')}
          >
            {(props) => (
              <input
                {...props}
                inputMode="decimal"
                value={form.useMeasurements ? '' : form.volume_m3}
                placeholder={form.useMeasurements ? tr('shipment.calculated') : ''}
                disabled={disabled || form.useMeasurements}
                onChange={(event) => update({ volume_m3: event.target.value })}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="form-check form-switch mb-2">
        <input
          id="use-measurements"
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked={form.useMeasurements}
          disabled={disabled}
          onChange={(event) => update({ useMeasurements: event.target.checked })}
        />
        <label className="form-check-label" htmlFor="use-measurements">
          {tr('shipment.useMeasurements')}
        </label>
      </div>

      {form.useMeasurements && (
        <MeasurementCalculator form={form} update={update} error={errors.measurements} disabled={disabled} />
      )}
    </section>
  );
}
