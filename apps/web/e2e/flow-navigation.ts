import type { Page } from "@playwright/test";

export async function gotoFlowPage(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("net::ERR_ABORTED")) {
      throw error;
    }

    await page.waitForTimeout(250);
    await page.goto(path);
  }
}
