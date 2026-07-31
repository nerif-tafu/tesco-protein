/**
 * Tesco product shots are 225x225 with the product floating on white, and the
 * amount of padding varies wildly by pack shape. Measuring the real content box
 * lets us zoom each thumbnail so the product fills its frame.
 */
const BG_THRESHOLD = 243;

export interface ImageFit {
  widthPct: number;
  heightPct: number;
  leftPct: number;
  topPct: number;
}

const cache = new Map<string, ImageFit | null>();
const pending = new Map<string, Promise<ImageFit | null>>();

function readCache(src: string): ImageFit | null | undefined {
  if (cache.has(src)) return cache.get(src);
  try {
    const raw = sessionStorage.getItem(`perkcal:fit:${src}`);
    if (raw) {
      const parsed = JSON.parse(raw) as ImageFit | null;
      cache.set(src, parsed);
      return parsed;
    }
  } catch {
    // sessionStorage unavailable — in-memory cache still applies.
  }
  return undefined;
}

function writeCache(src: string, fit: ImageFit | null) {
  cache.set(src, fit);
  try {
    sessionStorage.setItem(`perkcal:fit:${src}`, JSON.stringify(fit));
  } catch {
    // ignore quota errors
  }
}

function contentBox(img: HTMLImageElement): ImageFit | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, w, h).data;
  const isBg = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 12) return true;
    return (
      data[i] > BG_THRESHOLD &&
      data[i + 1] > BG_THRESHOLD &&
      data[i + 2] > BG_THRESHOLD
    );
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  scanTop: for (; top < h; top++) {
    for (let x = 0; x < w; x++) if (!isBg(x, top)) break scanTop;
  }
  if (top >= h) return null;

  scanBottom: for (; bottom > top; bottom--) {
    for (let x = 0; x < w; x++) if (!isBg(x, bottom)) break scanBottom;
  }
  scanLeft: for (; left < w; left++) {
    for (let y = top; y <= bottom; y++) if (!isBg(left, y)) break scanLeft;
  }
  scanRight: for (; right > left; right--) {
    for (let y = top; y <= bottom; y++) if (!isBg(right, y)) break scanRight;
  }

  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  if (boxW < 8 || boxH < 8) return null;

  // Scale so the product's longest side spans the frame, then centre the rest.
  const longest = Math.max(boxW, boxH);
  return {
    widthPct: (w / longest) * 100,
    heightPct: (h / longest) * 100,
    leftPct: (100 - (boxW / longest) * 100) / 2 - (left / longest) * 100,
    topPct: (100 - (boxH / longest) * 100) / 2 - (top / longest) * 100,
  };
}

export function measureImageFit(src: string): Promise<ImageFit | null> {
  const cached = readCache(src);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = pending.get(src);
  if (existing) return existing;

  const task = (async () => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      await img.decode();
      const fit = contentBox(img);
      writeCache(src, fit);
      return fit;
    } catch {
      // Blocked by CORS or a decode failure — fall back to plain contain.
      writeCache(src, null);
      return null;
    } finally {
      pending.delete(src);
    }
  })();

  pending.set(src, task);
  return task;
}

export function cachedImageFit(src: string): ImageFit | null | undefined {
  return readCache(src);
}
