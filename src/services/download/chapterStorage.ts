import NativeFile from '@modules/native-file';
import { NOVEL_STORAGE } from '@utils/Storages';
import { getDownloadStorageTarget } from '@hooks/persisted/useSettings';

export const CHAPTER_HTML_MIME_TYPE = 'text/html';

/**
 * Characters that are unsafe in a filename. Separators would let a crafted
 * title escape the granted folder, and `:` breaks the `content://` URI of the
 * document itself.
 */
const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Kept well under the 255-byte per-component limit most providers enforce. */
const MAX_TITLE_LENGTH = 100;

export type ChapterIdentity = {
  pluginId: string;
  novelId: number;
  chapterId: number;
};

export type ChapterTitleParts = {
  novelName: string;
  chapterName: string;
};

const sanitizeTitle = (value: string): string =>
  value
    .replace(INVALID_FILE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();

/**
 * Name for a chapter stored as a standalone HTML file in a user-granted folder.
 *
 * The ids are embedded so identically-titled chapters cannot collide and so the
 * file stays identifiable once it has been moved off the device.
 */
export const buildChapterFileName = (
  identity: ChapterIdentity,
  parts: ChapterTitleParts,
): string => {
  const novel = sanitizeTitle(parts.novelName) || `novel-${identity.novelId}`;
  const chapter =
    sanitizeTitle(parts.chapterName) || `chapter-${identity.chapterId}`;

  return `${novel} - ${chapter} [${identity.pluginId}-${identity.novelId}-${identity.chapterId}].html`;
};

/**
 * Legacy app-storage layout, kept so chapters downloaded before a folder was
 * configured stay readable and deletable.
 */
export const getAppStorageChapterFolder = ({
  pluginId,
  novelId,
  chapterId,
}: ChapterIdentity): string =>
  `${NOVEL_STORAGE}/${pluginId}/${novelId}/${chapterId}`;

export const getAppStorageChapterPath = (identity: ChapterIdentity): string =>
  `${getAppStorageChapterFolder(identity)}/index.html`;

/**
 * Writes one downloaded chapter to the configured destination.
 *
 * In `folder` mode the caller inlines images, so this stores a single
 * self-contained HTML file - the same file the user can copy off the device and
 * open in any browser.
 *
 * Returns the name the file was stored under, or `null` in app-storage mode.
 * The name is persisted on the chapter so reads and deletes never have to
 * re-derive it from a title that may since have changed.
 */
export const writeChapterHtml = async (
  identity: ChapterIdentity,
  parts: ChapterTitleParts,
  html: string,
): Promise<string | null> => {
  const target = getDownloadStorageTarget();

  if (target.mode === 'folder' && target.treeUri) {
    const fileName = buildChapterFileName(identity, parts);
    await NativeFile.writeTreeFile(
      target.treeUri,
      fileName,
      html,
      CHAPTER_HTML_MIME_TYPE,
    );
    return fileName;
  }

  const folder = getAppStorageChapterFolder(identity);
  await NativeFile.mkdir(folder);
  await NativeFile.writeFile(folder + '/index.html', html);
  return null;
};

/**
 * Reads a chapter, preferring the granted folder and falling back to app
 * storage.
 *
 * The fallback covers chapters downloaded before a folder was chosen, and a
 * folder whose permission grant was revoked afterwards.
 */
export const readChapterHtml = async (
  identity: ChapterIdentity,
  storedFileName: string | null,
): Promise<string> => {
  const target = getDownloadStorageTarget();

  if (target.mode === 'folder' && target.treeUri && storedFileName) {
    try {
      return await NativeFile.readTreeFile(target.treeUri, storedFileName);
    } catch {
      // The folder grant may have been revoked, or the file may predate it.
    }
  }

  return NativeFile.readFile(getAppStorageChapterPath(identity));
};

/**
 * Returns a real filesystem path to the chapter's HTML.
 *
 * Native consumers such as the EPUB exporter open the file directly and cannot
 * follow a `content://` URI, so a chapter held in a user-granted folder is
 * copied into `stagingDir` first. The staged copies are the caller's to clean
 * up.
 */
export const materializeChapterHtml = async (
  identity: ChapterIdentity,
  storedFileName: string | null,
  stagingDir: string,
): Promise<string> => {
  if (!storedFileName) {
    return getAppStorageChapterPath(identity);
  }

  await NativeFile.mkdir(stagingDir);
  const stagedPath = `${stagingDir}/${storedFileName}`;
  await NativeFile.writeFile(
    stagedPath,
    await readChapterHtml(identity, storedFileName),
  );
  return stagedPath;
};

/**
 * Removes a chapter from every location it may occupy.
 *
 * A missing file is not an error: a chapter lives in at most one of the two
 * locations and deletion has to succeed either way.
 */
export const deleteChapterFiles = async (
  identity: ChapterIdentity,
  storedFileName: string | null,
): Promise<void> => {
  const target = getDownloadStorageTarget();

  if (target.mode === 'folder' && target.treeUri && storedFileName) {
    await deleteFromFolder(target.treeUri, storedFileName);
  }

  const folder = getAppStorageChapterFolder(identity);
  if (await NativeFile.exists(folder)) {
    await NativeFile.unlink(folder);
  }
};

const deleteFromFolder = async (
  treeUri: string,
  storedFileName: string,
): Promise<void> => {
  try {
    await NativeFile.deleteTreeFile(treeUri, storedFileName);
  } catch {
    // Never written to this folder, or the grant was revoked.
  }
};
