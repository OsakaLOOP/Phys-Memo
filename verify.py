import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto("http://localhost:5173")

        await page.wait_for_timeout(2000)

        # Click sidebar concept "测试节点"
        print("Clicking '测试节点'...")
        await page.get_by_text("测试节点").first.click()
        await page.wait_for_timeout(2000)

        print("Clicking '编辑' button in sidebar...")
        try:
            edit_btn = page.locator("button", has_text="编辑").first
            await edit_btn.click(force=True)
            await page.wait_for_timeout(2000)
        except Exception as e:
            print("Failed to click Edit button:", e)

        print("Waiting for CodeMirror to appear...")
        # Since clicking edit doesn't immediately open codemirror, we need to click inside the content area
        # We can click anywhere in the white box for 核心定义
        print("Clicking inside the math equation to trigger CodeMirror...")
        math_block = page.locator(".katex-display").first
        await math_block.click(force=True)
        await page.wait_for_timeout(2000)

        try:
            await page.wait_for_selector(".cm-content", timeout=5000)
            print("CodeMirror loaded!")

            # Let's hit enter a few times in codemirror to create a gap if one doesn't exist
            cm = page.locator(".cm-content").first
            await cm.click()
            await page.keyboard.press("End")
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(500)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(500)
            await page.keyboard.press("ArrowUp")
            await page.wait_for_timeout(500)

            # Let's see if the widget is generated
            print("Checking widgets...")
            widgets = page.locator(".gap-widget-container")
            count = await widgets.count()
            print(f"Found {count} gap-widget-container elements")
            if count > 0:
                await page.evaluate("""() => {
                    const containers = document.querySelectorAll('.gap-widget-container');
                    if (containers.length > 0) {
                        containers[0].style.opacity = '1';
                    }
                }""")
                await page.wait_for_timeout(1000)
                await page.screenshot(path="screenshot-hover.png", full_page=True)
                print("Hover screenshot saved.")
        except Exception as e:
            print("CodeMirror not loaded:", e)
            await page.screenshot(path="screenshot-error.png", full_page=True)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
