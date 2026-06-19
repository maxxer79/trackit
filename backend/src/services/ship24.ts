import axios from 'axios';
import logger from '../utils/logger';

/**
 * Thin Ship24 Tracking API client for live delivery status. Reads the API key
 * from SHIP24_API_KEY — if unset, the feature is simply disabled. Free-tier
 * quota is consumed on TRACKER CREATION (10/month), so callers create a tracker
 * once and store the trackerId; polling results afterward is free.
 *
 * Docs: https://docs.ship24.com/
 */

const BASE_URL = 'https://api.ship24.com/public/v1';

export function ship24Enabled(): boolean {
  return !!process.env.SHIP24_API_KEY;
}

function authHeader() {
  return { Authorization: `Bearer ${process.env.SHIP24_API_KEY}`, 'Content-Type': 'application/json' };
}

export interface Ship24Result {
  milestone: string | null; // shipment-level statusMilestone
  delivered: boolean;
}

// Creates a tracker (consumes 1 of the monthly quota). Returns its trackerId.
export async function createTracker(trackingNumber: string, courierCode?: string | null): Promise<string | null> {
  try {
    const body: Record<string, unknown> = { trackingNumber };
    if (courierCode) body.courierCode = [courierCode];
    const { data } = await axios.post(`${BASE_URL}/trackers`, body, { headers: authHeader(), timeout: 20000 });
    return data?.data?.tracker?.trackerId ?? null;
  } catch (err: any) {
    logger.warn('ship24 createTracker failed', { error: err?.response?.data ?? err.message });
    throw err;
  }
}

// Fetches the latest results for an existing tracker (free — no quota).
export async function getTrackerResults(trackerId: string): Promise<Ship24Result> {
  try {
    const { data } = await axios.get(`${BASE_URL}/trackers/${trackerId}/results`, {
      headers: authHeader(),
      timeout: 20000,
    });
    const tracking = data?.data?.trackings?.[0];
    const milestone: string | null = tracking?.shipment?.statusMilestone ?? null;
    return { milestone, delivered: milestone === 'delivered' };
  } catch (err: any) {
    logger.warn('ship24 getTrackerResults failed', { trackerId, error: err?.response?.data ?? err.message });
    throw err;
  }
}
