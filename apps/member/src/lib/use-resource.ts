import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  /** Served from cache because the network call failed or the app is offline. */
  stale: boolean;
  /** The load failed and there is nothing cached to show. */
  failed: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Load an API resource with three honest outcomes instead of two.
 *
 * Every screen used to do one of these:
 *
 *   catch { }                  -> data stays null -> `if (!data) <Loading/>`
 *                                 forever. A member on a dead session, or a
 *                                 gym whose server was down, sat on a spinner
 *                                 with no error, no retry and no way back to
 *                                 the sign-in screen.
 *   catch { setRows([]) }      -> a failed request renders as "you have no
 *                                 visits" / "you have no payments", which is
 *                                 not a loading state, it is a wrong answer.
 *
 * So: `loading` while the first attempt is in flight, `failed` when it came
 * back with nothing usable, and `stale` when cached data is being shown
 * because the network did not answer. Screens must handle all three.
 */
export function useResource<T>(load: () => Promise<{ data: T; stale: boolean }>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Read inside the catch without making `run` depend on `data`, which would
  // rebuild the callback on every load and re-trigger the mount effect.
  const hasData = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const result = await load();
      setData(result.data);
      hasData.current = true;
      setStale(result.stale);
      setFailed(false);
    } catch {
      // Keep anything already on screen — a refresh that fails should not
      // blank out the membership card the member is holding up at the desk.
      if (!hasData.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, stale, failed, loading, reload: run };
}
