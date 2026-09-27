import { expect, test } from "@playwright/test";

const readXYZ = async (page: import("@playwright/test").Page) => {
  const text = await page.getByText(/^XYZ:/).first().innerText();
  const match = text.match(/XYZ:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not parse player coordinates from: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
};

const distanceXZ = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

test("Buckland Blocks repaired core gameplay", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("WebGL is unavailable")).toHaveCount(0);
  await expect(page.getByText("Buckland Blocks could not start graphics")).toHaveCount(0);

  await page.waitForTimeout(4_000);
  const fpsText = await page.getByText(/^FPS:/).first().innerText();
  console.log(`PLAYTEST_METRIC ${fpsText}`);

  const spawn = await readXYZ(page);
  console.log(`PLAYTEST_SPAWN ${JSON.stringify(spawn)}`);
  expect(Number.isFinite(spawn.x) && Number.isFinite(spawn.y) && Number.isFinite(spawn.z)).toBeTruthy();
  expect(spawn.y).toBeGreaterThan(1);

  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 640, y: 360 } });
  await page.waitForTimeout(300);

  let locked = await page.evaluate(() => document.pointerLockElement instanceof HTMLCanvasElement);
  if (!locked) {
    await canvas.click({ position: { x: 640, y: 360 } });
    await page.waitForTimeout(300);
    locked = await page.evaluate(() => document.pointerLockElement instanceof HTMLCanvasElement);
  }
  console.log(`PLAYTEST_POINTER_LOCK ${locked}`);
  expect(locked).toBeTruthy();

  let moved = false;
  let position = spawn;
  for (const key of ["KeyW", "KeyD", "KeyS", "KeyA"]) {
    const before = position;
    await page.keyboard.down(key);
    await page.waitForTimeout(500);
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
    position = await readXYZ(page);
    if (distanceXZ(before, position) > 0.1) {
      moved = true;
      break;
    }
  }
  console.log(`PLAYTEST_MOVED ${moved} ${JSON.stringify(position)}`);
  expect(moved).toBeTruthy();

  await page.mouse.move(640, 360);
  await page.mouse.move(640, 660, { steps: 8 });
  await page.waitForTimeout(200);
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(230);
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(250);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    if (await page.getByRole("button", { name: "Save World" }).isVisible().catch(() => false)) break;
  }
  await expect(page.getByRole("button", { name: "Save World" })).toBeVisible();
  await page.getByRole("button", { name: "Save World" }).click();
  await expect(page.getByText("World saved.")).toBeVisible();

  const afterMiningSave = await page.evaluate(() => JSON.parse(localStorage.getItem("buckland_blocks_save") || "null"));
  expect(afterMiningSave).not.toBeNull();
  expect(afterMiningSave.version).toBe(2);
  console.log(`PLAYTEST_DIRTY_CHUNKS ${afterMiningSave.chunks.length}`);

  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyE");
  await expect(page.getByText("Inventory", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Wood Planks" }).click();
  await page.getByRole("button", { name: "Empty slot 10" }).click();
  await page.keyboard.press("KeyE");
  await expect(page.getByText("Inventory", { exact: true })).toHaveCount(0);

  await page.keyboard.press("KeyC");
  await expect(page.getByText("Crafting", { exact: true })).toBeVisible();
  const craftButtons = page.getByRole("button", { name: "Craft" });
  await expect(craftButtons.nth(1)).toBeEnabled();
  await craftButtons.nth(1).click();
  await expect(page.getByText("Crafted 4 × Wood Log.")).toBeVisible();
  await page.keyboard.press("KeyC");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Save World" })).toBeVisible();
  await page.getByRole("button", { name: "Save World" }).click();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("buckland_blocks_save") || "null"));
  expect(saved.version).toBe(2);
  expect(saved.playerPosition).toEqual(expect.objectContaining({
    x: expect.any(Number),
    y: expect.any(Number),
    z: expect.any(Number),
  }));
  const woodLogs = saved.inventory.reduce(
    (sum: number, type: number | null, index: number) => sum + (type === 4 ? saved.inventoryCounts[index] : 0),
    0,
  );
  expect(woodLogs).toBeGreaterThanOrEqual(4);
  console.log(`PLAYTEST_SAVED_LOGS ${woodLogs}`);

  const savedPosition = saved.playerPosition;
  await page.screenshot({ path: "test-results/playtest-world.png", fullPage: true });

  await page.reload();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3_000);
  const restored = await readXYZ(page);
  console.log(`PLAYTEST_RESTORED ${JSON.stringify(restored)}`);
  expect(Math.abs(restored.x - savedPosition.x)).toBeLessThan(0.2);
  expect(Math.abs(restored.z - savedPosition.z)).toBeLessThan(0.2);

  await page.keyboard.press("KeyE");
  await expect(page.getByText("Inventory", { exact: true })).toBeVisible();
  const logButton = page.getByRole("button", { name: "Wood Log" });
  await expect(logButton).toBeVisible();
  expect(await logButton.innerText()).toContain("4");

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
