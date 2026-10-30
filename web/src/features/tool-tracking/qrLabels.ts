import apiClient from '../../api/client';

/** One printed label: the code the scanner reads, and what a person reads. */
export type QrLabelItem = {
  key: string;
  code: string;
  name: string;
  detail?: string | null;
};

export type LabelSizeId = 'small' | 'medium' | 'large';

/** A4 label sheets (mm), matching the common 40-, 21- and 8-label sheets
 * (with margins, so printers do not cut off the edges). Plain A4 paper works
 * for all three. */
export type LabelSize = {
  id: LabelSizeId;
  label: string;
  hint: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  top: number;
  left: number;
  colGap: number;
  rowGap: number;
};

export const LABEL_SIZES: Record<LabelSizeId, LabelSize> = {
  small: {
    id: 'small',
    label: 'Small',
    hint: '45.7 × 25.4 mm · 40 per A4 sheet',
    cols: 4,
    rows: 10,
    width: 45.7,
    height: 25.4,
    top: 21.5,
    left: 9.85,
    colGap: 2.5,
    rowGap: 0,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    hint: '63.5 × 38.1 mm · 21 per A4 sheet',
    cols: 3,
    rows: 7,
    width: 63.5,
    height: 38.1,
    top: 15.15,
    left: 7.2,
    colGap: 2.5,
    rowGap: 0,
  },
  large: {
    id: 'large',
    label: 'Large',
    hint: '99.1 × 67.7 mm · 8 per A4 sheet',
    cols: 2,
    rows: 4,
    width: 99.1,
    height: 67.7,
    top: 13.1,
    left: 4.65,
    colGap: 2.5,
    rowGap: 0,
  },
};

export const perSheet = (size: LabelSize) => size.cols * size.rows;

/**
 * Labels laid out on sheets. Each item is repeated ``copies`` times; the
 * first ``startAt - 1`` places on the first sheet stay empty (null) so a
 * partly used label sheet can be fed again.
 */
export function layoutSheets<T>(
  items: T[],
  size: LabelSize,
  copies = 1,
  startAt = 1
): (T | null)[][] {
  const per = perSheet(size);
  const skip = Math.min(Math.max(Math.floor(startAt) - 1, 0), per - 1);
  const n = Math.max(1, Math.floor(copies));
  const cells: (T | null)[] = Array.from({ length: skip }, () => null);
  for (const item of items) for (let i = 0; i < n; i += 1) cells.push(item);
  if (cells.length === skip) return [];
  const sheets: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += per) sheets.push(cells.slice(i, i + per));
  return sheets;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Save one QR as a PNG with its code and name under it (for sending to a
 * print shop or printing at any size). ``qrPath`` is the API path of the QR image.
 */
export async function downloadQrPng(qrPath: string, item: Pick<QrLabelItem, 'code' | 'name' | 'detail'>) {
  const { data } = await apiClient.get<Blob>(qrPath, { responseType: 'blob' });
  const src = URL.createObjectURL(data);
  try {
    const img = await loadImage(src);
    const qr = 600;
    const pad = 40;
    const textArea = item.detail ? 170 : 130;
    const canvas = document.createElement('canvas');
    canvas.width = qr + pad * 2;
    canvas.height = qr + pad * 2 + textArea;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, pad, pad, qr, qr);
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    const maxW = canvas.width - pad * 2;
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.fillText(fitText(ctx, item.code, maxW), canvas.width / 2, qr + pad + 60);
    ctx.font = '34px Arial, sans-serif';
    ctx.fillText(fitText(ctx, item.name, maxW), canvas.width / 2, qr + pad + 108);
    if (item.detail) {
      ctx.fillStyle = '#475569';
      ctx.font = '28px Arial, sans-serif';
      ctx.fillText(fitText(ctx, item.detail, maxW), canvas.width / 2, qr + pad + 150);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not make the image');
    downloadBlob(blob, `QR-${item.code.replace(/[^\w.-]+/g, '_')}.png`);
  } finally {
    URL.revokeObjectURL(src);
  }
}
