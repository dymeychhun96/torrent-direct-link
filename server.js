const express = require("express");
const { chromium } = require("playwright");
const { addExtra } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

// Initialize Playwright Extra with the stealth plugin
const chromiumExtra = addExtra(chromium);
chromiumExtra.use(StealthPlugin());

const app = express();
// Render assigns a port via the PORT environment variable. Fallback to 3000 for local testing.
const PORT = process.env.PORT || 3000;

app.get("/torrent/:hash", async (req, res) => {
  const hash = req.params.hash;
  const url = `https://webtor.io/${hash}`;
  let browser;
  let finalUrl = null;

  try {
    // Launch using our patched chromiumExtra
    browser = await chromiumExtra.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page
      .locator('input[name="resource-id"]')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });

    const downloadBtn = page.getByRole("button", { name: /download/i }).first();
    await downloadBtn.waitFor({ state: "visible" });

    // --- NEW DEBUGGING AND TIMEOUT FIX START ---

    // 1. Give the page a tiny bit of time to attach event listeners
    await page.waitForTimeout(2000);

    // 2. Add temporary logging to see EVERY network request happening after the click
    page.on("request", (request) =>
      console.log(">> Request:", request.method(), request.url()),
    );

    let downloadResponse;
    try {
      [downloadResponse] = await Promise.all([
        page.waitForResponse(
          // 3. Loosen the strict POST requirement temporarily
          (response) => response.url().includes("download-file"),
          { timeout: 30000 },
        ),
        // 4. Force the click in case another invisible element is overlapping it
        downloadBtn.click({ force: true }),
      ]);
    } catch (waitError) {
      // 5. If it fails, take a screenshot so you can physically see the problem!
      console.error("Timeout waiting for response. Taking screenshot...");
      await page.screenshot({ path: "error-screenshot.png", fullPage: true });
      throw waitError; // Rethrow to let the main catch block handle the 500 response
    }
    // --- NEW DEBUGGING AND TIMEOUT FIX END ---

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

    // Updated error response to point you to the screenshot
    res.status(500).json({
      error: err.message,
      troubleshooting:
        "Visit /debug/screenshot on your server to see what the browser saw.",
    });
  }
});

// --- ADDED ENDPOINT TO VIEW THE SCREENSHOT ---
app.get("/debug/screenshot", (req, res) => {
  const screenshotPath = path.join(__dirname, "error-screenshot.png");
  if (fs.existsSync(screenshotPath)) {
    res.sendFile(screenshotPath);
  } else {
    res
      .status(404)
      .send(
        "No screenshot found. The scraper either hasn't failed yet, or the error didn't trigger a screenshot.",
      );
  }
});

// Start the Express server instead of exporting it
app.listen(PORT, () => {
  console.log(`Webtor scraper server is running on port ${PORT}`);
});
