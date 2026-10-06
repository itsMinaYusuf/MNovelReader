import NativeFile from '@modules/native-file';

import { MMKVStorage } from '@utils/mmkv/mmkv';
import {
  buildChapterFileName,
  deleteChapterFiles,
  getAppStorageChapterPath,
  materializeChapterHtml,
  readChapterHtml,
  writeChapterHtml,
} from '../chapterStorage';

const identity = { pluginId: 'plugin.test', novelId: 7, chapterId: 42 };

const nativeFile = NativeFile as unknown as {
  writeTreeFile: jest.Mock;
  readTreeFile: jest.Mock;
  deleteTreeFile: jest.Mock;
  writeFile: jest.Mock;
  readFile: jest.Mock;
  exists: jest.Mock;
  unlink: jest.Mock;
  mkdir: jest.Mock;
};

const setTarget = (settings: Record<string, unknown> | null) => {
  MMKVStorage.set('APP_SETTINGS', JSON.stringify(settings ?? {}));
};

const useFolderTarget = () =>
  setTarget({
    downloadStorageMode: 'folder',
    downloadFolderUri: 'content://tree/mock',
    downloadFolderName: 'Download',
  });

describe('buildChapterFileName', () => {
  it('keeps the ids so renamed chapters stay identifiable', () => {
    expect(
      buildChapterFileName(identity, {
        novelName: 'My Novel',
        chapterName: 'Chapter 1',
      }),
    ).toBe('My Novel - Chapter 1 [plugin.test-7-42].html');
  });

  it('strips path separators and reserved characters from titles', () => {
    const fileName = buildChapterFileName(identity, {
      novelName: 'A/B:C',
      chapterName: 'The "End" <vol 1>',
    });

    expect(fileName).not.toMatch(/[\\/:*?"<>|]/);
    expect(fileName).toBe('A B C - The End vol 1 [plugin.test-7-42].html');
  });

  it('falls back to ids when a title is only unsafe characters', () => {
    expect(
      buildChapterFileName(identity, { novelName: '///', chapterName: '***' }),
    ).toBe('novel-7 - chapter-42 [plugin.test-7-42].html');
  });
});

describe('writeChapterHtml', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores one self-contained file in the granted folder', async () => {
    useFolderTarget();

    await expect(
      writeChapterHtml(
        identity,
        { novelName: 'My Novel', chapterName: 'Chapter 1' },
        '<html></html>',
      ),
    ).resolves.toBe('My Novel - Chapter 1 [plugin.test-7-42].html');

    expect(nativeFile.writeTreeFile).toHaveBeenCalledWith(
      'content://tree/mock',
      'My Novel - Chapter 1 [plugin.test-7-42].html',
      '<html></html>',
      'text/html',
    );
    expect(nativeFile.writeFile).not.toHaveBeenCalled();
  });

  it('falls back to the legacy app-storage layout', async () => {
    setTarget(null);

    await expect(
      writeChapterHtml(identity, { novelName: 'n', chapterName: 'c' }, '<p/>'),
    ).resolves.toBeNull();

    expect(nativeFile.writeTreeFile).not.toHaveBeenCalled();
    expect(nativeFile.writeFile).toHaveBeenCalledWith(
      getAppStorageChapterPath(identity),
      '<p/>',
    );
  });

  it('ignores folder mode without a granted uri', async () => {
    setTarget({ downloadStorageMode: 'folder' });

    await expect(
      writeChapterHtml(identity, { novelName: 'n', chapterName: 'c' }, '<p/>'),
    ).resolves.toBeNull();
    expect(nativeFile.writeTreeFile).not.toHaveBeenCalled();
  });
});

describe('readChapterHtml', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads from the granted folder', async () => {
    useFolderTarget();
    nativeFile.readTreeFile.mockResolvedValue('<html>folder</html>');

    await expect(readChapterHtml(identity, 'a.html')).resolves.toBe(
      '<html>folder</html>',
    );
    expect(nativeFile.readFile).not.toHaveBeenCalled();
  });

  it('reads legacy chapters that have no stored file name', async () => {
    useFolderTarget();
    nativeFile.readFile.mockResolvedValue('<html>legacy</html>');

    await expect(readChapterHtml(identity, null)).resolves.toBe(
      '<html>legacy</html>',
    );
    expect(nativeFile.readTreeFile).not.toHaveBeenCalled();
  });

  it('falls back to app storage when the grant was revoked', async () => {
    useFolderTarget();
    nativeFile.readTreeFile.mockRejectedValue(new Error('SecurityException'));
    nativeFile.readFile.mockResolvedValue('<html>legacy</html>');

    await expect(readChapterHtml(identity, 'a.html')).resolves.toBe(
      '<html>legacy</html>',
    );
  });
});

describe('materializeChapterHtml', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the real path for chapters already in app storage', async () => {
    await expect(
      materializeChapterHtml(identity, null, '/cache/staging'),
    ).resolves.toBe(getAppStorageChapterPath(identity));
    expect(nativeFile.writeFile).not.toHaveBeenCalled();
  });

  it('copies a folder chapter into staging for native readers', async () => {
    useFolderTarget();
    nativeFile.readTreeFile.mockResolvedValue('<html>folder</html>');

    await expect(
      materializeChapterHtml(identity, 'a.html', '/cache/staging'),
    ).resolves.toBe('/cache/staging/a.html');

    expect(nativeFile.writeFile).toHaveBeenCalledWith(
      '/cache/staging/a.html',
      '<html>folder</html>',
    );
  });
});

describe('deleteChapterFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('removes the folder file and any app-storage leftovers', async () => {
    useFolderTarget();
    nativeFile.exists.mockResolvedValue(true);

    await deleteChapterFiles(identity, 'a.html');

    expect(nativeFile.deleteTreeFile).toHaveBeenCalledWith(
      'content://tree/mock',
      'a.html',
    );
    expect(nativeFile.unlink).toHaveBeenCalled();
  });

  it('does not fail when the folder file is already gone', async () => {
    useFolderTarget();
    nativeFile.deleteTreeFile.mockRejectedValue(new Error('FileNotFound'));
    nativeFile.exists.mockResolvedValue(false);

    await expect(
      deleteChapterFiles(identity, 'a.html'),
    ).resolves.toBeUndefined();
    expect(nativeFile.unlink).not.toHaveBeenCalled();
  });

  it('leaves the folder alone for legacy chapters', async () => {
    setTarget(null);

    await deleteChapterFiles(identity, null);

    expect(nativeFile.deleteTreeFile).not.toHaveBeenCalled();
  });
});
