export type GoogleDriveConfig = {
  apiKey: string;
  appId: string;
  clientId: string;
};

export type DrivePickerItem = {
  id: string;
  mimeType: string;
  name: string;
};

type PickerResult = {
  accessToken: string;
  items: DrivePickerItem[];
};

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    gapi?: {
      load: (name: string, callback: () => void) => void;
    };
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            callback: (response: { access_token?: string; error?: string }) => void;
            client_id: string;
            scope: string;
          }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
      picker: Record<string, any>;
    };
  }
}

let apiScript: Promise<void> | null = null;
let identityScript: Promise<void> | null = null;
let pickerLibrary: Promise<void> | null = null;

function loadScript(src: string) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Google Drive. Check your network connection.'));
    document.head.append(script);
  });
}

async function ensureGooglePicker() {
  apiScript ??= loadScript(GOOGLE_API_SCRIPT);
  identityScript ??= loadScript(GOOGLE_IDENTITY_SCRIPT);
  await Promise.all([apiScript, identityScript]);
  if (!window.gapi || !window.google?.accounts?.oauth2) {
    throw new Error('Google Drive did not finish loading. Please try again.');
  }
  pickerLibrary ??= new Promise<void>((resolve) => window.gapi?.load('picker', resolve));
  await pickerLibrary;
  if (!window.google.picker) throw new Error('Google Drive Picker is unavailable. Please try again.');
}

function requestAccessToken(clientId: string) {
  return new Promise<string>((resolve, reject) => {
    const client = window.google?.accounts.oauth2.initTokenClient({
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error('Google Drive permission was not granted.'));
          return;
        }
        resolve(response.access_token);
      },
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
    });
    if (!client) {
      reject(new Error('Google Drive sign-in is unavailable. Please try again.'));
      return;
    }
    client.requestAccessToken({ prompt: 'consent' });
  });
}

export const googleDriveConfig: GoogleDriveConfig = {
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? '',
  appId: import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? '',
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '',
};

export const isGoogleDriveConfigured = Boolean(
  googleDriveConfig.apiKey && googleDriveConfig.appId && googleDriveConfig.clientId,
);

export async function requestGoogleDriveAccess(config: GoogleDriveConfig) {
  await ensureGooglePicker();
  return requestAccessToken(config.clientId);
}

export async function pickGoogleDriveItems(config: GoogleDriveConfig): Promise<PickerResult | null> {
  await ensureGooglePicker();
  const accessToken = await requestAccessToken(config.clientId);
  const picker = window.google?.picker;
  if (!picker) throw new Error('Google Drive Picker is unavailable. Please try again.');

  return new Promise<PickerResult | null>((resolve) => {
    const pdfView = new picker.DocsView(picker.ViewId.PDFS)
      .setMode(picker.DocsViewMode.LIST);
    const folderView = new picker.DocsView(picker.ViewId.FOLDERS)
      .setMode(picker.DocsViewMode.LIST)
      .setSelectFolderEnabled(true);
    const dialog = new picker.PickerBuilder()
      .addView(pdfView)
      .addView(folderView)
      .setAppId(config.appId)
      .setDeveloperKey(config.apiKey)
      .setOAuthToken(accessToken)
      .setCallback((data: Record<string, any>) => {
        if (data[picker.Response.ACTION] === picker.Action.CANCEL) resolve(null);
        if (data[picker.Response.ACTION] !== picker.Action.PICKED) return;
        const items = (data[picker.Response.DOCUMENTS] as Array<Record<string, any>>).map((item) => ({
          id: item[picker.Document.ID],
          mimeType: item[picker.Document.MIME_TYPE],
          name: item[picker.Document.NAME],
        }));
        resolve({ accessToken, items });
      })
      .build();
    dialog.setVisible(true);
  });
}

async function driveFetch(path: string, accessToken: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive could not open this selection (${response.status}). ${detail}`);
  }
  return response;
}

export async function listFolderPdfs(folderId: string, accessToken: string): Promise<DrivePickerItem[]> {
  const query = `'${folderId.replace(/'/g, "\\'")}' in parents and mimeType='application/pdf' and trashed=false`;
  const response = await driveFetch(
    `files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,mimeType)')}&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    accessToken,
  );
  const result = await response.json() as { files?: DrivePickerItem[] };
  return result.files ?? [];
}

export async function downloadGoogleDrivePdf(fileId: string, accessToken: string) {
  const response = await driveFetch(`files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
  return new Uint8Array(await response.arrayBuffer());
}

export function isDriveFolder(item: DrivePickerItem) {
  return item.mimeType === FOLDER_MIME_TYPE;
}
