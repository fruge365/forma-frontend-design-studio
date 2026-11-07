'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { createReviewServer } = require('../serve-review.cjs');

async function testReview(page, root) {
  const preview = page.frameLocator('#preview');
  const body = preview.locator('body');
  async function saveNote(target, message, clickOptions) {
    await page.locator('#annotateBtn').click();
    await target.click(clickOptions);
    await page.locator('#noteText').fill(message);
    await page.locator('#noteForm button[type=submit]').click();
    await page.locator('#browseBtn').click();
  }
  async function exported(button) {
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.locator(button).click()
    ]);
    return fs.readFile(await download.path(), 'utf8');
  }
  await page.goto(root+'/?page=proofroom');
  await page.locator('#viewport').selectOption('1024');
  await preview.locator('#mode-overlay').click();
  const slider = preview.locator('#wipe-position');
  await slider.focus();
  await slider.press('Home');
  for (let i=0; i<23; i++) await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(),'23');
  // Clicking the far left in annotation mode targets the artwork without moving its boundary.
  const canvas=preview.locator('#wipe-canvas');
  await canvas.evaluate(el=>el.ownerDocument.defaultView.addEventListener('click',event=>{
    const r=el.getBoundingClientRect();
    el.dataset.testSpot=JSON.stringify([(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height]);
  },{once:true,capture:true}));
  await saveNote(canvas,'复查原稿 23% 的层次',{position:{x:12,y:45}});
  assert.equal(await slider.inputValue(),'23');
  const pin = preview.locator('[data-forma="pin"]');
  await pin.waitFor();
  await preview.locator('#show-a').click();
  await pin.waitFor({state:'hidden'});
  await preview.locator('#mode-split').click();
  await page.getByRole('button',{name:'定位',exact:true}).click();
  assert.equal(await body.getAttribute('data-review-context'),'overlay');
  assert.equal(await slider.inputValue(),'23');
  await pin.waitFor();
  const state=JSON.parse(await exported('#exportJson'));
  assert.equal(state.notes[0].pair,'proofroom-A1-B1');
  assert.equal(state.notes[0].position,23);
  const original=JSON.parse(await canvas.getAttribute('data-test-spot'));
  const displayed=await pin.evaluate(marker=>{
    const r=marker.getBoundingClientRect();
    const art=marker.ownerDocument.querySelector('#wipe-canvas').getBoundingClientRect();
    return [(r.x+r.width/2-art.x)/art.width,(r.y+r.height/2-art.y)/art.height];
  });
  assert.deepEqual(state.notes[0].spot,original.map(n=>Math.round(n*1000)));
  assert.ok(displayed.every((n,i)=>Math.abs(n-original[i])<0.004));
  assert.match(await exported('#exportMd'),/A1 → B1.*原稿可见 23%/);
  const historic={...state.notes[0],id:'older-pair',pair:'proofroom-A0-B0',position:88,text:'上一个版本对'};
  await page.locator('#importFile').setInputFiles({name:'review.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({...state,notes:[historic]}))});
  const older=page.locator('article.annotation').filter({hasText:historic.text});
  await older.getByRole('button',{name:'定位',exact:true}).click();
  assert.match(await page.locator('#toast').innerText(),/A0 → B0/);
  assert.equal(await slider.inputValue(),'23');

  await page.goto(root+'/?page=policy-diff');
  const item=preview.locator('[data-review-id="policy-item-record.edit"]');
  const row=item.locator('xpath=..');
  assert.match(await row.innerText(),/本人经手/);
  assert.match(await row.innerText(),/本编目组/);
  await saveNote(item,'核对权限范围');
  await preview.locator('#open-confirm').click();
  await page.getByRole('button',{name:'定位',exact:true}).click();
  assert.equal(await body.getAttribute('data-review-context'),'confirm');
  await preview.locator('#cancel').click();
  await preview.locator('#tab-history').click();
  assert.ok(await preview.locator('#empty-history').isVisible());
  const bundle=JSON.parse(await exported('#exportJson'));
  assert.equal(bundle.notes.find(n=>n.text==='核对权限范围').pair,'CR-028-V2.4-V2.5');
}

async function main() {
  const server=createReviewServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const options={headless:true,chromiumSandbox:true};
    if(process.env.FORMA_CHROME) options.executablePath=process.env.FORMA_CHROME;
    browser=await chromium.launch(options);
    const page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:960}});
    page.setDefaultTimeout(7000);
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await testReview(page,'http://127.0.0.1:'+server.address().port);
    assert.deepEqual(errors,[]);
    console.log('PASS: annotate without moving the divider, restore comparison, preserve historical version, review without applying.');
  } finally {
    try {if(browser) await browser.close();}
    finally {await new Promise(resolve=>server.close(resolve));}
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
