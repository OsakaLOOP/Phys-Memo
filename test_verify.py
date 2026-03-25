from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(record_video_dir="/home/jules/verification/video")
    page = context.new_page()

    try:
        page.goto("http://localhost:5173")
        page.wait_for_timeout(2000)

        # click on an item in the sidebar
        page.locator("text='测试节点'").nth(0).click()
        page.wait_for_timeout(1000)

        # click the "编辑" button on the bottom left
        page.locator("text='编辑'").click()
        page.wait_for_timeout(1000)

        # click the "保存版本" button
        page.locator("text='保存版本'").click()
        page.wait_for_timeout(500)

        # Look for the toast message
        page.screenshot(path="/home/jules/verification/verification.png")
        page.wait_for_timeout(1000)

    except Exception as e:
        print(f"Error during test: {e}")
        page.screenshot(path="/home/jules/verification/error.png")
    finally:
        context.close()
        browser.close()

with sync_playwright() as playwright:
    run(playwright)