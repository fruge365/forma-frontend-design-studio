'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { createReviewServer } = require('../serve-review.cjs');

async function checkReview(page, base) {
  const preview = page.frameLocator('#preview');
  async function annotate(element, text) {
    await page.locator('#annotateBtn').click();
    await element.click();
    await page.locator('#noteText').fill(text);
    await page.locator('#noteForm button[type=submit]').click();
    await page.locator('#browseBtn').click();
  }
  async function exported(button) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),page.locator(button).click()
    ]);
    return fs.readFile(await download.path(),'utf8');
  }
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(base+'/?page=programme');
  await page.locator('#viewport').selectOption('1024');
  await preview.locator('[data-save="P01"]').click();
  await preview.locator('[data-day="D2"]').click();
  await preview.locator('[data-save="P05"]').click();
  await preview.locator('#preview-mine').click();
  await annotate(preview.locator('[data-review-id="programme-proof-P05"]'),'核对跨日节目');
  const pin = preview.locator('[data-forma="pin"]');
  await pin.waitFor();
  assert.match(await page.locator('#annotations').innerText(),/我的节目 · P01、P05/);
  await page.emulateMedia({media:'print'});
  assert.equal(await pin.isVisible(),false);
  await page.emulateMedia({media:'screen'});
  await pin.waitFor();
  await preview.locator('#scope-day').click();
  await pin.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'定位',exact:true}).click();
  assert.match(await page.locator('#toast').innerText(),/P01、P05/);
  assert.equal(await preview.locator('body').getAttribute('data-review-proof'),'DAY/D2');
  await preview.locator('#scope-mine').click();
  await pin.waitFor();
  assert.match(await exported('#exportMd'),/纸面范围：我的节目 · P01、P05/);

  await page.goto(base+'/?page=handover');
  await preview.locator('#draft-note').fill('交接前复核冷却记录');
  await preview.locator('#preview-draft').click();
  const draft = await preview.locator('body').getAttribute('data-review-proof');
  await annotate(preview.locator('#doc-title'),'核对交接草稿的标题');
  await preview.locator('#back-desk').click();
  await preview.locator('#draft-note').fill('由接班人补录巡检时间');
  await preview.locator('#preview-draft').click();
  const revised = await preview.locator('body').getAttribute('data-review-proof');
  assert.notEqual(draft,revised);
  await pin.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'定位',exact:true}).click();
  assert.match(await page.locator('#toast').innerText(),/交班草稿/);
  assert.equal(await preview.locator('body').getAttribute('data-review-proof'),revised);
  await preview.locator('#issue-document').click();
  const originalId=await preview.locator('#paper-id').innerText();
  await annotate(preview.locator('#doc-title'),'核对归档单号');
  await preview.locator('#back-desk').click();
  await preview.locator('#draft-note').fill('晚间交接前复核');
  await preview.locator('#preview-draft').click();
  await preview.locator('#issue-document').click();
  assert.notEqual(await preview.locator('#paper-id').innerText(),originalId);
  const issuePin=preview.locator('[data-forma="pin"][aria-label*="归档单号"]');
  await issuePin.waitFor({state:'hidden'});
  await preview.locator('#back-desk').click();
  await preview.locator('#open-archive').click();
  await preview.locator('[data-document="'+originalId+'"]').click();
  await issuePin.waitFor();
  const bundle=JSON.parse(await exported('#exportJson'));
  assert.equal(bundle.notes.find(n=>n.text==='核对交接草稿的标题').proof,draft);
  assert.equal(bundle.notes.find(n=>n.text==='核对归档单号').proof,'ISSUED/'+originalId);
  assert.equal(bundle.notes.find(n=>n.page==='programme').proof,'MINE/P01,P05');
  // Import an old spatial note together with an unrecognised print scope.
  // Keep the latter's words without pinning them to an unrelated version.
  const old = {schema:'forma-review/v1',version:'8.0',scores:{atlas:[5,null,4,5]},notes:[
    {id:'old',page:'atlas',text:'四跨梁桥',selector:'[data-review-id="atlas-detail-03"]'},
    {id:'unknown',page:'programme',text:'保留说明',step:'print',proof:'MINE/P99',selector:'#print-sheet'}
  ]};
  await page.locator('#importFile').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(old))});
  await page.waitForFunction(()=>document.querySelector('#count-atlas').textContent==='1');
  const combined=JSON.parse(await exported('#exportJson'));
  assert.equal(combined.notes.find(n=>n.id==='old').selector,old.notes[0].selector);
  assert.deepEqual(combined.scores.atlas,old.scores.atlas);
  const unknown=combined.notes.find(n=>n.id==='unknown');
  assert.equal(unknown.text,'保留说明');
  assert.equal(unknown.selector,'');
  assert.deepEqual(errors,[]);
}
async function main(){
  const server=createReviewServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const options={headless:true,chromiumSandbox:true};
    if(process.env.FORMA_CHROME) options.executablePath=process.env.FORMA_CHROME;
    browser=await chromium.launch(options);
    const page=await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN'});
    page.setDefaultTimeout(7000);
    await checkReview(page,'http://127.0.0.1:'+server.address().port);
    console.log('PASS: print scope, draft revision, overlay removal, feedback export and compatibility.');
  } finally {
    try {if(browser) await browser.close();}
    finally {await new Promise(resolve=>server.close(resolve));}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
