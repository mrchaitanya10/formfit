// Limits chosen to stay within typical phone and laptop browser memory.
// A decoded image needs about 4 bytes per pixel; PDFs are held in memory several times while processing.
export const LIMITS = {
  /** Largest image file accepted by any tool. */
  imageBytes: 25_000_000,
  /** Largest decoded image (width × height). */
  imagePixels: 50_000_000,
  /** Largest side of an exported photo or signature. */
  outputSide: 6000,
  /** Smallest side of an exported photo or signature. */
  outputSideMin: 16,
  /** Largest PDF accepted by any PDF tool. */
  pdfBytes: 100_000_000,
  /** Most pages the image-based compressor will process. */
  compressPages: 150,
  /** Most pages handled by merge and extract (total across files). */
  pdfPages: 1000,
  /** Most PDFs merged at once. */
  mergeFiles: 20,
  /** Most images combined into one PDF. */
  imagesPerPdf: 60,
  /** Images larger than this on their long edge are scaled down when placed in a PDF. */
  pdfImageLongEdge: 4000,
  /** Largest canvas used to render one PDF page. */
  canvasPixels: 16_000_000,
  /** Largest total size of the application kit. */
  kitBytes: 300_000_000,
  /** Largest size target the inputs accept, in KB. */
  maxTargetKb: 100_000,
} as const;
