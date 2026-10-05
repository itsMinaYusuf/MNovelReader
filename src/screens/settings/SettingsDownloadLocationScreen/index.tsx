import { ScrollView } from 'react-native-gesture-handler';

import { Appbar, List, SafeAreaView } from '@components';
import { useAppSettings, useTheme } from '@hooks/persisted';
import { DownloadLocationSettingsScreenProps } from '@navigators/types';
import { getString } from '@i18n/translations';
import NativeFile from '@modules/native-file';

/**
 * Pre-navigates Android's directory picker to the primary volume's Download
 * folder. The user still has to confirm the choice, so no storage permission is
 * requested up front.
 */
export const DOWNLOADS_TREE_URI =
  'content://com.android.externalstorage.documents/tree/primary%3ADownload';

const DownloadLocationSettings = ({
  navigation,
}: DownloadLocationSettingsScreenProps) => {
  const theme = useTheme();
  const {
    downloadStorageMode = 'app',
    downloadFolderUri,
    downloadFolderName,
    setAppSettings,
  } = useAppSettings();

  const usesFolder = downloadStorageMode === 'folder' && !!downloadFolderUri;

  const selectDirectory = async (initialUri?: string) => {
    let directory: Awaited<ReturnType<typeof NativeFile.pickDirectory>>;
    try {
      directory = await NativeFile.pickDirectory(initialUri);
    } catch {
      // Closing Android's directory picker intentionally keeps the old location.
      return;
    }

    setAppSettings({
      downloadStorageMode: 'folder',
      downloadFolderUri: directory.uri,
      downloadFolderName: directory.name,
    });
  };

  const useAppStorage = () => {
    setAppSettings({
      downloadStorageMode: 'app',
      downloadFolderUri: undefined,
      downloadFolderName: undefined,
    });
  };

  return (
    <SafeAreaView excludeTop>
      <Appbar
        title={getString('downloadLocationScreen.title')}
        handleGoBack={() => navigation.goBack()}
        theme={theme}
      />
      <ScrollView>
        <List.Section>
          <List.SubHeader theme={theme}>
            {getString('downloadLocationScreen.storageLocation')}
          </List.SubHeader>
          <List.Item
            title={getString('downloadLocationScreen.appStorage')}
            description={getString('downloadLocationScreen.appStorageDesc')}
            theme={theme}
            onPress={useAppStorage}
            right={usesFolder ? undefined : 'check'}
          />
          <List.Item
            title={getString('downloadLocationScreen.downloadFolder')}
            description={getString('downloadLocationScreen.downloadFolderDesc')}
            theme={theme}
            onPress={() => selectDirectory(DOWNLOADS_TREE_URI)}
            right={usesFolder && downloadFolderUri === DOWNLOADS_TREE_URI ? 'check' : undefined}
          />
          <List.Item
            title={getString('downloadLocationScreen.customFolder')}
            description={
              usesFolder
                ? (downloadFolderName ??
                  getString('downloadLocationScreen.notSet'))
                : getString('downloadLocationScreen.customFolderDesc')
            }
            theme={theme}
            onPress={() => selectDirectory()}
            right={usesFolder && downloadFolderUri !== DOWNLOADS_TREE_URI ? 'check' : undefined}
          />
          <List.InfoItem
            title={getString('downloadLocationScreen.switchFolderWarning')}
            theme={theme}
          />
        </List.Section>
      </ScrollView>
    </SafeAreaView>
  );
};

export default DownloadLocationSettings;