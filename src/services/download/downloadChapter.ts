import * as cheerio from 'cheerio';
import { Plugin } from '@plugins/types';
import { downloadFile, fetchDataUrl } from '@plugins/helpers/fetch';
import { getPlugin } from '@plugins/pluginManager';
import { getString } from '@i18n/translations';
import { getChapter } from '@database/queries/ChapterQueries';
import { sleep } from '@utils/sleep';
import {
  getChapterDownloadCooldownMs,
  getDownloadStorageTarget,
} from '@hooks/persisted/useSettings';
import { getNovelById } from '@database/queries/NovelQueries';
import { dbManager } from '@database/db';
import { chapterSchema } from '@database/schema';
import type {
  BackgroundTaskExecutionContext,
  TaskProgressUpdater,
} from '@services/backgroundTasks/contracts';
import NativeFile from '@modules/native-file';
import { eq } from 'drizzle-orm';
import { parseDownloadCheckpoint } from './downloadCheckpoint';
import {
  getAppStorageChapterFolder,
  writeChapterHtml,
  type ChapterIdentity,
} from './chapterStorage';

/**
 * Replaces every remote image with a local reference.
 *
 * In app-storage mode images become sibling `.b64.png` files referenced over
 * `file://`. When downloads target a user-granted folder they are inlined as
 * `data:` URLs instead: a `content://` document URI is not something the reader
 * WebView can reliably load, and inlining keeps each chapter one self-contained
 * file the user can copy off the device.
 */
const localizeImages = async (
  html: string,
  plugin: Plugin,
  identity: ChapterIdentity,
  inline: boolean,
): Promise<string> => {
  const loadedCheerio = cheerio.load(html);
  const imgs = loadedCheerio('img').toArray();

  for (let i = 0; i < imgs.length; i++) {
    const elem = loadedCheerio(imgs[i]);
    const url = elem.attr('src');
    if (!url) {
      continue;
    }
    try {
      const absoluteURL = new URL(url, plugin.site).href;
      if (inline) {
        elem.attr(
          'src',
          await fetchDataUrl(absoluteURL, plugin.imageRequestInit),
        );
        continue;
      }
      const fileurl = `${getAppStorageChapterFolder(identity)}/${i}.b64.png`;
      elem.attr('src', 'file://' + fileurl);
      await downloadFile(absoluteURL, fileurl, plugin.imageRequestInit);
    } catch (e) {
      elem.attr('alt', String(e));
    }
  }

  return loadedCheerio.html();
};

const downloadChapter = async (chapterId: number) => {
  const chapter = await getChapter(chapterId);
  if (!chapter) {
    throw new Error('Chapter not found with id: ' + chapterId);
  }
  if (chapter.isDownloaded) {
    return;
  }
  const novel = await getNovelById(chapter.novelId);
  if (!novel) {
    throw new Error('Novel not found for chapter: ' + chapter.name);
  }
  const plugin = getPlugin(novel.pluginId);
  if (!plugin) {
    throw new Error(getString('downloadScreen.pluginNotFound'));
  }
  const chapterText = await plugin.parseChapter(chapter.path);
  if (chapterText && chapterText.length) {
    const identity: ChapterIdentity = {
      pluginId: novel.pluginId,
      novelId: novel.id,
      chapterId: chapter.id,
    };
    const { mode } = getDownloadStorageTarget();
    const usesFolder = mode === 'folder';

    if (!usesFolder) {
      const folder = getAppStorageChapterFolder(identity);
      await NativeFile.mkdir(folder);
      // Keeps downloaded chapters out of the Android media scanner.
      await NativeFile.writeFile(folder + '/.nomedia', '');
    }

    const html = await localizeImages(chapterText, plugin, identity, usesFolder);
    const downloadFileName = await writeChapterHtml(
      identity,
      { novelName: novel.name, chapterName: chapter.name },
      html,
    );

    await dbManager.write(async tx => {
      tx.update(chapterSchema)
        .set({ isDownloaded: true, downloadFileName })
        .where(eq(chapterSchema.id, chapter.id))
        .run();
    });

    await sleep(getChapterDownloadCooldownMs());
  } else {
    throw new Error(getString('downloadScreen.chapterEmptyOrScrapeError'));
  }
};

export const downloadChapters = async (
  {
    chapters,
  }: {
    novelName: string;
    chapters: { chapterId: number; chapterName: string }[];
  },
  setMeta: TaskProgressUpdater,
  context: BackgroundTaskExecutionContext,
) => {
  if (!chapters.length) return;

  const checkpoint = parseDownloadCheckpoint(
    context.checkpoint,
    chapters.length,
  );
  const failures = [...checkpoint.failures];

  for (let index = checkpoint.nextIndex; index < chapters.length; index++) {
    const chapter = chapters[index];
    setMeta(meta => ({
      ...meta,
      isRunning: true,
      progress: index / chapters.length,
      progressText: `${index + 1}/${chapters.length} · ${chapter.chapterName}`,
    }));

    try {
      await downloadChapter(chapter.chapterId);
    } catch (error) {
      failures.push(
        `${chapter.chapterName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await context.updateCheckpoint(
      JSON.stringify({ nextIndex: index + 1, failures }),
    );
  }

  setMeta(meta => ({
    ...meta,
    progress: 1,
    isRunning: false,
  }));

  if (failures.length) {
    throw new Error(
      `${failures.length} of ${
        chapters.length
      } chapters failed: ${failures.join('; ')}`,
    );
  }
};