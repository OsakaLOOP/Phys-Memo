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

            # Drop a tall image file
            print("Dropping tall image...")
            await page.evaluate('''() => {
                // Mock a tall image by setting large height in the fake image properties via Object.defineProperty
                const dataTransfer = new DataTransfer();
                const file1 = new File([new Uint8Array(10)], "test_tall.jpg", { type: "image/jpeg" });
                Object.defineProperty(dataTransfer, 'files', {
                    get: () => [file1]
                });
                Object.defineProperty(dataTransfer, 'types', {
                    get: () => ['Files']
                });

                // Override window.Image to simulate loading a tall image
                const OriginalImage = window.Image;
                window.Image = function() {
                    const img = new OriginalImage();
                    setTimeout(() => {
                        Object.defineProperty(img, 'naturalWidth', { get: () => 400 });
                        Object.defineProperty(img, 'naturalHeight', { get: () => 1600 });
                        if(img.onload) img.onload();
                    }, 50);
                    return img;
                };

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

            print("Clicking off the widget to render viewer...")
            await page.click("body", position={"x": 10, "y": 10})
            await page.wait_for_timeout(1000)

            os.makedirs('/home/jules/verification/screenshots', exist_ok=True)
            await page.screenshot(path='/home/jules/verification/screenshots/tall_image_check.png')

            print("Success")
        except Exception as e:
            print("Error:", e)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
