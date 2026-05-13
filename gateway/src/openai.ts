import type { Express } from "express";

const DEFAULT_BASE_URL = "https://api-xai.ainaibahub.com/v1";
const DEFAULT_TEXT_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_IMAGE_QUALITY = "high";
const DEFAULT_IMAGE_OUTPUT_FORMAT = "png";

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
  imageOutputFormat: string;
};

type ImageOptions = {
  size?: string;
  quality: string;
  outputFormat: string;
};

function getMimeTypeForOutputFormat(outputFormat: string) {
  return outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
}

type ProviderRequestFailure = Error & {
  status?: number;
  technicalDetails?: string;
};

type ResponseOutputItem = {
  type?: string;
  result?: string;
  image_url?: string;
  b64_json?: string;
  text?: string;
};

type ResponseOutputBlock = {
  type?: string;
  result?: string;
  image_url?: string;
  b64_json?: string;
  content?: Array<ResponseOutputItem>;
};

type ResponsesApiPayload = {
  error?: {
    message?: string;
  };
  output?: Array<ResponseOutputBlock>;
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

export function getProviderConfig(): ProviderConfig {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    throw createProviderFailure(500, "API_KEY is missing.");
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

function createProviderFailure(status: number, message: string, technicalDetails?: string) {
  const error = new Error(message) as ProviderRequestFailure;
  error.status = status;
  error.technicalDetails = technicalDetails;
  return error;
}

async function fetchRemoteImageAsDataUrl(url: string) {
  const response = await fetch(url);

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

function extractImageCandidate(
  item: { type?: string; result?: string; image_url?: string; b64_json?: string },
  outputFormat: string,
) {
  if (typeof item.result === "string") {
    if (item.result.startsWith("data:image/")) {
      return item.result;
    }

    // AinaibaHub returns image_generation_call.result as raw base64 image data.
    if (item.type === "image_generation_call") {
      return `data:${getMimeTypeForOutputFormat(outputFormat)};base64,${item.result}`;
    }
  }

  if (item.image_url) {
    return item.image_url;
  }

  if (item.b64_json) {
    return `data:${getMimeTypeForOutputFormat(outputFormat)};base64,${item.b64_json}`;
  }

  return null;
}

function findImageOutput(payload: ResponsesApiPayload, outputFormat: string) {
  for (const outputItem of payload.output || []) {
    const directCandidate = extractImageCandidate(outputItem, outputFormat);

    if (directCandidate) {
      return directCandidate;
    }

    for (const contentItem of outputItem.content || []) {
      const nestedCandidate = extractImageCandidate(contentItem, outputFormat);

      if (nestedCandidate) {
        return nestedCandidate;
      }
    }
  }

  return null;
}

async function normalizeProviderResponse(response: Response, outputFormat: string) {
  console.log("[DEBUG-gateway] upstreamStatus", {
    status: response.status,
    statusText: response.statusText,
  });

  const payload = (await response.json().catch(() => null)) as ResponsesApiPayload | null;

  console.log("[DEBUG-gateway] upstreamPayload", {
    topLevelKeys: payload ? Object.keys(payload).slice(0, 20) : null,
    outputTypes: payload?.output?.map((item) => item.type) || [],
  });

  if (!response.ok) {
    throw createProviderFailure(
      response.status,
      payload?.error?.message || "Image generation failed.",
      payload?.error?.message ? `Provider returned: ${payload.error.message}` : response.statusText || undefined,
    );
  }

  const imageOutput = payload ? findImageOutput(payload, outputFormat) : null;

  if (!imageOutput) {
    throw createProviderFailure(502, "Image generation failed.", "Provider response did not include an image output.");
  }

  if (imageOutput.startsWith("data:image/")) {
    return imageOutput;
  }

  return fetchRemoteImageAsDataUrl(imageOutput);
}

function buildInput(prompt: string, file?: Express.Multer.File): ResponsesApiInput | string {
  if (!file) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt,
        },
        {
          type: "input_image",
          image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
        },
      ],
    },
  ];
}

async function generate(prompt: string, options: ImageOptions, file?: Express.Multer.File) {
  const config = getProviderConfig();
  const input = buildInput(prompt, file);
  const requestBody = {
    model: config.textModel,
    input,
    tools: [
      {
        type: "image_generation",
        model: config.imageModel,
        size: options.size,
        quality: options.quality,
        output_format: options.outputFormat,
      },
    ],
    stream: false,
  };

  console.log("[DEBUG-gateway] providerConfig", {
    baseUrl: config.baseUrl,
    textModel: config.textModel,
    imageModel: config.imageModel,
    defaultImageSize: config.imageSize,
    defaultImageQuality: config.imageQuality,
    defaultImageOutputFormat: config.imageOutputFormat,
    hasApiKey: Boolean(config.apiKey),
  });

  console.log("[DEBUG-gateway] requestBody", {
    model: requestBody.model,
    inputType: typeof requestBody.input,
    inputPreview:
      typeof requestBody.input === "string"
        ? requestBody.input
        : "[non-string input omitted]",
    hasReferenceImage: Boolean(file),
    toolType: requestBody.tools[0].type,
    toolModel: requestBody.tools[0].model,
    toolSize: requestBody.tools[0].size,
    toolQuality: requestBody.tools[0].quality,
    toolOutputFormat: requestBody.tools[0].output_format,
    stream: requestBody.stream,
  });

  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(300_000),
  });

  return normalizeProviderResponse(response, options.outputFormat);
}

export async function generateFromPrompt(prompt: string, options: ImageOptions) {
  return generate(prompt, options);
}

export async function generateFromPromptAndReferenceImage(prompt: string, options: ImageOptions, file: Express.Multer.File) {
  return generate(prompt, options, file);
}

export function toOperatorFailure(error: unknown): OperatorFailure {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.message.toLowerCase().includes("timeout"))
  ) {
    console.log("[DEBUG-gateway] upstreamTimeout", {
      reason: error instanceof Error ? error.message : "AbortSignal timeout after 180 seconds",
    });

    return {
      status: 504,
      error: "Provider request timed out.",
      technicalDetails: "AinaibaHub did not respond within 300 seconds.",
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
