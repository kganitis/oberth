import QRCode from 'qrcode';

export const qrSvg = (url: string): Promise<string> => QRCode.toString(url, { type: 'svg', margin: 1, width: 180 });
