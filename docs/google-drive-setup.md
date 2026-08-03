# Google Drive setup

Quiet Reader uses the Google Picker and the narrow `drive.file` OAuth scope. A person explicitly chooses a PDF or folder; the app does not request access to their entire Drive.

## 1. Create or select a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Use the project picker in the top bar to create a project, such as `Quiet Reader`.

## 2. Enable the APIs

In **APIs & Services > Library**, enable both:

- **Google Drive API**
- **Google Picker API**

## 3. Configure OAuth consent

1. Open **APIs & Services > OAuth consent screen**.
2. Select **External** if you will use a personal Google account outside an organisation.
3. Enter `Quiet Reader` as the app name and your own email address for support and developer contact.
4. While the app is in testing, add the Google accounts that should be allowed to test it under **Test users**.
5. Do not request extra scopes. Quiet Reader asks only for `https://www.googleapis.com/auth/drive.file` when the user presses **Add from Google Drive**.

## 4. Create a browser OAuth client ID

1. Go to **APIs & Services > Credentials > Create credentials > OAuth client ID**.
2. Choose **Web application**.
3. Add these **Authorised JavaScript origins**:
   - `https://majermi4.github.io`
   - `http://127.0.0.1:5173`
   - `http://localhost:5173`
4. Save and copy the **Client ID**. A redirect URI is not needed for the popup token flow used here.

## 5. Create and restrict an API key

1. In **Credentials**, choose **Create credentials > API key**.
2. Open the new key and set **Application restrictions** to **Websites**.
3. Add these referrers:
   - `https://majermi4.github.io/*`
   - `http://127.0.0.1:5173/*`
   - `http://localhost:5173/*`
4. Under **API restrictions**, restrict it to the **Google Picker API**.
5. Save and copy the API key.

The browser OAuth client ID and this restricted browser API key are intentionally public configuration, not server secrets.

## 6. Copy the project number

1. Go to **IAM & Admin > Settings**.
2. Copy the numeric **Project number**. This is the Google Picker App ID, not the project name or project ID.

## 7. Configure Quiet Reader

For local development, copy `.env.example` to `.env.local` and fill in:

```dotenv
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-restricted-browser-api-key
VITE_GOOGLE_APP_ID=your-numeric-project-number
```

Restart `npm run dev` after changing the file.

For GitHub Pages, open the GitHub repository, then **Settings > Secrets and variables > Actions > Variables**. Create these repository variables with the same values:

- `VITE_GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_API_KEY`
- `VITE_GOOGLE_APP_ID`

Then rerun the **Deploy to GitHub Pages** workflow from the repository’s **Actions** tab. The build injects these browser-visible values; they are never stored in the Git repository.

## 8. Test it

1. Open the deployed app.
2. Choose **Add from Google Drive**.
3. Complete Google’s account and consent dialog.
4. Choose a PDF, or choose a folder to add the PDFs it contains.

The selected books are remembered in that browser’s local library. Their reading position, manual bookmark, and notes remain local in this phase; cross-device sync is the next phase.
