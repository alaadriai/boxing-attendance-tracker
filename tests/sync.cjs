const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.TRACKER_TEST_URL||'http://127.0.0.1:4173';
const mockFirestore=`
const records=new Map([['legacy-1',{courseId:'c1',date:'2026-10-19',time:'20:00',count:21,cancelled:false,ts:{seconds:1}}]]);
const listeners=new Set();
const snapshot=()=>({docs:[...records].map(([id,data])=>({id,data:()=>({...data})})),metadata:{fromCache:false}});
const emit=()=>listeners.forEach(fn=>fn(snapshot()));
window.__mock={records,emit,writes:[],set:(id,data)=>{records.set(id,{...records.get(id),...data});emit();}};
export const getFirestore=()=>({});
export const collection=(_,name)=>({name});
export const doc=(_,collection,id)=>({collection,id});
export const serverTimestamp=()=>({seconds:1234567890});
export const onSnapshot=(ref,options,next,error)=>{
  if(ref.name==='sessions'){listeners.add(next);queueMicrotask(()=>next(snapshot()));return()=>listeners.delete(next);}
  const callback=options;queueMicrotask(()=>callback({exists:()=>false}));return()=>{};
};
export const getDocFromServer=async ref=>({id:ref.id,exists:()=>records.has(ref.id),data:()=>({...records.get(ref.id)})});
export const setDoc=async()=>{};
export const runTransaction=async(_,fn)=>{
  const writes=[];
  await fn({get:async ref=>({exists:()=>records.has(ref.id),data:()=>({...records.get(ref.id)})}),set:(ref,data)=>writes.push([ref.id,data])});
  for(const [id,data] of writes){records.set(id,data);window.__mock.writes.push({id,data});}
  emit();
};
`;
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||'chrome'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('https://www.gstatic.com/firebasejs/**/firebase-app.js',route=>route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});export const getApps=()=>[];'}));
    await context.route('https://www.gstatic.com/firebasejs/**/firebase-firestore.js',route=>route.fulfill({contentType:'text/javascript',body:mockFirestore}));
    await context.route(/firestore\.googleapis\.com/,route=>route.abort());
    const page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date('2026-10-19T18:20:00Z')});
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#headcount')?.value==='21');
    await page.locator('#headcount').fill('22');await page.locator('#save-session').click();
    await page.waitForFunction(()=>window.__mock.records.get('legacy-1').count===22);
    assert.equal(await page.evaluate(()=>window.__mock.records.size),1,'legacy ID is updated in place');
    await page.locator('#headcount').fill('23');
    await page.evaluate(()=>window.__mock.set('legacy-1',{count:30,revision:3,updatedAt:'2026-10-19T18:21:00Z',enteredBy:'another-device'}));
    await page.locator('#save-session').click();
    await page.locator('[data-server]').waitFor();
    assert.equal(await page.evaluate(()=>window.__mock.records.get('legacy-1').count),30,'stale edit must not overwrite another device');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('arete.boxing.v2.queue'))[0].record.count),23,'local conflicting change is preserved');
    await page.locator('[data-server]').click();
    await page.waitForFunction(()=>document.querySelector('#headcount')?.value==='30');
    await context.setOffline(true);
    await page.waitForFunction(()=>!navigator.onLine);
    await page.locator('#headcount').fill('31');await page.locator('#save-session').click();
    assert.equal(await page.evaluate(()=>window.__mock.records.get('legacy-1').count),30);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('arete.boxing.v2.queue')).length),1);
    await context.setOffline(false);
    await page.waitForFunction(()=>window.__mock.records.get('legacy-1').count===31);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('arete.boxing.v2.queue')).length===0);
    assert.deepEqual(errors,[]);
    console.log('Simulated sync passed: legacy IDs preserved, stale edits blocked, conflicting edits recoverable, offline writes queued and synced. No live Firebase data used.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
