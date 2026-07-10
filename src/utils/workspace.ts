import { getAccessToken } from './firebase';

export async function fetchDriveFiles(searchQuery?: string) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  // Fetch recent files from Google Drive (e.g., PDFs, Docs, TXT)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${searchQuery ? encodeURIComponent("name contains '" + searchQuery + "'") : encodeURIComponent('mimeType="application/pdf" or mimeType="text/plain" or mimeType="application/vnd.google-apps.document"')}&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,mimeType,size,modifiedTime)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.files || [];
}

export async function fetchDriveFileContent(fileId: string, mimeType: string) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  // If it's a Google Doc, we need to export it instead of downloading media directly
  if (mimeType === 'application/vnd.google-apps.document') {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to download file');
  }

  if (mimeType === 'application/pdf') {
    const blob = await res.blob();
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        resolve(base64data);
      };
      reader.readAsDataURL(blob);
    });
  } else {
    // For text files and exported google docs
    const text = await res.text();
    return text;
  }
}

export async function fetchRecentEmails(searchQuery?: string) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  // Fetch recent 10 messages
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10${searchQuery ? '&q=' + encodeURIComponent(searchQuery) : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  if (listData.error) throw new Error(listData.error.message);

  const messages = listData.messages || [];
  
  const emails = [];
  for (const msg of messages) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    
    // Extract Subject and Body
    let subject = 'No Subject';
    const headers = data.payload?.headers || [];
    for (const h of headers) {
      if (h.name === 'Subject') subject = h.value;
    }

    let body = '';
    if (data.snippet) {
        body = data.snippet;
    }

    emails.push({
      id: msg.id,
      subject,
      snippet: body,
      timestamp: data.internalDate
    });
  }

  return emails;
}
