const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const base=process.env.TRACKER_TEST_URL||'http://127.0.0.1:4173';
const source={id:'1',courseNumber:'33331117',courseName:'Boxing Level 1',periodStart:'2026-10-19',periodEnd:'2026-12-21',weekday:1,startTime:'20:00',endTime:'21:25',snapshotAt:'2026-10-18T08:00:00Z',pdfName:'synthetic.pdf',names:['Taylor, Alex','Patel, Rosa']};
const registry={kind:'arete-registration-registry',schemaVersion:1,asOf:source.snapshotAt,sources:[source,{...source,id:'2',courseNumber:'33331118',courseName:'Boxing Plus',names:['Lee, Jordan']},{...source,id:'3',courseNumber:'33331147',weekday:4,startTime:'20:30',names:['Lee, Jordan','Taylor, Alex']},{...source,id:'4',courseNumber:'33332117',periodStart:'2026-07-13',periodEnd:'2026-10-05',names:['Lee, Jordan']}]};
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
    const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/firestore|firebase/.test(r.url()))requests.push(r.url());});
    await page.clock.install({time:new Date('2026-10-19T10:00:00Z')});
    await page.goto(base+'/?demo=1');await page.locator('[data-class-people]').click();
    await page.locator('#people-file').setInputFiles({name:'registration_people_private.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(registry))});
    await page.waitForSelector('.person-row');
    assert.equal(await page.locator('.person-row').count(),3,'selected real course combines ordinary and Plus listings');
    await page.locator('#people-search').fill('Jordan Lee');assert.equal(await page.locator('.person-row').count(),1);
    assert.match(await page.locator('.person-row').innerText(),/Both days/);
    assert.match(await page.locator('.person-row').innerText(),/Earlier registration/);
    await page.locator('[data-person-key]').click();assert.match(await page.locator('#modal').innerText(),/13 Jul 2026/);
    await page.locator('[data-close]').click();
    await page.locator('#people-search').fill('');
    await page.screenshot({path:'test-results/desktop-people.png',fullPage:true});
    await page.reload();await page.waitForSelector('.person-row');assert.equal(await page.locator('.person-row').count(),3,'registry survives reload');
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
      assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'people view fits mobile');
      assert.ok(await page.locator('#navigation').evaluate(el=>el.scrollWidth<=innerWidth),'five navigation items fit mobile');
      await page.screenshot({path:`test-results/people-mobile-${width}.png`,fullPage:true});
    }
    await page.locator('[data-clear-people]').click();await page.locator('[data-confirm-clear-people]').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('arete.people.demo.v1')),null);
    assert.equal(requests.length,0,'private registry never triggers Firebase requests in preview');
    assert.deepEqual(errors,[]);console.log('People view passed: private file import, latest roster, same-slot deduplication, search, paired-day indicator, history, persistence, removal, mobile layouts, no Firebase requests.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
