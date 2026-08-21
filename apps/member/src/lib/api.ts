import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Member API client. Access tokens live only in memory + SecureStore; the
 * refresh token rotates on every use. GET responses are cached in
 * AsyncStorage so the app stays useful on poor connectivity — cached data is
 * always marked stale so screens can say so.
 */

const BASE: string =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3000';

const ACCESS_KEY = 'gymflow.access';
const REFRESH_KEY = 'gymflow.refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export interface CachedResult<T> {
  data: T;
  stale: boolean;
}

let accessToken: string | null = null;

export async function loadTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  return Boolean(accessToken ?? refresh);
}

async function storeTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await AsyncStorage.clear();
}

/**
 * In-flight refresh, shared by every caller.
 *
 * Screens fire several authenticated requests at once (Profile asks for the
 * member, the offers and the notifications together). Once the 15-minute
 * access token has expired those all return 401 at the same moment, and
 * without this each would post the SAME single-use refresh token: the first
 * consumes it and the rest look exactly like a stolen-token replay, which is
 * answered by revoking the family. The member is signed out — and since the
 * only way back in is a one-time password from reception, that is an
 * expensive way to open the Profile tab.
 */
let refreshInFlight: Promise<boolean> | null = null;

export async function login(gymCode: string, mobile: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/api/member/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gymCode, mobile, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? 'login_failed');
  }
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  await storeTokens(body.accessToken, body.refreshToken);
}

function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refresh) return false;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/member/v1/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
  } catch {
    // Offline or the gym's server is down: keep the tokens (and the cached
    // data and language choice) so the app recovers when the network does.
    return false;
  }
  if (!res.ok) {
    // Only a definitive rejection means these credentials are dead. A 500 or
    // a gateway error must not wipe the member's session and offline cache.
    if (res.status === 401 || res.status === 403) await clearTokens();
    return false;
  }
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  await storeTokens(body.accessToken, body.refreshToken);
  return true;
}

async function authedFetch(path: string, retry = true): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (res.status === 401 && retry && (await refreshTokens())) {
    return authedFetch(path, false);
  }
  return res;
}

/**
 * GET with offline cache. Network first; on failure, serve the last good
 * response flagged stale. Screens must show the offline indicator when
 * `stale` is true.
 */
export async function getCached<T>(path: string): Promise<CachedResult<T>> {
  const cacheKey = `cache:${path}`;
  try {
    const res = await authedFetch(path);
    if (res.status === 401) throw new ApiError(401, 'unauthorized');
    if (!res.ok) throw new ApiError(res.status, 'request_failed');
    const data = (await res.json()) as T;
    await AsyncStorage.setItem(cacheKey, JSON.stringify(data));
    return { data, stale: false };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) return { data: JSON.parse(cached) as T, stale: true };
    throw err;
  }
}

/** The QR pass must never come from cache — it rotates every 60 seconds. */
export async function getPass(): Promise<{ token: string; rotatesInSeconds: number } | null> {
  try {
    const res = await authedFetch('/api/member/v1/pass');
    if (!res.ok) return null;
    return (await res.json()) as { token: string; rotatesInSeconds: number };
  } catch {
    return null;
  }
}

export interface MeResponse {
  member: {
    id: string;
    membershipNumber: string;
    firstName: string;
    lastName: string | null;
    photoPath: string | null;
    branchName: string;
  };
  gym: {
    name: string;
    logoPath: string | null;
    primaryColor: string | null;
    supportPhone: string | null;
    supportWhatsapp: string | null;
  };
  membership: {
    planName: string;
    startDate: string;
    endDate: string;
    status: string;
    daysRemaining: number;
  } | null;
}

export const api = {
  me: () => getCached<MeResponse>('/api/member/v1/me'),
  payments: () =>
    getCached<{
      payments: {
        id: string;
        amount: string;
        method: string;
        status: string;
        payment_date: string;
        receipt_number: string | null;
      }[];
    }>('/api/member/v1/payments'),
  attendance: () =>
    getCached<{ attendance: { checked_in_at: string; method: string }[] }>(
      '/api/member/v1/attendance',
    ),
  pt: () =>
    getCached<{
      addons: {
        id: string;
        name_snapshot: string;
        sessions_total: number | null;
        sessions_used: number;
        start_date: string;
        end_date: string;
        state: string;
        trainer_name: string | null;
      }[];
      sessions: {
        session_date: string;
        start_time: string;
        end_time: string;
        status: string;
        trainer_name: string | null;
      }[];
    }>('/api/member/v1/pt'),
  notifications: () =>
    getCached<{
      notifications: { id: string; event: string; rendered_body: string; created_at: string }[];
    }>('/api/member/v1/notifications'),
  offers: () =>
    getCached<{
      offers: {
        code: string;
        name: string;
        discount_kind: string;
        discount_value: string;
        valid_to: string;
      }[];
    }>('/api/member/v1/offers'),
};
