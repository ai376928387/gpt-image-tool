import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  editImages,
  generateImage,
  reviewImages,
  type ImageFile,
} from "../src/openai.js";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  XAI_API_KEY: process.env.XAI_API_KEY,
  API_KEY: process.env.API_KEY,
  BASE_URL: process.env.BASE_URL,
  TEXT_MODEL: process.env.TEXT_MODEL,
  IMAGE_MODEL: process.env.IMAGE_MODEL,
};

const imageOptions = {
  size: "1024x1024",
  quality: "high",
  outputFormat: "png",
};

function testImage(originalname: string, buffer = Buffer.from(`${originalname}-bytes`)): ImageFile {
  return {
    buffer,
    mimetype: "image/png",
    originalname,
  };
}

function providerImageResponse() {
  return new Response(
    JSON.stringify({
      data: [{ b64_json: Buffer.from("generated-image").toString("base64") }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

beforeEach(() => {
  process.env.XAI_API_KEY = "test-provider-key";
  delete process.env.API_KEY;
  process.env.BASE_URL = "https://provider.test/v1";
  process.env.TEXT_MODEL = "gpt-5.5";
  process.env.IMAGE_MODEL = "gpt-image-2";
});

afterEach(() => {
  globalThis.fetch = originalFetch;

  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("generateImage uses the Images generations endpoint and normalizes b64_json", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return providerImageResponse();
  };

  const result = await generateImage("a red paper boat", imageOptions);

  assert.equal(requestUrl, "https://provider.test/v1/images/generations");
  assert.deepEqual(requestBody, {
    model: "gpt-image-2",
    prompt: "a red paper boat",
    size: "1024x1024",
    quality: "high",
    output_format: "png",
  });
  assert.equal(result.operation, "generate");
  assert.equal(result.mimeType, "image/png");
  assert.match(result.imageDataUrl, /^data:image\/png;base64,/);
});

test("editImages sends multiple image[] parts and an optional mask", async () => {
  let requestUrl = "";
  let requestForm: FormData | undefined;

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestForm = init?.body as FormData;
    return providerImageResponse();
  };

  const result = await editImages(
    "combine the references into one editorial product shot",
    imageOptions,
    [testImage("one.png"), testImage("two.png")],
    testImage("mask.png"),
  );

  assert.equal(requestUrl, "https://provider.test/v1/images/edits");
  assert.ok(requestForm);
  assert.equal(requestForm.get("model"), "gpt-image-2");
  assert.equal(requestForm.get("prompt"), "combine the references into one editorial product shot");
  assert.equal(requestForm.get("size"), "1024x1024");
  assert.equal(requestForm.get("quality"), "high");
  assert.equal(requestForm.get("output_format"), "png");
  assert.equal(requestForm.getAll("image[]").length, 2);
  assert.equal(requestForm.get("mask") instanceof Blob, true);
  assert.equal(result.operation, "edit");
});

test("reviewImages sends all images as Responses API input_image content", async () => {
  let requestBody: {
    model?: string;
    input?: Array<{ content?: Array<{ type?: string; image_url?: string }> }>;
  } | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Use stronger type hierarchy." }],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await reviewImages("focus on typography", [testImage("one.png"), testImage("two.png")]);

  assert.equal(requestBody?.model, "gpt-5.5");
  assert.equal(requestBody?.input?.[0]?.content?.filter((item) => item.type === "input_image").length, 2);
  assert.equal(result.text, "Use stronger type hierarchy.");
  assert.equal(result.imageCount, 2);
});
