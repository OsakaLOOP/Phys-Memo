import os
import glob
from playwright.sync_api import sync_playwright

def verify_feature(page):
    page.goto("http://localhost:5173")
    page.wait_for_timeout(2000)

    # 1. Click "新建"
    new_button = page.locator("button:has-text('新建')").first
    new_button.click()
    page.wait_for_timeout(1000)

    # 2. Click "新物理概念" (the new node)
    page.locator("text=新物理概念").first.click()
    page.wait_for_timeout(1000)

    # 3. Click "编辑"
    edit_button = page.locator("button:has-text('编辑')").first
    if edit_button.is_visible():
        edit_button.click()
        page.wait_for_timeout(1000)

    # Let's take a screenshot of the initial editor state
    page.screenshot(path="/home/jules/verification/empty_states.png")
    page.wait_for_timeout(1000)

    # 4. Click "添加标签" in 适用域 / FIELDS
    tags_add = page.locator("text=添加标签").first
    tags_add.click()
    page.wait_for_timeout(1000)

    page.screenshot(path="/home/jules/verification/tag_added.png")

    # 5. Type something in the tag
    tag_input = page.locator("input[placeholder='输入内容...']").first
    if tag_input.is_visible():
        tag_input.fill("测试标签1")
        page.wait_for_timeout(500)

    # 6. Click the "+" button to add another tag
    plus_button = page.locator(".flex-center.w-6.h-6.rounded-full").first
    if plus_button.is_visible():
        plus_button.click()
        page.wait_for_timeout(1000)

    page.screenshot(path="/home/jules/verification/second_tag.png")

    # Now let's test adding block at specific location (top) in "核心定义"
    # 7. Add content block in "核心定义"
    core_add = page.locator("text=添加内容块").first
    core_add.click()
    page.wait_for_timeout(1000)

    # 8. Type "第二块" in the text area
    core_textarea = page.locator("textarea").first
    if core_textarea.is_visible():
        core_textarea.fill("第二块")
        page.wait_for_timeout(500)

    # 9. Hover over the block and click top +
    atom_block = page.locator("[data-index='0']").first
    atom_block.hover()
    page.wait_for_timeout(1000)

    top_plus = page.locator(".group\\/list-item .\\-top-3 button").first
    top_plus.click()
    page.wait_for_timeout(1000)

    # 10. Type "第一块" in the NEW text area (which should now be at index 0)
    new_textarea = page.locator("textarea").first
    if new_textarea.is_visible():
        new_textarea.fill("第一块")
        page.wait_for_timeout(1000)

    # Take final screenshot showing correct order and the UI
    page.screenshot(path="/home/jules/verification/final_verification.png")

if __name__ == "__main__":
    os.makedirs("/home/jules/verification/video", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="/home/jules/verification/video")
        page = context.new_page()
        try:
            verify_feature(page)
        finally:
            context.close()
            browser.close()
