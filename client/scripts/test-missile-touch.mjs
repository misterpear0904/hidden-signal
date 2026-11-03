// Real-browser touch regression check against the production component and CSS.
// Run the bounded suite from client: node scripts/test-missile-touch.mjs
// Add small and large mobile viewports plus repeat/corner stress: TOUCH_STRESS=1 node scripts/test-missile-touch.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fixture = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import '/src/index.css';
      import Game from '/src/components/missileCommand/MissileCommandGame.tsx';
      window.__actions = [];
      const record = name => value => window.__actions.push({ name, value });
      const side = new URLSearchParams(location.search).get('side') || 'bottom';
      const mc = {
        sides: { top: side === 'top' ? 'me' : 'enemy', bottom: side === 'bottom' ? 'me' : 'enemy' },
        gridCols: 13, gridRows: 7, buildings: {}, pending: {}, rubble: {}, missiles: [],
        resources: { me: 1000, enemy: 1000 }, gameStartTime: Date.now(),
        fogOfWar: false, fogHistory: false,
      };
      createRoot(document.getElementById('root')).render(React.createElement(Game, {
        roomState: { missileCommandState: mc, players: [], phase: 'missile-command' },
        myId: 'me', isHost: true,
        onBuild: record('build'), onUpgrade: record('upgrade'), onSell: record('sell'),
        onCancelSell: record('cancelSell'), onRebuild: record('rebuild'), onLoad: record('load'),
        onLaunch: record('launch'), onLaunchType: record('launchType'), onSetKeepFire: record('keepFire'),
        onFireDesperation: record('desperation'), onClaimSupplyShip: record('claimSupplyShip'),
        onPlayAgain: record('playAgain'),
      }));`;
const server = await createServer({
  server: { port: 0 }, logLevel: 'error',
  plugins: [{ name: 'touch-fixture',
    resolveId: id => id === '/touch-fixture.js' ? '\0touch-fixture' : null,
    load: id => id === '\0touch-fixture' ? fixture : null,
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/touch-fixture') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/touch-fixture',
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><div id="root"></div><script type="module" src="/touch-fixture.js"></script>'));
      });
    },
  }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  const context = await browser.newContext({ hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://localhost:${server.httpServer.address().port}/touch-fixture`;
  const close = page.getByRole('button', { name: 'Close dialog' });
  const dockOrientation = page.locator('button[title*="dock"]');
  const cdp = await context.newCDPSession(page);
  const dispatch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 0.72 })),
  });
  const tap = async (x, y, drift = [1, 1], hold = 85) => {
    await dispatch('touchStart', [[x, y]]);
    await new Promise(resolve => setTimeout(resolve, hold));
    await dispatch('touchMove', [[x + drift[0], y + drift[1]]]);
    await new Promise(resolve => setTimeout(resolve, 25));
    await dispatch('touchEnd', []);
    await new Promise(resolve => setTimeout(resolve, 45));
  };
  const position = async (side, gx, gy, fx = 0.5, fy = 0.5) => page.locator('svg').first().evaluate(
    (svg, { side, gx, gy, fx, fy }) => {
      const p = new DOMPoint(10 + (gx + fx) * 980 / 13, (side === 'top' ? 10 : 580) + (gy + fy) * 410 / 7)
        .matrixTransform(svg.getScreenCTM());
      const hit = document.elementFromPoint(p.x, p.y);
      return { x: p.x, y: p.y, hitSvg: !!hit?.closest('svg'), hitTag: hit?.tagName, hitClass: String(hit?.getAttribute('class') || '') };
    }, { side, gx, gy, fx, fy });
  const visibleMapPoint = async (side, width, height) => {
    for (const [gx, gy] of [[6,3],[3,3],[9,3],[6,1],[6,5],[3,1],[9,5],[0,3],[12,3]]) {
      const p = await position(side, gx, gy);
      if (p.hitSvg && p.x > 30 && p.y > 30 && p.x < width - 30 && p.y < height - 30) return { ...p, gx, gy };
    }
    throw new Error(`${side}: no visible map point available for pan/tap`);
  };
  const visiblePinchPoint = async (side, width, height) => {
    for (const [gx, gy] of [[6,3],[3,3],[9,3],[6,1],[6,5],[3,1],[9,5],[0,3],[12,3]]) {
      const p = await position(side, gx, gy);
      if (!p.hitSvg || p.x <= 30 || p.y <= 30 || p.x >= width - 30 || p.y >= height - 30) continue;
      const contactsHit = await page.evaluate(({ x, y }) => [-22, 22].every(dx =>
        document.elementFromPoint(x + dx, y)?.closest('svg')), p);
      if (contactsHit) return { ...p, gx, gy };
    }
    throw new Error(`${side}: no visible map pair available for pinch`);
  };
  const dismiss = async () => {
    // Let the production dialog entrance animation finish before measuring.
    await page.waitForTimeout(350);
    const box = await close.boundingBox();
    assert.ok(box, 'close button should be visible');
    await tap(box.x + box.width / 2, box.y + box.height / 2, [0, 1]);
    await close.waitFor({ state: 'detached' });
  };

  const boundaryOnly = process.env.TOUCH_BOUNDARY_ONLY === '1';
  const stress = process.env.TOUCH_STRESS === '1' || boundaryOnly;
  const viewports = stress
    ? [
        { width: 320, height: 568, name: 'small portrait' },
        { width: 390, height: 844, name: 'portrait' },
        { width: 412, height: 915, name: 'large portrait' },
        { width: 568, height: 320, name: 'small landscape' },
        { width: 844, height: 390, name: 'landscape' },
        { width: 915, height: 412, name: 'large landscape' },
      ]
    : [{ width: 390, height: 844, name: 'portrait' }, { width: 844, height: 390, name: 'landscape' }];
  const testedTotal = { mapOpenings: 0, backdropDismissals: 0, obscured: 0 };
  const driftCycle = [[0, 0], [2, -1], [-4, 3], [6, 0], [1, -6]];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const side of ['top', 'bottom']) {
      await page.goto(`${url}?side=${side}`);
      await page.locator('svg').first().waitFor();
      await page.waitForTimeout(250);

      // Test a spread of rows and columns, and report points hidden by the real HUD/dock.
      const cells = boundaryOnly ? [[8,1]] : [[0,0],[3,0],[6,0],[8,1],[9,0],[12,0],[0,3],[3,3],[6,3],[9,3],[12,3],[0,6],[3,6],[6,6],[9,6],[12,6]];
      const obscured = [];
      let tested = 0;
      let sampleIndex = 0;
      const dockBefore = await dockOrientation.getAttribute('title');
      const actionsBefore = await page.evaluate(() => window.__actions.length);
      for (const [gx, gy] of cells) {
        const points = stress && !boundaryOnly && [[0,0],[6,3],[12,6],[8,1]].some(([x, y]) => gx === x && gy === y)
          ? [[0.5,0.5],[0.12,0.12],[0.88,0.12],[0.12,0.88],[0.88,0.88]]
          : [[0.5,0.5]];
        for (const [fx, fy] of points) {
          const p = await position(side, gx, gy, fx, fy);
          if (p.x < 2 || p.y < 2 || p.x >= viewport.width - 2 || p.y >= viewport.height - 2 || !p.hitSvg) {
            obscured.push({ cell: `${gx + 1},${gy + 1}`, spot: `${fx},${fy}`, hit: `${p.hitTag}.${p.hitClass}` });
            testedTotal.obscured++;
            continue;
          }
          const drift = stress ? driftCycle[sampleIndex % driftCycle.length] : [1, -1];
          const hold = stress ? [60, 83, 106, 129, 150][sampleIndex % 5] : 85;
          await tap(p.x, p.y, drift, hold);
          const heading = page.getByText(`🔨 Build (${gx + 1}, ${gy + 1})`, { exact: true });
          await heading.waitFor();
          await page.waitForTimeout(35);
          assert.equal(await close.count(), 1, `${viewport.name} ${side} (${gx + 1},${gy + 1}): menu should remain open after one touch`);
          assert.equal(await page.evaluate(() => window.__actions.length), actionsBefore, 'map touch must not trigger build actions');
          await dismiss();
          assert.equal(await dockOrientation.getAttribute('title'), dockBefore, 'map tap must not toggle dock orientation');
          tested++;
          testedTotal.mapOpenings++;
          sampleIndex++;
        }
      }
      assert.ok(tested >= (boundaryOnly ? 0 : 3), `${viewport.name} ${side}: expected unobscured targets, got ${tested}`);
      console.log(`PASS: ${viewport.name} ${side} island, ${tested} touch positions across ${cells.length} cells; obscured by visible HUD/dock: ${obscured.length}${obscured.length ? ` (${obscured.map(p => `${p.cell}@${p.spot}`).join(' ')})` : ''}`);

      if (stress) {
        // Exercise repeated open + touch on the actual backdrop, when the scrim is clear.
        const p = await visibleMapPoint(side, viewport.width, viewport.height);
        await tap(p.x, p.y, driftCycle[sampleIndex % driftCycle.length], [60, 83, 106, 129, 150][sampleIndex % 5]);
        await close.waitFor();
        testedTotal.mapOpenings++;
        const backdropHit = await page.evaluate(() => {
          const hit = document.elementFromPoint(2, 2);
          return hit && getComputedStyle(hit).position === 'fixed' && getComputedStyle(hit).zIndex === '500';
        });
        if (backdropHit) {
          await tap(2, 2, [1, 0], 95);
          await close.waitFor({ state: 'detached' });
          testedTotal.backdropDismissals++;
        } else {
          await dismiss();
          console.log(`NOTE: ${viewport.name} ${side}: backdrop point (2,2) covered; closed via touch close button`);
        }
      }

      // Pinch and drag far enough to pan the map. Both pinch contacts must land on the map.
      const pinchPoint = await visiblePinchPoint(side, viewport.width, viewport.height);
      const x = pinchPoint.x, y = pinchPoint.y;
      await dispatch('touchStart', [[x - 22, y], [x + 22, y]]);
      await new Promise(resolve => setTimeout(resolve, 90));
      await dispatch('touchMove', [[x - 14, y], [x + 14, y]]);
      await new Promise(resolve => setTimeout(resolve, 90));
      await dispatch('touchEnd', []);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await close.count(), 0, 'pinch must not open a menu');
      const panStart = await visibleMapPoint(side, viewport.width, viewport.height);
      assert.ok(panStart.hitSvg, `${viewport.name} ${side}: pan start must hit SVG`);
      await dispatch('touchStart', [[panStart.x, panStart.y]]);
      await new Promise(resolve => setTimeout(resolve, 80));
      await dispatch('touchMove', [[panStart.x + 12, panStart.y + 4]]);
      await new Promise(resolve => setTimeout(resolve, 35));
      await dispatch('touchMove', [[panStart.x + 27, panStart.y + 8]]);
      await new Promise(resolve => setTimeout(resolve, 35));
      await dispatch('touchMove', [[panStart.x + 40, panStart.y + 10]]);
      await new Promise(resolve => setTimeout(resolve, 25));
      await dispatch('touchEnd', []);
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal(await close.count(), 0, 'real pan must not open a menu');
      // The viewBox moved, so calculate the map location again for the fresh tap.
      const postPan = await visibleMapPoint(side, viewport.width, viewport.height);
      assert.ok(postPan.hitSvg, `${viewport.name} ${side}: post-pan fresh tap must hit SVG`);
      await tap(postPan.x, postPan.y, [2, -1], 85);
      await close.waitFor();
      if (stress) testedTotal.mapOpenings++;
      const dialogHeading = await page.locator('text=/🔨 Build \\([0-9]+, [0-9]+\\)/').first().textContent();
      const target = dialogHeading.match(/\(([0-9]+), ([0-9]+)\)/);
      assert.equal(Number(target[1]) - 1, postPan.gx, 'fresh post-pan tap should open its intended column');
      assert.equal(Number(target[2]) - 1, postPan.gy, 'fresh post-pan tap should open its intended row');
      await page.waitForTimeout(650); // allow the production 600ms popup guard to arm
      const buildChoice = page.getByRole('button', { name: /Generator/ }).first();
      const buildBox = await buildChoice.boundingBox();
      assert.ok(buildBox, 'build choice should be visible and reachable after opening');
      await tap(buildBox.x + buildBox.width / 2, buildBox.y + buildBox.height / 2, [1, 0], 90);
      await close.waitFor({ state: 'detached' });
      const actions = await page.evaluate(() => window.__actions);
      assert.equal(actions.at(-1)?.name, 'build', 'touch menu selection should call onBuild');
      assert.equal(actions.at(-1)?.value.gx, Number(target[1]) - 1);
      assert.equal(actions.at(-1)?.value.gy, Number(target[2]) - 1);
      console.log(`PASS: ${viewport.name} ${side} pinch, pan, fresh tap and touch build selection`);
    }
  }
  assert.deepEqual(errors, [], 'no browser errors');
  if (stress) console.log(`${boundaryOnly ? 'BOUNDARY' : 'STRESS'} TOTAL: ${testedTotal.mapOpenings} successful map-opening taps, ${testedTotal.backdropDismissals} backdrop dismissals, ${testedTotal.obscured} sampled map positions obscured by visible UI.`);
} finally {
  await browser?.close();
  await server.close();
}
