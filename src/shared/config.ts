/**
 * DR·QUIRO Reportes — central configuration.
 *
 * Everything that is likely to be tuned (template ids, Canva geometry, photo
 * layout margins, limits) lives here. Colours live in `theme.ts` and every
 * Spanish UI string lives in `strings.ts`.
 */

export type ReportType = 'inicial' | 'comparativo';

export const CANVA = {
  /** Canva MCP server (Streamable HTTP). */
  mcpUrl: 'https://mcp.canva.com/mcp',
  /** Template designs that are COPIED for every report. Never edited directly. */
  templates: {
    inicial: 'DAHZcKDyN90',
    comparativo: 'DAHZcAKxsQg',
  } satisfies Record<ReportType, string>,
  /**
   * Designs the app must never copy, open in a transaction or edit.
   * The template originals are included: the app only ever *copies* them.
   */
  protectedDesignIds: ['DAHWWjbFWBs', 'DAHZcKDyN90', 'DAHZcAKxsQg'],
  /** Scopes requested during OAuth (what the server advertises). */
  scopes: [
    'design:content:read',
    'design:content:write',
    'design:meta:read',
    'asset:read',
    'asset:write',
    'profile:read',
    'folder:read',
    'folder:write',
  ],
  /** OAuth client name shown on Canva's consent screen. */
  clientName: 'DR·QUIRO Reportes',
  /** Loopback callback path (port is chosen at first registration). */
  callbackPath: '/callback',
  /** How long we wait for the user to finish sign-in in the browser. */
  loginTimeoutMs: 5 * 60_000,
  /** Parallel photo uploads. */
  uploadConcurrency: 4,
  /** Retries for uploads / tool calls that fail with transient errors. */
  maxRetries: 3,
  /** Title pattern. Tokens: {TIPO} {Nombre} {Apellido} {Fecha} */
  titlePattern: 'REPORTE {TIPO} {Nombre} {Apellido} - {Fecha} - A5',
  titleTypeWord: { inicial: 'INICIAL', comparativo: 'COMPARATIVO' } satisfies Record<ReportType, string>,
} as const;

/** Geometry of the templates (Canva editing coordinates, px). */
export const TEMPLATE = {
  pageCount: 11,
  pageSize: { width: 559, height: 794 },
  coverPage: 1,
  /** Pages with photo slots (inclusive, 1-based). */
  photoPages: { first: 4, last: 10 },
  rowsPerPage: 3,
  /** Size of an (empty) photo-slot richtext. */
  slotSize: { width: 206.27854436468644, height: 167.81102362204726 },
  /** Size tolerance (px) when recognising slots. */
  slotTolerance: 2,
  injuryPage: 11,
  /** Placeholder texts that are replaced on the cover. */
  placeholders: {
    name: 'NOMBRE',
    dateInicial: 'Mes DD, AAAA',
    dateComparativo: 'Mes DD, AAAA - Mes DD, AAAA',
    /** Page 11 injury lines, matched by this regex and ordered by top. Absent on Comparativo. */
    injury: /aqu[ií]\s*$/i,
  },
} as const;

/** Photo limits / accepted inputs. */
export const PHOTOS = {
  maxPerTab: 21,
  minPerTab: 1,
  /** Max file size we accept on import (bytes). */
  maxFileBytes: 60 * 1024 * 1024,
  /** Inputs are downscaled to this long side before processing. */
  workingMaxSide: 1800,
  thumbnailSize: 360,
} as const;

/**
 * Photo layout inside a slot — the most important visual rule.
 * All fractions are relative to the slot.
 */
export const LAYOUT = {
  /** Output PNG width; height follows the slot aspect ratio. ~4x the slot. */
  outputWidth: 825,
  /** Person height as a fraction of slot height (10 % free above/below). */
  personHeight: 0.8,
  /** Maximum person width as a fraction of slot width. */
  maxPersonWidth: 0.9,
  /** Feet (bottom of the alpha bbox) sit at this fraction of slot height. */
  baseline: 0.9,
  /** Alpha value (0-255) above which a pixel counts as "person" for bbox/blobs. */
  alphaThreshold: 24,
  /** Keep extra blobs whose area is at least this fraction of the largest. */
  keepBlobRatio: 0.12,
  /** Alpha levels: values <= lo become 0, >= hi become 255 (removes halos). */
  alphaLo: 18,
  alphaHi: 232,
  /** Erode the alpha by this many pixels (0 or 1) before feathering. */
  erodePx: 1,
  /** Gaussian feather sigma applied to the alpha edge (0 = off). */
  featherSigma: 0.6,
  /** PNG compression level (0-9). */
  pngCompression: 9,
  /** Uploads above this size are re-encoded with palette quantisation. */
  maxUploadBytes: 2 * 1024 * 1024,
} as const;

/** Background-removal model (rembg "isnet-general-use", Apache-2.0). */
export const MODEL = {
  fileName: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  bytes: 178648008,
  inputSize: 1024,
  mean: [0.485, 0.456, 0.406],
  std: [1.0, 1.0, 1.0],
} as const;

export const slotAspect = TEMPLATE.slotSize.width / TEMPLATE.slotSize.height;
export const outputSize = {
  width: LAYOUT.outputWidth,
  height: Math.round(LAYOUT.outputWidth / slotAspect),
};
