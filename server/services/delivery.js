import { ShippingZone } from "../models/ShippingZone.js";
import { getSettings } from "../models/Misc.js";
import { toKobo, fromKobo } from "../utils/helpers.js";

function etaText(m) {
  if (m.etaMinDays == null && m.etaMaxDays == null) return "";
  const a = m.etaMinDays, b = m.etaMaxDays;
  if (a != null && b != null) return a === b ? `${a} day${a === 1 ? "" : "s"}` : `${a}-${b} days`;
  return `${a ?? b} day${(a ?? b) === 1 ? "" : "s"}`;
}

/** Delivery options for a state, with free-delivery thresholds applied. */
export async function deliveryOptions(state, subtotalNaira = 0) {
  const settings = await getSettings();
  const options = [];
  if (state) {
    const zone = await ShippingZone.findOne({ active: true, states: state }).sort({ sortOrder: 1 }).lean();
    if (zone) {
      for (const m of zone.methods) {
        const free = m.freeOver != null && toKobo(subtotalNaira) >= toKobo(m.freeOver);
        options.push({
          code: m.code,
          name: m.name,
          fee: free ? 0 : m.fee,
          baseFee: m.fee,
          free,
          freeOver: m.freeOver ?? null,
          eta: etaText(m),
          zone: zone.name,
          pickup: false,
        });
      }
    }
  }
  if (settings.delivery?.pickupEnabled) {
    options.push({
      code: "pickup",
      name: "Store pickup",
      fee: 0,
      baseFee: 0,
      free: false,
      eta: settings.delivery.pickupNote || "Collect from our store",
      zone: "Pickup",
      pickup: true,
    });
  }
  return options;
}

export async function resolveDelivery(state, methodCode, subtotalNaira) {
  const options = await deliveryOptions(state, subtotalNaira);
  if (!options.length) return { error: "unavailable", options };
  const chosen = options.find((o) => o.code === methodCode) || null;
  return { chosen, options };
}

export { fromKobo };
