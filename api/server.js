const express = require("express");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();

chromium.use(stealth);

const app = express();

app.get("/torrent/:hash", async (req, res) => {
  const hash = req.params.hash;
  const url = `https://webtor.io/${hash}`;
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded" });

    await page
      .locator('input[name="resource-id"]')
      .first()
      .waitFor({ state: "attached" });

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
    let logResult = null;
    let fullQueueUrl = null;

    if (queueUrlMatch && queueUrlMatch[1]) {
      const queueUrl = queueUrlMatch[1];
      fullQueueUrl = `https://webtor.io${queueUrl}`;

      logResult = await page.evaluate(async (fetchUrl) => {
        try {
          const response = await fetch(fetchUrl);
          return await response.text();
        } catch (e) {
          return `Error fetching log: ${e.message}`;
        }
      }, fullQueueUrl);
    }

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
              // Replace the literal \u0026 with a standard &
              finalUrl = urlMatch[1].replace(/\\u0026/g, "&");
              break;
            }
          } catch (e) {
            console.error("Failed to parse log line:", e.message);
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
    console.error(err);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
