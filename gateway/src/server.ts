import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

import {
  generateFromPrompt,
  generateFromPromptAndReferenceImage,
  toOperatorFailure,
} from "./openai.js";

dotenv.config({ path: new URL("../../.env", import.meta.url) });

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Reference image must be PNG, JPEG, or WebP."));
      return;
    }

    callback(null, true);
  },
});

const allowedOrigins = new Set(["localhost", "127.0.0.1"]);
const sizePattern = /^\d+x\d+$/i;
const allowedQualities = new Set(["auto", "low", "medium", "high"]);
const allowedOutputFormats = new Set(["png", "jpeg", "webp"]);

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

  return maxEdge <= 3840 && minEdge > 0 && maxEdge / minEdge <= 3 && totalPixels >= 655_360 && totalPixels <= 8_294_400;
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

app.post("/generate", upload.single("referenceImage"), async (request, response) => {
  try {
    const prompt = String(request.body.prompt || "").trim();
    const size = String(request.body.size || "1024x1024").trim();
    const quality = String(request.body.quality || "high");
    const outputFormat = String(request.body.output_format || "png");

    console.log("[DEBUG-gateway] request", {
      promptLength: prompt.length,
      hasReferenceImage: Boolean(request.file),
      referenceMime: request.file?.mimetype,
      referenceSize: request.file?.size,
      size,
      quality,
      outputFormat,
    });

    if (!prompt) {
      response.status(400).json({ error: "Prompt is required." });
      return;
    }

    if (!isSupportedSize(size) || !allowedQualities.has(quality) || !allowedOutputFormats.has(outputFormat)) {
      response.status(400).json({ error: "Unsupported image generation settings." });
      return;
    }

    const imageDataUrl = request.file
      ? await generateFromPromptAndReferenceImage(prompt, { size, quality, outputFormat }, request.file)
      : await generateFromPrompt(prompt, { size, quality, outputFormat });

    response.json({ imageDataUrl });
  } catch (error) {
    const failure = toOperatorFailure(error);
    response.status(failure.status).json({
      error: failure.error,
      technicalDetails: failure.technicalDetails,
    });
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof Error && error.message === "Reference image must be PNG, JPEG, or WebP.") {
    response.status(400).json({
      error: error.message,
      technicalDetails: "Upload a local PNG, JPEG, or WebP reference image.",
    });
    return;
  }

  response.status(500).json({
    error: "Image generation failed.",
    technicalDetails: error instanceof Error ? error.message : undefined,
  });
});

app.listen(3001, "127.0.0.1", () => {
  console.log("Provider gateway listening on http://127.0.0.1:3001");
});
