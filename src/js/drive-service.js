// Focus Fox Google Drive Service
import { store } from './store.js';

export const driveService = {
  async fetchFolderContents(folderId) {
    const apiKey = store.env.DRIVE_API_KEY;
    if (!apiKey) {
      throw new Error("Google Drive API key is not configured.");
    }

    // Clean folderId if it's a URL
    let cleanId = folderId;
    if (folderId.includes('drive.google.com')) {
      const match = folderId.match(/\/folders\/([a-zA-Z0-9-_]+)/) || folderId.match(/id=([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        cleanId = match[1];
      }
    }

    const url = `https://www.googleapis.com/drive/v3/files?q='${cleanId}'+in+parents+and+trashed=false&key=${apiKey}&fields=files(id,name,mimeType,webViewLink)`;

    console.log(`Fetching Google Drive folder: ${cleanId}`);

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Drive API Error details:", errorText);
      throw new Error(`Google Drive API returned code ${response.status}`);
    }

    const data = await response.json();
    return data.files || [];
  }
};
