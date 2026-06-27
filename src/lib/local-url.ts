let _port: number | null = null;

function getPort(): number {
  if (_port === null) {
    _port = window.conchitour.getFileServerPort();
  }
  return _port;
}

export function toLocalUrl(filePath: string): string {
  const encoded = filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  return `http://127.0.0.1:${getPort()}/${encoded}`;
}
