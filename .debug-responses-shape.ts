import dotenv from "dotenv";

dotenv.config({ path: "/home/wicky/Documents/dirty-place/medical-tour/image-generator-app/.env" });

const apiKey = process.env.API_KEY;
const baseUrl = process.env.BASE_URL || "https://api-xai.ainaibahub.com/v1";

const bodyBase = {
  model: process.env.TEXT_MODEL || "gpt-5.5",
  input: "Create a premium AI workspace cover image: a glass AI studio, glowing prompt console, soft cinematic light. No words, no logos, no watermark.",
  tools: [
    {
      type: "image_generation",
      model: process.env.IMAGE_MODEL || "gpt-image-2",
      size: process.env.IMAGE_SIZE || "1024x1024",
      quality: process.env.IMAGE_QUALITY || "high",
      output_format: process.env.IMAGE_OUTPUT_FORMAT || "png",
    },
  ],
};

async function run(stream: boolean) {
  const res = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...bodyBase, stream }),
  });

  const text = await res.text();
  console.log(JSON.stringify({
    stream,
    status: res.status,
    statusText: res.statusText,
    preview: text.slice(0, 2000),
  }, null, 2));
}

async function main() {
  await run(false);
  await run(true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
