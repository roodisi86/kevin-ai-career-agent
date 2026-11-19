import { expect, test } from "@playwright/test";

test.describe("unauthenticated access", () => {
  test("protected pages redirect to the login page", async ({ page }) => {
    for (const path of ["/dashboard", "/profiel", "/voorkeuren", "/instellingen"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.getByRole("heading", { name: "Inloggen" })).toBeVisible();
  });

  test("private API routes return 401 without a session", async ({ request }) => {
    for (const path of ["/api/export", "/api/profile/documents/00000000-0000-4000-8000-000000000000"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(401);
    }
    const upload = await request.post("/api/profile/documents", { multipart: { file: "x" } });
    expect(upload.status()).toBe(401);
  });

  test("wrong credentials show a clear error and keep you on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mailadres").fill("nobody@example.invalid");
    await page.getByLabel("Wachtwoord").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("security headers are set", async ({ request }) => {
    const response = await request.get("/login");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  });
});
