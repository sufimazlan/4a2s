import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test('home screen shows the UI and the 3D character', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '4a2s' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try face tracking' })).toBeVisible();

  const canvas = page.locator('#stage canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box?.width).toBe(viewport.width);
  expect(box?.height).toBe(viewport.height);

  // The UI panel must fit on screen (no horizontal overflow on phones).
  const panel = await page.locator('.home-panel').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);

  expect(errors).toEqual([]);
});

test('is installable: manifest, icons and service worker', async ({ page, request }) => {
  await page.goto('/');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await (await request.get(manifestHref!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get('/' + icon.src)).ok()).toBe(true);
  }
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);

  const swActive = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
  expect(swActive).toBe(true);
});

test('face tracking screen starts and stops the camera', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try face tracking' }).click();
  await expect(page).toHaveURL(/#\/scan$/);
  await expect(page.getByRole('heading', { name: 'Face tracking test' })).toBeVisible();

  // The 3D stage is paused while the camera is in use.
  await expect(page.locator('#stage')).toBeHidden();

  const video = page.locator('video.cam-feed');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);

  const track = await video.evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);

  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page.getByRole('heading', { name: '4a2s' })).toBeVisible();
  await expect(page.locator('#stage')).toBeVisible();
  expect(await track.evaluate((t: MediaStreamTrack) => t.readyState)).toBe('ended');
});
