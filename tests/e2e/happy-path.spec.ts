import { expect, test } from "@playwright/test";
import { join } from "node:path";

/**
 * Happy path with a SYNTHETIC demo account (DEMO tenant, allow-listed).
 * Requires E2E_EMAIL and E2E_PASSWORD (see .env.example); skipped otherwise.
 * Never run this with a real personal account or a real CV.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set — demo account required");

test("login → upload CV → confirm a fact → preferences → export → wipe", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email!);
  await page.getByLabel("Wachtwoord").fill(password!);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("DEMO-omgeving")).toBeVisible();

  // Start clean in case a previous run left data behind.
  await page.goto("/instellingen");
  await page.getByLabel("Typ VERWIJDER om te bevestigen").fill("VERWIJDER");
  await page.getByRole("button", { name: "Alles wissen" }).click();
  await expect(page.getByText("Je profielgegevens zijn gewist.")).toBeVisible();

  // Upload the synthetic CV.
  await page.goto("/profiel");
  await page.getByLabel("Kies een bestand").setInputFiles(join(process.cwd(), "tests/fixtures/demo-cv.pdf"));
  await page.getByRole("button", { name: "Uploaden" }).click();
  await expect(page.getByText("Cv geüpload en tekst uitgelezen.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("document")).toHaveCount(1);
  await page.getByText("Uitgelezen tekst bekijken").click();
  await expect(page.getByText("Commercial Director Benelux").first()).toBeVisible();

  // Uploading the same file twice is refused.
  await page.getByLabel("Kies een bestand").setInputFiles(join(process.cwd(), "tests/fixtures/demo-cv.pdf"));
  await page.getByRole("button", { name: "Uploaden" }).click();
  await expect(page.getByText("Dit bestand heb je al geüpload.")).toBeVisible();

  // Add a fact manually (counts as confirmed by the user).
  await page.getByLabel("Omschrijving").fill("DEMO: speaks Dutch, English, French and Spanish");
  await page.getByLabel("Soort").last().selectOption("language");
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page.getByTestId("confirmed-fact")).toHaveCount(1);

  // Preferences: make company car a hard filter and exclude an employer.
  await page.goto("/voorkeuren");
  await page.getByRole("group", { name: "Leaseauto" }).getByLabel("Hard").check();
  await page.getByLabel("Werkgever", { exact: true }).fill("London Stock Exchange Group");
  await page.getByRole("button", { name: "Werkgever toevoegen" }).click();
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText(/^Opgeslagen\./)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Leaseauto" }).getByLabel("Hard")).toBeChecked();
  await expect(page.getByText("London Stock Exchange Group", { exact: true })).toBeVisible();

  // Dashboard reflects the state.
  await page.goto("/dashboard");
  await expect(page.getByTestId("count-confirmed")).toHaveText("1");
  await expect(page.getByText("Leaseauto")).toBeVisible();

  // Export contains the data.
  await page.goto("/instellingen");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export downloaden" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.documents).toHaveLength(1);
  expect(exported.facts).toHaveLength(1);
  expect(exported.preferences.preferences_json.constraints.companyCar).toBe("hard");

  // Wipe everything and verify it is gone.
  await page.getByLabel("Typ VERWIJDER om te bevestigen").fill("VERWIJDER");
  await page.getByRole("button", { name: "Alles wissen" }).click();
  await expect(page.getByText("Je profielgegevens zijn gewist.")).toBeVisible();
  await page.goto("/profiel");
  await expect(page.getByText("Nog geen cv geüpload.")).toBeVisible();
  await expect(page.getByTestId("confirmed-fact")).toHaveCount(0);
  await expect(page.getByText(/data\.deleted/)).toHaveCount(0); // audit is on the settings page
  await page.goto("/instellingen");
  await expect(page.getByText("data.deleted").first()).toBeVisible();
});
