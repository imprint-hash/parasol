// Resizes a chosen photo and re-encodes it as JPEG in the browser.
// Re-encoding through a canvas drops EXIF data, including GPS location.

const LONG_SIDE = 1280;
const MIN_SHORT_SIDE = 480;
const TARGET_BYTES = 400 * 1024;

export class PhotoError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoError("That file doesn't look like a photo. Try a JPEG or PNG.", "bad_image"));
    };
    img.src = url;
  });
}

/** File → { dataUrl, width, height, bytes, previewUrl } */
export async function preparePhoto(file) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new PhotoError("Please choose a photo.", "bad_image");
  const { img, url } = await loadImage(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (Math.min(w0, h0) < MIN_SHORT_SIDE) {
    URL.revokeObjectURL(url);
    throw new PhotoError(`This photo is too small (${w0}×${h0}). Use one at least ${MIN_SHORT_SIDE} pixels on the short side.`, "too_small");
  }
  const scale = Math.min(1, LONG_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  let q = 0.88;
  let dataUrl = canvas.toDataURL("image/jpeg", q);
  while (dataUrl.length * 0.75 > TARGET_BYTES && q > 0.55) {
    q -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }
  return { dataUrl, width: w, height: h, bytes: Math.round(dataUrl.length * 0.75), previewUrl: dataUrl };
}
