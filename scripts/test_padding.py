import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("Navigating to page...")
        await page.goto("http://localhost:5173", wait_until="networkidle")

        print("Finding nodes...")
        try:
            await page.wait_for_selector("a[href*='/node/']", timeout=10000)
            await page.click("a[href*='/node/']")

            # Click edit button
            await page.wait_for_selector("button:has-text('编辑')", timeout=10000)
            await page.click("button:has-text('编辑')")

            # Find Editor
            await page.wait_for_selector(".cm-content", timeout=10000)

            # Drop an image file
            print("Dropping image...")
            await page.evaluate('''() => {
                const dataTransfer = new DataTransfer();
                const file1 = new File([new Uint8Array(10)], "test1.jpg", { type: "image/jpeg" });
                Object.defineProperty(dataTransfer, 'files', {
                    get: () => [file1]
                });
                Object.defineProperty(dataTransfer, 'types', {
                    get: () => ['Files']
                });

                const cmContent = document.querySelector(".cm-content");
                const rect = cmContent.getBoundingClientRect();

                const dropEvent = new DragEvent("drop", {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + 50,
                    clientY: rect.top + 50,
                    dataTransfer: dataTransfer
                });

                cmContent.dispatchEvent(dropEvent);
            }''')

            await page.wait_for_timeout(2000)
            os.makedirs('/home/jules/verification/screenshots', exist_ok=True)
            await page.screenshot(path='/home/jules/verification/screenshots/padding_check_1.png')

            print("Clicking off the widget to render viewer...")
            await page.click("body", position={"x": 10, "y": 10})
            await page.wait_for_timeout(1000)
            await page.screenshot(path='/home/jules/verification/screenshots/padding_check_2.png')

            print("Success")
        except Exception as e:
            print("Error:", e)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
