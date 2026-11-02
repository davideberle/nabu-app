// Step 2 A (2026-11-02): the earlier parent views (Mathe, Deutsch, …, Einstellungen) now sit inside the collapsed
// «Visit details» section under the English skills ladder. Older browser checks open it before using a tab.
export async function openParentTab(page, name, opts = {}) {
  const details = page.locator("[data-testid='visit-details']");
  await details.waitFor({ timeout: opts.timeout ?? 30000 });
  if ((await details.getAttribute("open")) === null) await details.locator(":scope > summary").click();
  const tab = page.getByRole("tab", { name, ...(opts.exact ? { exact: true } : {}) });
  if (opts.waitOnly) return tab.waitFor();
  return tab.click();
}
