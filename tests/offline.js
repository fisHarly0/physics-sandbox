/* 单文件分发契约：只复制 HTML，以 file:// 打开；不启动服务器或暴露模块内部状态。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runScenario, withBrowser } = require('./driver');

async function settings(h) {
  await h.tools();
  await h.clickEl('.tbtn[data-tool="settings"]');
  await h.step(2);
}

async function smoke(h) {
  await h.step(10);
  assert.equal(await h.eval(() => location.protocol), 'file:');
  assert.ok(await h.eval(() => document.getElementById('cv').width > 0), 'canvas initialized');
  await settings(h);
  await h.clickEl('#recbtn');
  const startedAt = await h.eval(() => __H.now());
  await h.clickEl('#sclose');

  // 通过真实指针绘制矩形，再从导出的记录检查重力、复制和拖动结果。
  await h.tools();
  await h.clickEl('.tbtn[data-tool="shape"]');
  await h.clickEl('#tsub .tbtn[data-shape="rect"]');
  await h.drag(300, 200, 380, 260, 10);
  await h.clickEl('#ttoggle');
  await h.step(120);
  const fallenAt = await h.eval(() => __H.now());

  // 空心矩形从边框命中；内部空白不是绘制物体的命中区域。
  await h.click(300, 580, 'right');
  assert.ok(await h.eval(() => {
    const item = document.querySelector('#menu [data-act="copy"]');
    return item && !item.classList.contains('hide') &&
      getComputedStyle(document.getElementById('menu')).display !== 'none';
  }), 'copy action visible for the drawn body');
  await h.clickEl('#menu [data-act="copy"]');
  await h.step(90);
  const copiedAt = await h.eval(() => __H.now());

  // 副本可能挤动原物体，从画布找到左侧边框，不依赖模块内部变量。
  const edge = await h.eval(() => {
    const cv = document.getElementById('cv');
    const pixels = cv.getContext('2d').getImageData(0, 580, cv.width, 1).data;
    for (let x = 100; x < 800; x++) {
      if (pixels[x * 4 + 3] > 140 && pixels[x * 4] < 120) return x;
    }
    return null;
  });
  assert.notEqual(edge, null, 'a rectangle edge is visible above the ground');
  await h.drag(edge, 580, 460, 250, 14);
  await h.step(5);
  const draggedAt = await h.eval(() => __H.now());
  await settings(h);
  await h.clickEl('#recbtn');
  assert.ok(await h.eval(() => document.getElementById('bugbox').classList.contains('on')),
    'stopping the recording opens the export dialog');
  await h.clickEl('#bugdl');
  const payload = await h.eval(() => JSON.parse(localStorage.getItem('__LAST_REC__')));
  assert.equal(payload?.kind, 'sandbox-rec', 'download action also saves the export JSON');
  assert.ok(payload.frames.length > 100, 'recorded simulation frames');
  assert.ok(payload.events.some(e => e.ty === 'down'), 'recorded pointer actions');

  // recStart precedes startedAt by a frame; keep comparisons away from action boundaries.
  const rectangles = f => f.bs.filter(b => b.k === 'W' && b.s === 'rect');
  const beforeCopy = payload.frames.filter(f => f.t < fallenAt - startedAt);
  const falling = beforeCopy.flatMap(rectangles);
  assert.ok(falling.length > 20, 'drawn rectangle is present in the simulation');
  assert.ok(Math.max(...falling.map(b => b.y)) - Math.min(...falling.map(b => b.y)) > 100,
    'rectangle falls under gravity');
  const copied = payload.frames.filter(f => f.t > fallenAt - startedAt + 500 &&
    f.t < copiedAt - startedAt);
  assert.ok(copied.some(f => rectangles(f).length === 2), 'copy creates a second physical rectangle');
  const dragged = payload.frames.filter(f => f.t > copiedAt - startedAt &&
    f.t < draggedAt - startedAt);
  assert.ok(dragged.some(f => rectangles(f).some(b => b.x > 480 && b.y < 300)),
    'pointer drag moves a physical rectangle to the target');
  await h.clickEl('#bugclose');
  assert.equal(await h.eval(() => document.getElementById('bugbox').classList.contains('on')), false);
  await h.step(10);
  console.log(`ok   offline draw / gravity / copy / drag / export JSON (${payload.frames.length} frames)`);
}

(async () => {
  const rootArg = process.argv.find(a => a.startsWith('--root='));
  const root = rootArg ? path.resolve(rootArg.slice(7)) : path.join(__dirname, '..', 'dist');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'build first: npm run build');
  // Include spaces and Unicode to exercise file URL encoding on Windows as well.
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox offline 单文件-'));
  try {
    const entry = path.join(isolated, 'index.html');
    fs.copyFileSync(path.join(root, 'index.html'), entry);
    await withBrowser(async browser => {
      const result = await runScenario(browser, pathToFileURL(entry).href, smoke);
      assert.equal(result.fail, null, result.fail || 'offline scenario');
      assert.deepEqual(result.errors, [], 'no page errors or external resource requests');
    });
    console.log('ok   isolated file:// HTML, no external resources or page errors');
  } finally {
    // The directory contains only our copied HTML; do not recursively remove anything.
    const entry = path.join(isolated, 'index.html');
    if (fs.existsSync(entry)) fs.unlinkSync(entry);
    fs.rmdirSync(isolated);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
