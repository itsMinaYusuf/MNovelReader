import { requireNativeModule } from 'expo-modules-core';

export type ReadDirResult = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type DirectorySelection = {
  uri: string;
  name: string;
};

export type TreeEntry = {
  name: string;
  /** `content://` document URI for the entry. */
  path: string;
  isDirectory: boolean;
};

export type FileCopyResult = {
  uri: string;
  size: number;
};

type NativeFileModule = {
  DocumentDirectoryPath: string;
  ExternalDirectoryPath: string;
  ExternalCachesDirectoryPath: string;
  createDocument(filename: string, mimeType: string): Promise<string>;
  pickDocument(mimeType: string): Promise<string>;
  /**
   * Opens Android's folder picker. Passing a `content://` tree URI pre-navigates
   * the picker to that folder. Rejects with `ECANCELLED` when the user backs out.
   */
  pickDirectory(initialUri?: string): Promise<DirectorySelection>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  copyFile(filepath: string, destPath: string): Promise<void>;
  copyFileToDirectory(
    sourcePath: string,
    directoryUri: string,
    fileName: string,
    mimeType: string,
    replace: boolean,
  ): Promise<FileCopyResult>;
  moveFile(filepath: string, destPath: string): Promise<void>;
  exists(filepath: string): Promise<boolean>;
  mkdir(filepath: string): Promise<void>;
  unlink(filepath: string): Promise<void>;
  readDir(directory: string): Promise<ReadDirResult[]>;

  /**
   * Single-file operations inside a folder granted through `pickDirectory`.
   * `fileName` must be a bare name - path separators are rejected.
   */
  treeFileExists(treeUri: string, fileName: string): Promise<boolean>;
  writeTreeFile(
    treeUri: string,
    fileName: string,
    content: string,
    mimeType: string,
  ): Promise<FileCopyResult>;
  readTreeFile(treeUri: string, fileName: string): Promise<string>;
  deleteTreeFile(treeUri: string, fileName: string): Promise<void>;
  listTreeFiles(treeUri: string): Promise<TreeEntry[]>;
  releaseTreePermission(treeUri: string): Promise<void>;

  downloadFile(
    url: string,
    destPath: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<void>;
};

export default requireNativeModule<NativeFileModule>('NativeFile');
