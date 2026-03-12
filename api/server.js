const express = require("express");
const { chromium: playwrightCore } = require("playwright-core");
const { addExtra } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const chromium = require("@sparticuz/chromium");

const playwright = addExtra(playwrightCore);
playwright.use(StealthPlugin());

const app = express();

app.get("/torrent/:hash", async (req, res) => {
  const hash = req.params.hash;
  const url = `https://webtor.io/${hash}`;
  let browser;
  let finalUrl = null;

  try {
    // Required configuration for Vercel's 50MB limit
    browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    // Increased timeout to 60s for serverless "cold starts"
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page
      .locator('input[name="resource-id"]')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });

    const downloadBtn = page.getByRole("button", { name: /download/i }).first();
    await downloadBtn.waitFor({ state: "visible" });

    const [downloadResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("download-file") &&
          response.request().method() === "POST",
        { timeout: 30000 },
      ),
      downloadBtn.click(),
    ]);

    const body = await downloadResponse.text();
    const queueUrlMatch = body.match(/data-async-progress-log="([^"]+)"/);

    if (queueUrlMatch && queueUrlMatch[1]) {
      const fullQueueUrl = `https://webtor.io${queueUrlMatch[1]}`;

      const logResult = await page.evaluate(async (fetchUrl) => {
        try {
          const response = await fetch(fetchUrl);
          return await response.text();
        } catch (e) {
          return null;
        }
      }, fullQueueUrl);

      if (logResult) {
        const lines = logResult.split("\n");
        for (const line of lines) {
          if (line.startsWith("data:") && line.includes("var url")) {
            try {
              const jsonData = JSON.parse(line.substring(5));
              const urlMatch = jsonData.body.match(
                /var\s+url\s*=\s*["'](https?:\/\/[^"']+)/,
              );
              if (urlMatch && urlMatch[1]) {
                finalUrl = urlMatch[1].replace(/\\u0026/g, "&");
                break;
              }
            } catch (e) {
              console.error("Parse error:", e.message);
            }
          }
        }
      }
    }

    await browser.close();

    res.json({
      hash,
      status: finalUrl ? "Success" : "Failed to extract final URL",
      download_url: finalUrl,
    });
  } catch (err) {
    console.error("Scraping Error:", err);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
