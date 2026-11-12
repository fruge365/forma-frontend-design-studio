'use strict';
// Optional developer check. The HTML and the main release suite need no browser dependency.
const { chromium } = require('playwright');
const { createReviewServer } = require('../serve-review.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

async function main() {
  const server = createReviewServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({headless:true, chromiumSandbox:true,
      ...(process.env.UI_CRAFT_CHROME ? {executablePath:process.env.UI_CRAFT_CHROME} : {})});
    const page = await browser.newPage({ viewport:{width:1440,height:960},locale:'zh-CN' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    const frame = page.frameLocator('#preview');
    const anchor = id => frame.locator('[data-review-id="'+id+'"]');
    const noteOn = async (element, message) => {
      await page.locator('#annotateBtn').click();
      await element.click();
      await page.locator('#noteText').fill(message);
      await page.locator('#noteForm button[type=submit]').click();
      await page.locator('#browseBtn').click();
    };
    const exportText = async button => {
      const [download] = await Promise.all([page.waitForEvent('download'),page.locator(button).click()]);
      return fs.readFile(await download.path(), 'utf8');
    };
    await page.goto(url+'/?page=atlas');
    await page.locator('#viewport').selectOption('1440');
    await anchor('atlas-pin-03').click();
    await noteOn(anchor('atlas-detail-03'),'复查第三站的详情标题');
    await anchor('atlas-pin-05').click();
    await anchor('atlas-detail-03').waitFor({state:'hidden'});
    await frame.locator('[data-forma="pin"]').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'定位',exact:true}).click();
    await anchor('atlas-detail-03').waitFor();
    assert.match(await page.locator('#annotations').innerText(),/详情标题 · 地点 03/);
    const data=JSON.parse(await exportText('#exportJson'));
    assert.equal(data.notes[0].selector,'[data-review-id="atlas-detail-03"]');
    assert.match(await exportText('#exportMd'),/空间位置：详情标题 · 地点 03/);
    // A fresh browser context receives only the exported review, not the author's
    // current browsing state, device preferences or warehouse transaction history.
    const fresh = await browser.newPage({viewport:{width:390,height:844}});
    fresh.setDefaultTimeout(8000);
    fresh.on('pageerror',error=>errors.push(error.message));
    await fresh.goto(url+'/?page=atlas');
    await fresh.locator('#importFile').setInputFiles({
      name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await fresh.getByRole('button',{name:'定位',exact:true}).click();
    const restored = fresh.frameLocator('#preview').locator('[data-review-id="atlas-detail-03"]');
    await restored.waitFor();
    assert.equal(await restored.innerText(), await anchor('atlas-detail-03').innerText());

    await page.goto(url+'/?page=depot');
    await page.locator('#viewport').selectOption('1440');
    await anchor('depot-map-B-03').click();
    await noteOn(anchor('depot-detail-B-03'),'核对 B-03 地址');
    await anchor('depot-map-A-01').click();
    await anchor('depot-detail-A-01').waitFor();
    // Reopening a reviewed location must never post a stock count.
    const storageSnapshot = () => frame.locator('body').evaluate(el => {
      const storage=el.ownerDocument.defaultView.localStorage;
      return Object.keys(storage).filter(k=>!k.startsWith('forma-review-v1'))
        .sort().map(k=>[k,storage.getItem(k)]);
    });
    const before = await storageSnapshot();
    const count = await frame.locator('#log-count').innerText();
    await frame.locator('#open-count').click();
    await noteOn(frame.locator('#actual'),'A-01 的实盘数量');
    await frame.locator('#actual').fill('17');
    const locateAddress=page.locator('article.annotation').filter({hasText:'核对 B-03 地址'}).getByRole('button',{name:'定位',exact:true});
    await locateAddress.click();
    assert.equal(await frame.locator('#actual').inputValue(),'17');
    assert.equal(await frame.locator('#count-dialog').evaluate(d=>d.open),true);
    assert.match(await frame.locator('#count-object').innerText(),/A-01/);
    await frame.locator('#cancel-count').click();
    await locateAddress.click();
    await anchor('depot-detail-B-03').waitFor();
    assert.deepEqual(await storageSnapshot(),before);
    assert.equal(await frame.locator('#log-count').innerText(),count);
    assert.match(await page.locator('#annotations').innerText(),/详情标题 · 货位 B-03/);
    const quantityNote = JSON.parse(await exportText('#exportJson')).notes.find(n=>n.text==='A-01 的实盘数量');
    assert.equal(quantityNote.subject,'A-01');
    assert.equal(quantityNote.step,'count');
    await frame.locator('#open-count').click();
    const locateQuantity=page.locator('article.annotation').filter({hasText:'A-01 的实盘数量'}).getByRole('button',{name:'定位',exact:true});
    await locateQuantity.click();
    assert.match(await page.locator('#toast').innerText(),/请打开货位 A-01/);
    assert.match(await frame.locator('#count-object').innerText(),/B-03/);
    assert.equal(await frame.locator('#actual').inputValue(),'');
    await frame.locator('#cancel-count').click();
    await noteOn(anchor('depot-map-B-03'),'从库区平面复查标记');
    await frame.locator('#query').fill('手持扫码器');
    await frame.locator('#state-filter').selectOption('low');
    assert.equal(await anchor('depot-map-B-03').isDisabled(),true);
    await frame.locator('[data-forma="pin"][aria-label*="从库区平面"]').waitFor({state:'hidden'});
    await page.locator('article.annotation').filter({hasText:'从库区平面复查标记'}).getByRole('button',{name:'定位',exact:true}).click();
    assert.equal(await anchor('depot-map-B-03').isEnabled(),true);
    assert.equal(await frame.locator('#query').inputValue(),'手持扫码器');
    assert.equal(await frame.locator('#state-filter').inputValue(),'');
    const prior={schema:'forma-review/v1',version:'7.0',notes:[
      {id:'prior-reader',page:'reader',text:'保留纸色与字号',step:'reading',
       appearance:{theme:'system',resolved:'dark',size:'large',leading:'loose',motion:'reduce'}}
    ],scores:{reader:[5,null,4,5]}};
    await page.locator('#importFile').setInputFiles({
      name:'previous.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prior))});
    await page.waitForFunction(()=>document.querySelector('#count-reader').textContent==='1');
    const combined=JSON.parse(await exportText('#exportJson'));
    assert.deepEqual(combined.notes.find(n=>n.id==='prior-reader').appearance,prior.notes[0].appearance);
    assert.deepEqual(combined.scores.reader,prior.scores.reader);
    assert.equal(combined.notes.length,5);
    assert.deepEqual(errors,[]);
    console.log('PASS: atlas and depot object identity, inactive pins, explicit locate, transfer of notes to a clean browser, intact unsaved count, and read-only warehouse location.');
  } finally {
    try { if(browser) await browser.close(); }
    finally { await new Promise(resolve=>server.close(resolve)); }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});
