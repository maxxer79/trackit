import api from './api';

// Downloads a file through the authenticated api instance (so the Bearer token
// is attached — a plain <a href> can't send it) and triggers a browser save,
// honoring the server's Content-Disposition filename when present.
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await api.get(path, { responseType: 'blob' });
  const disposition: string = res.headers['content-disposition'] ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
