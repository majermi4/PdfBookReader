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

type TokenResponse = {
  access_token?: string;
  error?: string;
  expires_in?: number;
};

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_SCOPES = [DRIVE_FILE_SCOPE, DRIVE_APPDATA_SCOPE].join(' ');
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
let activeAccessToken: { value: string; expiresAt: number } | null = null;

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
  if (activeAccessToken && activeAccessToken.expiresAt > Date.now() + 30_000) {
    return Promise.resolve(activeAccessToken.value);
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Google Drive sign-in was not completed. Please try again.'));
      }
    }, 60_000);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const client = window.google?.accounts.oauth2.initTokenClient({
      callback: (response: TokenResponse) => {
        const token = response.access_token;
        if (response.error || !token) {
          finish(() => reject(new Error('Google Drive permission was not granted.')));
          return;
        }
        const expiresInSeconds = response.expires_in ?? 3_000;
        activeAccessToken = {
          value: token,
          expiresAt: Date.now() + expiresInSeconds * 1_000,
        };
        finish(() => resolve(token));
      },
      client_id: clientId,
      scope: DRIVE_SCOPES,
    });
    if (!client) {
      finish(() => reject(new Error('Google Drive sign-in is unavailable. Please try again.')));
      return;
    }
    // An empty prompt reuses an existing Google grant where possible. The
    // consent screen is still shown when the user has not granted access yet.
    client.requestAccessToken({ prompt: '' });
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

export type DriveAppDataFile<T> = {
  data: T | null;
  eTag: string | null;
  fileId: string | null;
};

export class DriveAppDataConflictError extends Error {
  constructor() {
    super('Reading state changed on another device. Retrying the sync.');
    this.name = 'DriveAppDataConflictError';
  }
}

function createMultipartBoundary() {
  return `quiet-reader-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export async function readDriveAppDataJson<T>(
  name: string,
  accessToken: string,
): Promise<DriveAppDataFile<T>> {
  const query = `name='${name.replace(/'/g, "\\'")}'`;
  const listing = await driveFetch(
    `files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name)')}&pageSize=1`,
    accessToken,
  );
  const result = await listing.json() as { files?: Array<{ id?: string }> };
  const fileId = result.files?.[0]?.id;
  if (!fileId) return { data: null, eTag: null, fileId: null };

  const content = await driveFetch(`files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
  let data: T;
  try {
    data = await content.json() as T;
  } catch {
    throw new Error('The saved Quiet Reader sync data is not valid JSON.');
  }
  return { data, eTag: content.headers.get('etag'), fileId };
}

export async function writeDriveAppDataJson<T>(
  name: string,
  data: T,
  accessToken: string,
  existing?: Pick<DriveAppDataFile<unknown>, 'eTag' | 'fileId'>,
): Promise<Pick<DriveAppDataFile<T>, 'eTag' | 'fileId'>> {
  const boundary = createMultipartBoundary();
  const metadata = JSON.stringify({
    mimeType: 'application/json',
    name,
    parents: existing?.fileId ? undefined : ['appDataFolder'],
  });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(data),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const path = existing?.fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.fileId)}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const response = await fetch(path, {
    method: existing?.fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      ...(existing?.eTag ? { 'If-Match': existing.eTag } : {}),
    },
    body,
  });
  if (response.status === 412) throw new DriveAppDataConflictError();
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive could not save reading state (${response.status}). ${detail}`);
  }
  const saved = await response.json() as { id?: string };
  if (!saved.id) throw new Error('Google Drive did not return an ID for the saved reading state.');
  return { eTag: response.headers.get('etag'), fileId: saved.id };
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

export async function downloadGoogleDrivePdf(
  fileId: string,
  accessToken: string,
  onProgress?: (percent: number | null) => void,
) {
  const response = await driveFetch(`files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
  const totalBytes = Number(response.headers.get('content-length'));
  if (!response.body || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    onProgress?.(null);
    const data = new Uint8Array(await response.arrayBuffer());
    onProgress?.(100);
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  onProgress?.(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.length;
    onProgress?.(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
  }

  const data = new Uint8Array(receivedBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    data.set(chunk, offset);
    offset += chunk.length;
  });
  onProgress?.(100);
  return data;
}

export function isDriveFolder(item: DrivePickerItem) {
  return item.mimeType === FOLDER_MIME_TYPE;
}
