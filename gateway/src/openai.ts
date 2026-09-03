import type { Express } from "express";

const DEFAULT_BASE_URL = "https://api.yairouter.com/v1";
const DEFAULT_TEXT_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_IMAGE_QUALITY = "high";
const DEFAULT_IMAGE_OUTPUT_FORMAT = "png";
const PROVIDER_TIMEOUT_MS = 300_000;

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
  imageOutputFormat: string;
};

export type ImageOptions = {
  size: string;
  quality: string;
  outputFormat: string;
};

export type ImageFile = Pick<Express.Multer.File, "buffer" | "mimetype" | "originalname">;

export type ImageResult = {
  imageDataUrl: string;
  mimeType: string;
  model: string;
  operation: "generate" | "edit";
};

export type ImageReviewResult = {
  text: string;
  model: string;
  imageCount: number;
};

type ProviderRequestFailure = Error & {
  status?: number;
  technicalDetails?: string;
};

type ProviderImageData = {
  type?: string;
  result?: string;
  image_url?: string;
  b64_json?: string;
  url?: string;
};

type ProviderResponseOutputBlock = ProviderImageData & {
  content?: Array<ProviderResponseOutputBlock>;
};

type ProviderPayload = {
  error?: {
    message?: string;
  };
  data?: Array<ProviderImageData>;
  output?: Array<ProviderResponseOutputBlock>;
  output_text?: string;
};

type ResponsesApiInputContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
    };

type ResponsesApiInput = Array<{
  role: "user";
  content: ResponsesApiInputContent[];
}>;

export type OperatorFailure = {
  status: number;
  error: string;
  technicalDetails?: string;
};

function getMimeTypeForOutputFormat(outputFormat: string) {
  return outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
}

function createProviderFailure(status: number, message: string, technicalDetails?: string) {
  const error = new Error(message) as ProviderRequestFailure;
  error.status = status;
  error.technicalDetails = technicalDetails;
  return error;
}

export function getProviderConfig(): ProviderConfig {
  const apiKey = process.env.XAI_API_KEY || process.env.API_KEY;

  if (!apiKey) {
    throw createProviderFailure(500, "XAI_API_KEY is missing.");
  }

  return {
    apiKey,
    baseUrl: (process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    textModel: process.env.TEXT_MODEL || DEFAULT_TEXT_MODEL,
    imageModel: process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    imageSize: process.env.IMAGE_SIZE || DEFAULT_IMAGE_SIZE,
    imageQuality: process.env.IMAGE_QUALITY || DEFAULT_IMAGE_QUALITY,
    imageOutputFormat: process.env.IMAGE_OUTPUT_FORMAT || DEFAULT_IMAGE_OUTPUT_FORMAT,
  };
}

async function fetchRemoteImageAsDataUrl(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw createProviderFailure(
      502,
      "Generated image could not be downloaded.",
      `Remote image fetch failed with status ${response.status}.`,
    );
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function toDataUrl(value: string, outputFormat: string) {
  if (value.startsWith("data:image/")) {
    return value;
  }

  return `data:${getMimeTypeForOutputFormat(outputFormat)};base64,${value}`;
}

function extractImageCandidate(item: ProviderImageData, outputFormat: string) {
  if (typeof item.b64_json === "string") {
    return toDataUrl(item.b64_json, outputFormat);
  }

  if (typeof item.result === "string") {
    if (item.result.startsWith("data:image/")) {
      return item.result;
    }

    // YAI Router returns image_generation_call.result as raw base64 image data.
    return toDataUrl(item.result, outputFormat);
  }

  if (typeof item.image_url === "string") {
    return item.image_url;
  }

  if (typeof item.url === "string") {
    return item.url;
  }

  return null;
}

function findImageOutput(payload: ProviderPayload, outputFormat: string) {
  for (const dataItem of payload.data || []) {
    const candidate = extractImageCandidate(dataItem, outputFormat);

    if (candidate) {
      return candidate;
    }
  }

  function findInOutput(items: ProviderResponseOutputBlock[]): string | null {
    for (const item of items) {
      const directCandidate = extractImageCandidate(item, outputFormat);

      if (directCandidate) {
        return directCandidate;
      }

      const nestedCandidate = item.content ? findInOutput(item.content) : null;

      if (nestedCandidate) {
        return nestedCandidate;
      }
    }

    return null;
  }

  return findInOutput(payload.output || []);
}

async function parseProviderPayload(response: Response) {
  const payload = (await response.json().catch(() => null)) as ProviderPayload | null;

  if (!response.ok) {
    throw createProviderFailure(
      response.status,
      payload?.error?.message || "Provider request failed.",
      payload?.error?.message ? `Provider returned: ${payload.error.message}` : response.statusText || undefined,
    );
  }

  return payload;
}

async function normalizeImageResponse(response: Response, options: ImageOptions, operation: ImageResult["operation"], model: string) {
  console.log("[DEBUG-gateway] upstreamImageStatus", {
    status: response.status,
    statusText: response.statusText,
    operation,
  });

  const payload = await parseProviderPayload(response);
  const imageOutput = payload ? findImageOutput(payload, options.outputFormat) : null;

  if (!imageOutput) {
    throw createProviderFailure(502, "Image generation failed.", "Provider response did not include an image output.");
  }

  const imageDataUrl = imageOutput.startsWith("data:image/")
    ? imageOutput
    : await fetchRemoteImageAsDataUrl(imageOutput);

  return {
    imageDataUrl,
    mimeType: imageDataUrl.slice(5, imageDataUrl.indexOf(";")),
    model,
    operation,
  } satisfies ImageResult;
}

function providerHeaders(apiKey: string, json = false) {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function bufferToBlobPart(buffer: Buffer) {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

export async function generateImage(prompt: string, options: ImageOptions): Promise<ImageResult> {
  const config = getProviderConfig();
  const requestBody = {
    model: config.imageModel,
    prompt,
    size: options.size,
    quality: options.quality,
    output_format: options.outputFormat,
  };

  console.log("[DEBUG-gateway] imageGenerationRequest", {
    model: requestBody.model,
    promptLength: prompt.length,
    size: requestBody.size,
    quality: requestBody.quality,
    outputFormat: requestBody.output_format,
  });

  const response = await fetch(`${config.baseUrl}/images/generations`, {
    method: "POST",
    headers: providerHeaders(config.apiKey, true),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  return normalizeImageResponse(response, options, "generate", config.imageModel);
}

function appendImage(form: FormData, fieldName: string, file: ImageFile) {
  const filename = file.originalname || "reference-image";
  form.append(fieldName, new Blob([bufferToBlobPart(file.buffer)], { type: file.mimetype }), filename);
}

export async function editImages(
  prompt: string,
  options: ImageOptions,
  files: ImageFile[],
  mask?: ImageFile,
): Promise<ImageResult> {
  if (!files.length) {
    throw createProviderFailure(400, "At least one reference image is required for editing.");
  }

  const config = getProviderConfig();
  const form = new FormData();
  form.set("model", config.imageModel);
  form.set("prompt", prompt);
  form.set("size", options.size);
  form.set("quality", options.quality);
  form.set("output_format", options.outputFormat);

  for (const file of files) {
    // The OpenAI Images API uses image[] for one or more input images.
    appendImage(form, "image[]", file);
  }

  if (mask) {
    appendImage(form, "mask", mask);
  }

  console.log("[DEBUG-gateway] imageEditRequest", {
    model: config.imageModel,
    promptLength: prompt.length,
    imageCount: files.length,
    hasMask: Boolean(mask),
    size: options.size,
    quality: options.quality,
    outputFormat: options.outputFormat,
  });

  const response = await fetch(`${config.baseUrl}/images/edits`, {
    method: "POST",
    headers: providerHeaders(config.apiKey),
    body: form,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  return normalizeImageResponse(response, options, "edit", config.imageModel);
}

function collectOutputText(value: unknown, output: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectOutputText(item, output);
    }

    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const item = value as Record<string, unknown>;

  if (typeof item.output_text === "string") {
    output.push(item.output_text);
  }

  if (typeof item.text === "string" && (!item.type || item.type === "output_text" || item.type === "text")) {
    output.push(item.text);
  }

  if (item.content) {
    collectOutputText(item.content, output);
  }

  if (item.output) {
    collectOutputText(item.output, output);
  }
}

function findReviewText(payload: ProviderPayload | null) {
  const output: string[] = [];

  if (payload?.output_text) {
    output.push(payload.output_text);
  }

  collectOutputText(payload?.output, output);

  return [...new Set(output.map((text) => text.trim()).filter(Boolean))].join("\n\n");
}

function buildReviewPrompt(reviewFocus?: string) {
  const focus = reviewFocus?.trim() || "overall visual quality, prompt alignment, composition, subject consistency, typography, and likely improvement opportunities";

  return [
    "Review the supplied reference image(s) as a senior art director before an image edit.",
    `Focus on: ${focus}.`,
    "Return a concise, actionable review with these sections:",
    "1. Verdict",
    "2. What is working",
    "3. Problems or risks",
    "4. Specific edit instructions",
    "5. A ready-to-use image editing prompt",
    "Do not claim to have changed the image. Describe only what is visible and what should be changed.",
  ].join("\n");
}

export async function reviewImages(reviewFocus: string | undefined, files: ImageFile[]): Promise<ImageReviewResult> {
  if (!files.length) {
    throw createProviderFailure(400, "At least one reference image is required for review.");
  }

  const config = getProviderConfig();
  const content: ResponsesApiInput[0]["content"] = [
    {
      type: "input_text",
      text: buildReviewPrompt(reviewFocus),
    },
    ...files.map((file) => ({
      type: "input_image" as const,
      image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    })),
  ];

  const requestBody = {
    model: config.textModel,
    input: [
      {
        role: "user" as const,
        content,
      },
    ] satisfies ResponsesApiInput,
    stream: false,
  };

  console.log("[DEBUG-gateway] imageReviewRequest", {
    model: config.textModel,
    imageCount: files.length,
    focusLength: reviewFocus?.trim().length || 0,
  });

  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: providerHeaders(config.apiKey, true),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  const payload = await parseProviderPayload(response);
  const text = findReviewText(payload);

  if (!text) {
    throw createProviderFailure(502, "Image review failed.", "Provider response did not include review text.");
  }

  return {
    text,
    model: config.textModel,
    imageCount: files.length,
  };
}

// Backwards-compatible wrappers used by the browser UI.
export async function generateFromPrompt(prompt: string, options: ImageOptions) {
  const result = await generateImage(prompt, options);
  return result.imageDataUrl;
}

export async function generateFromPromptAndReferenceImage(prompt: string, options: ImageOptions, file: ImageFile) {
  const result = await editImages(prompt, options, [file]);
  return result.imageDataUrl;
}

export function toOperatorFailure(error: unknown): OperatorFailure {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && (error.name === "TimeoutError" || error.message.toLowerCase().includes("timeout")))
  ) {
    console.log("[DEBUG-gateway] upstreamTimeout", {
      reason: error instanceof Error ? error.message : "AbortSignal timeout after 300 seconds",
    });

    return {
      status: 504,
      error: "Provider request timed out.",
      technicalDetails: "YAI Router did not respond within 300 seconds.",
    };
  }

  if (error instanceof Error) {
    const providerError = error as ProviderRequestFailure;
    console.log("[DEBUG-gateway] operatorFailure", {
      status: providerError.status || 500,
      message: providerError.message,
      technicalDetails: providerError.technicalDetails,
    });
    return {
      status: providerError.status || 500,
      error: providerError.message || "Image generation failed.",
      technicalDetails: providerError.technicalDetails,
    };
  }

  console.log("[DEBUG-gateway] operatorFailure", {
    status: 500,
    message: "Non-Error thrown value",
  });
  return {
    status: 500,
    error: "Image generation failed.",
  };
}
