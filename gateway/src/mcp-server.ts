import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });

const DEFAULT_GATEWAY_PORT = 3001;
const DEFAULT_MAX_INPUT_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const gatewayUrl = (process.env.MCP_GATEWAY_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || DEFAULT_GATEWAY_PORT}`).replace(/\/$/, "");
const maxInputImages = parsePositiveInteger(process.env.MAX_REFERENCE_IMAGES, DEFAULT_MAX_INPUT_IMAGES);
const outputDirectory = resolveOutputDirectory(process.env.IMAGE_OUTPUT_DIR);

type LocalImage = {
  buffer: Buffer;
  mimetype: "image/png" | "image/jpeg" | "image/webp";
  originalname: string;
};

type GatewayImageResponse = {
  imageDataUrl: string;
  mimeType?: string;
  model?: string;
  operation?: "generate" | "edit";
};

type GatewayReviewResponse = {
  text: string;
  model?: string;
  imageCount?: number;
};

function bufferToBlobPart(buffer: Buffer) {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveOutputDirectory(value: string | undefined) {
  if (!value || value.trim() === "") {
    return path.join(PROJECT_ROOT, ".image-output");
  }

  return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
}

function detectMimeType(buffer: Buffer): LocalImage["mimetype"] | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    return "image/jpeg";
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  return null;
}

function pngHasAlphaChannel(buffer: Buffer) {
  return (
    buffer.length >= 26 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    (buffer[25] === 4 || buffer[25] === 6)
  );
}

async function readLocalImage(filePath: string, kind: "reference" | "mask"): Promise<LocalImage> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${kind === "mask" ? "mask_path" : "image_paths"} must contain absolute local paths.`);
  }

  const resolvedPath = path.resolve(filePath);
  const fileStats = await stat(resolvedPath).catch(() => null);

  if (!fileStats?.isFile()) {
    throw new Error(`Image file does not exist: ${resolvedPath}`);
  }

  if (fileStats.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image file is larger than 10MB: ${resolvedPath}`);
  }

  const buffer = await readFile(resolvedPath);
  const mimetype = detectMimeType(buffer);

  if (!mimetype) {
    throw new Error(`Unsupported image format: ${resolvedPath}. Use PNG, JPEG, or WebP.`);
  }

  if (kind === "mask" && (mimetype !== "image/png" || !pngHasAlphaChannel(buffer))) {
    throw new Error("mask_path must point to a PNG image with an alpha channel.");
  }

  return {
    buffer,
    mimetype,
    originalname: path.basename(resolvedPath),
  };
}

async function callGatewayJson<T>(endpoint: string, body: Record<string, unknown>) {
  const response = await fetch(`${gatewayUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(310_000),
  });

  return parseGatewayResponse<T>(response);
}

async function callGatewayMultipart<T>(endpoint: string, images: LocalImage[], mask?: LocalImage) {
  const form = new FormData();

  for (const image of images) {
    form.append("image[]", new Blob([bufferToBlobPart(image.buffer)], { type: image.mimetype }), image.originalname);
  }

  if (mask) {
    form.append("mask", new Blob([bufferToBlobPart(mask.buffer)], { type: mask.mimetype }), mask.originalname);
  }

  const response = await fetch(`${gatewayUrl}${endpoint}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(310_000),
  });

  return parseGatewayResponse<T>(response);
}

async function parseGatewayResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string; technicalDetails?: string }) | null;

  if (!response.ok) {
    const details = payload && "technicalDetails" in payload && payload.technicalDetails
      ? ` ${payload.technicalDetails}`
      : "";
    const message = payload && "error" in payload && payload.error ? payload.error : response.statusText || "Gateway request failed.";
    throw new Error(`${message}${details}`);
  }

  if (!payload) {
    throw new Error("Gateway returned an empty response.");
  }

  return payload;
}

function decodeImageDataUrl(imageDataUrl: string) {
  const separatorIndex = imageDataUrl.indexOf(",");

  if (!imageDataUrl.startsWith("data:image/") || separatorIndex === -1) {
    throw new Error("Gateway did not return a base64 image data URL.");
  }

  const header = imageDataUrl.slice(0, separatorIndex);
  const mimeType = header.slice(5, header.indexOf(";"));
  const base64 = imageDataUrl.slice(separatorIndex + 1);

  if (!mimeType || !base64) {
    throw new Error("Gateway returned an invalid image data URL.");
  }

  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
}

function slugify(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);

  return slug || "generated-image";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpeg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

async function saveImageResponse(response: GatewayImageResponse, prompt: string) {
  if (!response.imageDataUrl) {
    throw new Error("Gateway did not return an image.");
  }

  const decoded = decodeImageDataUrl(response.imageDataUrl);
  await mkdir(outputDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const filename = `${timestamp}-${slugify(prompt)}.${extensionForMimeType(decoded.mimeType)}`;
  const outputPath = path.join(outputDirectory, filename);
  await writeFile(outputPath, decoded.buffer);

  return {
    path: outputPath,
    mimeType: decoded.mimeType,
    buffer: decoded.buffer,
    model: response.model,
    operation: response.operation,
  };
}

function imageToolResult(savedImage: Awaited<ReturnType<typeof saveImageResponse>>) {
  const operationLabel = savedImage.operation === "edit" ? "Image edit" : "Image generation";

  return {
    content: [
      {
        type: "text" as const,
        text: `${operationLabel} complete.\nFile: ${savedImage.path}\nModel: ${savedImage.model || "gpt-image-2"}`,
      },
      {
        type: "image" as const,
        data: savedImage.buffer.toString("base64"),
        mimeType: savedImage.mimeType,
      },
    ],
    structuredContent: {
      path: savedImage.path,
      mimeType: savedImage.mimeType,
      model: savedImage.model || "gpt-image-2",
      operation: savedImage.operation || "generate",
    },
  };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Local GPT Image tool error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

const server = new McpServer(
  {
    name: "gpt-image-2-local",
    version: "0.1.0",
  },
  {
    instructions: [
      "Use this server for local GPT Image 2 generation, visual review, and image editing.",
      "generate_image creates an image from a prompt. edit_image requires one or more absolute local image_paths and optionally a PNG mask_path; the mask applies to the first image.",
      "review_image uses the configured text model to inspect one or more local images and return actionable art-direction feedback.",
      "Generated files are saved under the configured .image-output directory and are also returned as image content.",
    ].join(" "),
  },
);

server.registerTool(
  "generate_image",
  {
    title: "Generate image",
    description: "Generate a new GPT Image 2 image from a text prompt and return a saved local image file.",
    inputSchema: {
      prompt: z.string().min(1).describe("The visual prompt."),
      size: z.string().optional().describe("Image size, for example 1024x1024 or auto."),
      quality: z.enum(["auto", "low", "medium", "high"]).optional(),
      output_format: z.enum(["png", "jpeg", "webp"]).optional(),
    },
  },
  async ({ prompt, size, quality, output_format }) => {
    try {
      const response = await callGatewayJson<GatewayImageResponse>("/api/images/generate", {
        prompt,
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(output_format ? { output_format } : {}),
      });
      const savedImage = await saveImageResponse(response, prompt);
      return imageToolResult(savedImage);
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  "edit_image",
  {
    title: "Edit image",
    description: "Edit one or more local reference images with GPT Image 2. Use mask_path for a targeted edit of the first image.",
    inputSchema: {
      prompt: z.string().min(1).describe("The requested image change."),
      image_paths: z.array(z.string().min(1)).min(1).max(maxInputImages).describe("Absolute paths to one or more PNG, JPEG, or WebP reference images."),
      mask_path: z.string().min(1).optional().describe("Optional absolute path to a same-size PNG mask with an alpha channel."),
      size: z.string().optional().describe("Image size, for example 1024x1024 or auto."),
      quality: z.enum(["auto", "low", "medium", "high"]).optional(),
      output_format: z.enum(["png", "jpeg", "webp"]).optional(),
    },
  },
  async ({ prompt, image_paths, mask_path, size, quality, output_format }) => {
    try {
      const images = await Promise.all(image_paths.map((imagePath) => readLocalImage(imagePath, "reference")));
      const mask = mask_path ? await readLocalImage(mask_path, "mask") : undefined;
      const form = new FormData();
      for (const image of images) {
        form.append("image[]", new Blob([bufferToBlobPart(image.buffer)], { type: image.mimetype }), image.originalname);
      }
      if (mask) {
        form.append("mask", new Blob([bufferToBlobPart(mask.buffer)], { type: mask.mimetype }), mask.originalname);
      }
      form.append("prompt", prompt);
      if (size) form.append("size", size);
      if (quality) form.append("quality", quality);
      if (output_format) form.append("output_format", output_format);

      const response = await fetch(`${gatewayUrl}/api/images/edit`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(310_000),
      });
      const payload = await parseGatewayResponse<GatewayImageResponse>(response);
      const savedImage = await saveImageResponse(payload, prompt);
      return imageToolResult(savedImage);
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  "review_image",
  {
    title: "Review image",
    description: "Review one or more local reference images with the configured vision-capable text model and return actionable art-direction feedback.",
    inputSchema: {
      image_paths: z.array(z.string().min(1)).min(1).max(maxInputImages).describe("Absolute paths to one or more PNG, JPEG, or WebP images."),
      review_focus: z.string().optional().describe("Optional review focus, such as composition, typography, or prompt alignment."),
    },
  },
  async ({ image_paths, review_focus }) => {
    try {
      const images = await Promise.all(image_paths.map((imagePath) => readLocalImage(imagePath, "reference")));
      const response = await callGatewayMultipart<GatewayReviewResponse>("/api/images/review", images);

      return {
        content: [
          {
            type: "text" as const,
            text: `Image review (${response.imageCount || images.length} image${images.length === 1 ? "" : "s"}) using ${response.model || "gpt-5.5"}:\n\n${response.text}`,
          },
        ],
        structuredContent: {
          review: response.text,
          model: response.model || "gpt-5.5",
          imageCount: response.imageCount || images.length,
        },
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Unable to start GPT Image MCP server:", error);
  process.exitCode = 1;
});
