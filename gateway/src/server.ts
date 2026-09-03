import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

import {
  editImages,
  generateFromPrompt,
  generateFromPromptAndReferenceImage,
  generateImage,
  reviewImages,
  toOperatorFailure,
  type ImageFile,
  type ImageOptions,
} from "./openai.js";

dotenv.config({ path: new URL("../../.env", import.meta.url), quiet: true });

const DEFAULT_GATEWAY_PORT = 3001;
const DEFAULT_MAX_REFERENCE_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedOrigins = new Set(["localhost", "127.0.0.1"]);
const sizePattern = /^\d+x\d+$/i;
const allowedQualities = new Set(["auto", "low", "medium", "high"]);
const allowedOutputFormats = new Set(["png", "jpeg", "webp"]);

function parsePort(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

const gatewayPort = parsePort(process.env.GATEWAY_PORT, DEFAULT_GATEWAY_PORT, "GATEWAY_PORT");
const maxReferenceImages = parsePositiveInteger(
  process.env.MAX_REFERENCE_IMAGES,
  DEFAULT_MAX_REFERENCE_IMAGES,
  "MAX_REFERENCE_IMAGES",
);

const app = express();

function createBadRequest(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: maxReferenceImages * 2 + 2,
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Reference image must be PNG, JPEG, or WebP."));
      return;
    }

    callback(null, true);
  },
});

const uploadImageFields = imageUpload.fields([
  { name: "image[]", maxCount: maxReferenceImages },
  { name: "image", maxCount: maxReferenceImages },
  { name: "referenceImage", maxCount: 1 },
  { name: "mask", maxCount: 1 },
]);

function isSupportedSize(size: string) {
  if (size.toLowerCase() === "auto") {
    return true;
  }

  if (!sizePattern.test(size)) {
    return false;
  }

  const [widthText, heightText] = size.toLowerCase().split("x");
  const width = Number(widthText);
  const height = Number(heightText);

  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return false;
  }

  if (width % 16 !== 0 || height % 16 !== 0) {
    return false;
  }

  const maxEdge = Math.max(width, height);
  const minEdge = Math.min(width, height);
  const totalPixels = width * height;

  return (
    maxEdge <= 3840 &&
    minEdge > 0 &&
    maxEdge / minEdge <= 3 &&
    totalPixels >= 655_360 &&
    totalPixels <= 8_294_400
  );
}

function getFieldFiles(request: express.Request, fieldName: string): Express.Multer.File[] {
  const files = request.files;

  if (Array.isArray(files)) {
    return files;
  }

  return files?.[fieldName] || [];
}

function getReferenceFiles(request: express.Request) {
  return [
    ...getFieldFiles(request, "image[]"),
    ...getFieldFiles(request, "image"),
    ...getFieldFiles(request, "referenceImage"),
  ];
}

function getMaskFile(request: express.Request) {
  return getFieldFiles(request, "mask")[0];
}

function toImageFile(file: Express.Multer.File): ImageFile {
  return {
    buffer: file.buffer,
    mimetype: file.mimetype,
    originalname: file.originalname,
  };
}

function pngHasAlphaChannel(buffer: Buffer) {
  // PNG signature (8) + IHDR length/type (8), then IHDR color type at byte 25.
  return (
    buffer.length >= 26 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    (buffer[25] === 4 || buffer[25] === 6)
  );
}

function getImageOptions(body: Record<string, unknown>): ImageOptions {
  const size = String(body.size || "1024x1024").trim();
  const quality = String(body.quality || "high").trim().toLowerCase();
  const outputFormat = String(body.output_format || "png").trim().toLowerCase();

  if (!isSupportedSize(size) || !allowedQualities.has(quality) || !allowedOutputFormats.has(outputFormat)) {
    throw createBadRequest("Unsupported image generation settings.");
  }

  return {
    size,
    quality,
    outputFormat,
  };
}

function getPrompt(body: Record<string, unknown>) {
  return String(body.prompt || "").trim();
}

function sendRouteFailure(response: express.Response, error: unknown, fallback = "Image generation failed.") {
  const failure = toOperatorFailure(error);
  response.status(failure.status).json({
    error: failure.error || fallback,
    technicalDetails: failure.technicalDetails,
  });
}

function validateReferenceFiles(files: Express.Multer.File[], required: boolean) {
  if (required && files.length === 0) {
    throw createBadRequest("At least one reference image is required.");
  }

  if (files.length > maxReferenceImages) {
    throw createBadRequest(`A maximum of ${maxReferenceImages} reference images is supported.`);
  }
}

function validateMask(mask: Express.Multer.File | undefined) {
  if (!mask) {
    return;
  }

  if (mask.mimetype !== "image/png") {
    throw createBadRequest("Mask must be a PNG image.");
  }

  if (!pngHasAlphaChannel(mask.buffer)) {
    throw createBadRequest("Mask PNG must contain an alpha channel.");
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      try {
        const { hostname } = new URL(origin);
        callback(null, allowedOrigins.has(hostname));
      } catch {
        callback(null, false);
      }
    },
  }),
);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    gatewayPort,
    providerConfigured: Boolean(process.env.XAI_API_KEY || process.env.API_KEY),
    textModel: process.env.TEXT_MODEL || "gpt-5.5",
    imageModel: process.env.IMAGE_MODEL || "gpt-image-2",
    maxReferenceImages,
  });
});

app.post("/api/images/generate", async (request, response) => {
  try {
    const body = request.body as Record<string, unknown>;
    const prompt = getPrompt(body);

    if (!prompt) {
      response.status(400).json({ error: "Prompt is required." });
      return;
    }

    const result = await generateImage(prompt, getImageOptions(body));
    response.json(result);
  } catch (error) {
    sendRouteFailure(response, error);
  }
});

app.post("/api/images/edit", uploadImageFields, async (request, response) => {
  try {
    const body = request.body as Record<string, unknown>;
    const prompt = getPrompt(body);
    const referenceFiles = getReferenceFiles(request);
    const mask = getMaskFile(request);

    if (!prompt) {
      response.status(400).json({ error: "Prompt is required." });
      return;
    }

    validateReferenceFiles(referenceFiles, true);
    validateMask(mask);

    const result = await editImages(
      prompt,
      getImageOptions(body),
      referenceFiles.map(toImageFile),
      mask ? toImageFile(mask) : undefined,
    );
    response.json(result);
  } catch (error) {
    sendRouteFailure(response, error);
  }
});

app.post("/api/images/review", uploadImageFields, async (request, response) => {
  try {
    const referenceFiles = getReferenceFiles(request);
    validateReferenceFiles(referenceFiles, true);

    const reviewFocus = String(request.body.review_focus || "").trim() || undefined;
    const result = await reviewImages(reviewFocus, referenceFiles.map(toImageFile));
    response.json(result);
  } catch (error) {
    sendRouteFailure(response, error, "Image review failed.");
  }
});

// Existing browser UI compatibility endpoint.
app.post("/generate", uploadImageFields, async (request, response) => {
  try {
    const prompt = getPrompt(request.body as Record<string, unknown>);
    const options = getImageOptions(request.body as Record<string, unknown>);
    const referenceFiles = getReferenceFiles(request);

    console.log("[DEBUG-gateway] compatibilityRequest", {
      promptLength: prompt.length,
      referenceCount: referenceFiles.length,
      size: options.size,
      quality: options.quality,
      outputFormat: options.outputFormat,
    });

    if (!prompt) {
      response.status(400).json({ error: "Prompt is required." });
      return;
    }

    validateReferenceFiles(referenceFiles, false);

    const imageDataUrl = referenceFiles.length === 0
      ? await generateFromPrompt(prompt, options)
      : referenceFiles.length === 1
        ? await generateFromPromptAndReferenceImage(prompt, options, toImageFile(referenceFiles[0]))
        : (await editImages(prompt, options, referenceFiles.map(toImageFile))).imageDataUrl;

    response.json({ imageDataUrl });
  } catch (error) {
    sendRouteFailure(response, error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Each image must be 10MB or smaller."
      : error.code === "LIMIT_FILE_COUNT"
        ? `A maximum of ${maxReferenceImages} reference images is supported.`
        : error.message;

    response.status(400).json({
      error: message,
      technicalDetails: error.code,
    });
    return;
  }

  if (error instanceof Error && error.message === "Reference image must be PNG, JPEG, or WebP.") {
    response.status(400).json({
      error: error.message,
      technicalDetails: "Upload a local PNG, JPEG, or WebP reference image.",
    });
    return;
  }

  response.status(400).json({
    error: error instanceof Error ? error.message : "Image generation failed.",
  });
});

app.listen(gatewayPort, "127.0.0.1", () => {
  console.log(`Provider gateway listening on http://127.0.0.1:${gatewayPort}`);
});
