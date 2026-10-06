import { useEffect, useState } from 'react';

import { getFolderStoredChapterCount } from '@database/queries/ChapterQueries';

/**
 * Number of downloaded chapters that live in a user-granted folder.
 *
 * Those files sit outside `NOVEL_STORAGE`, which is the only path the backup
 * archiver walks, so they cannot be included in an archive. Callers use this to
 * warn instead of silently dropping the chapters.
 *
 * Only queried while `enabled`, so it stays free when the files option is off.
 */
export const useFolderStoredChapterCount = (enabled: boolean): number => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    let cancelled = false;
    getFolderStoredChapterCount()
      .then(result => {
        if (!cancelled) {
          setCount(result);
        }
      })
      .catch(() => {
        // A failed count must not block the backup itself.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return count;
};
