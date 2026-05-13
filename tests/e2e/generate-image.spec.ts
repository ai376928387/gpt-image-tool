import { expect, test } from "@playwright/test";

test("searches the prompt catalog and generates an image", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Search 162 prompts" })).toBeVisible();

  const catalogSearch = page.getByLabel("Search library");
  await catalogSearch.fill("health tracker");

  await expect(page.getByRole("heading", { name: "Health Tracker App Mockup" })).toBeVisible();

  await page.getByRole("button", { name: "Use prompt" }).first().click();

  const promptField = page.getByLabel("Prompt");
  await expect(promptField).toContainText("Create a refined mobile health tracking app screen");

  await catalogSearch.fill("tea poster");
  await expect(page.getByRole("heading", { name: "Chinese tea launch poster" })).toBeVisible();

  await page.getByRole("button", { name: "Remix" }).first().click();
  await expect(promptField).toContainText("Additional inspiration:");
  await expect(promptField).toContainText("Design a 3:4 vertical poster for a new Chinese trendy tea launch");

  await page.getByRole("button", { name: "Generate image" }).click();

  const previewImage = page.locator("img.preview-image");
  const errorPanel = page.locator(".error-panel");

  await expect
    .poll(
      async () => {
        if (await previewImage.count()) {
          return "success";
        }

        if (await errorPanel.count()) {
          return `error:${(await errorPanel.textContent()) || "unknown"}`;
        }

        return "pending";
      },
      {
        timeout: 150_000,
        message: "Expected image generation to either succeed or show an operator error.",
      },
    )
    .toBe("success");

  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveAttribute("src", /data:image\/(png|jpeg|webp);base64,/);

  const downloadLink = page.getByRole("link", { name: "Download image" });
  await expect(downloadLink).toBeVisible();
  await expect(downloadLink).toHaveAttribute("href", /data:image\/(png|jpeg|webp);base64,/);
});
