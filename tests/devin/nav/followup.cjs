async function checkWidgets(page, out, viewport) {
 const selectors = {
  glossary: '#legal-terminology-floating-btn',
  narrator: '#tts-floating-trigger-btn',
  statutoryDesk: '#statutory-bookmark-toggle-tab',
  coach: 'button[title="Open Educational Case Advisor Chat"]',
 };
 await page.goto('https://cyfsanavigator.com/analysis-example', {waitUntil:'domcontentloaded'});
 await Promise.all(Object.values(selectors).map(selector =>
  page.locator(selector).waitFor({state:'visible',timeout:10000}).catch(()=>{})));
 const checks = await page.evaluate(selectors => {
  const visible = [], missing = [], clipped = [], blocked = [], overlaps = [];
  for (const [name, selector] of Object.entries(selectors)) {
   const element = document.querySelector(selector);
   const rect = element?.getBoundingClientRect();
   if (!rect?.width || !rect.height || getComputedStyle(element).visibility === 'hidden') {
    missing.push(name);
    continue;
   }
   visible.push({name, rect});
   if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) clipped.push(name);
   const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
   if (!element.contains(hit)) blocked.push(name);
  }
  for (let i = 0; i < visible.length; i++) {
   const {name, rect:a} = visible[i];
   for (const {name:other, rect:b} of visible.slice(i+1)) {
    if (Math.min(a.right,b.right)-Math.max(a.left,b.left) > 1 &&
        Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > 1) overlaps.push([name,other]);
   }
  }
  return {missing, clipped, blocked, overlaps};
 }, selectors);
 const screenshot = out + '/widgets-' + viewport + '.png';
 await page.screenshot({path:screenshot});
 const content = [];
 for (const [heading, card, offset] of [['Document Checked','section',0],['Firsthand Knowledge','article',650]]) {
  const region = page.locator('main ' + card).filter({has:page.getByRole('heading',{name:heading,exact:true})});
  await region.waitFor({state:'visible'});
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}), offset);
  const obstructing = await region.evaluate((element, selectors) => {
   const widgets = Object.entries(selectors).map(([name, selector])=>[name, document.querySelector(selector)]);
   const obstructing = new Set();
   const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
   for (let text; (text=walker.nextNode());) {
    if (!text.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const line of range.getClientRects()) {
     for (const [name, widget] of widgets) {
      if (!widget || obstructing.has(name)) continue;
      const rect = widget.getBoundingClientRect();
      const left = Math.max(line.left,rect.left,0), right = Math.min(line.right,rect.right,innerWidth);
      const top = Math.max(line.top,rect.top,0), bottom = Math.min(line.bottom,rect.bottom,innerHeight);
      if (right-left<=1 || bottom-top<=1) continue;
      for (const x of [0.25,0.5,0.75]) {
       for (const y of [0.25,0.5,0.75]) {
        if (widget.contains(document.elementFromPoint(left+(right-left)*x,top+(bottom-top)*y))) obstructing.add(name);
       }
      }
     }
    }
   }
   return [...obstructing];
  }, selectors);
  const screenshot = out + '/widgets-' + viewport + '-' + offset + '.png';
  await page.screenshot({path:screenshot});
  content.push({heading,offset,obstructing,screenshot});
 }
 const pass = Object.values(checks).every(items=>!items.length) && content.every(item=>!item.obstructing.length);
 return {viewport,...checks,content,screenshot,pass};
}

module.exports = async function run(qa) {
 const {page,fs,OUT}=qa;qa.followup={history:[],directory:[],duplicateMenu:[],widgets:[]};
 for(const [viewport,width,height] of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  for(const [route,expected] of [['/upgrade','/pricing'],['/qa-unknown-route-20261127','/']]){
   await page.goto('https://cyfsanavigator.com/data-deletion',{waitUntil:'domcontentloaded'});
   await qa.waitHeading('Data Deletion Instructions');
   const trace=[{step:'prior page',url:page.url(),historyLength:await page.evaluate(()=>history.length)}];
   await page.goto('https://cyfsanavigator.com'+route,{waitUntil:'domcontentloaded'});
   await qa.waitHeading(qa.routes.find(r=>r[0]===route)[1]);
   trace.push({step:'deep link redirected',url:page.url(),historyLength:await page.evaluate(()=>history.length)});
   await page.screenshot({path:OUT+`/history-${viewport}-${route==='/upgrade'?'upgrade':'unknown'}-before-back.png`});
   await page.goBack({waitUntil:'domcontentloaded'});await page.waitForTimeout(700);
   trace.push({step:'Back once',url:page.url(),historyLength:await page.evaluate(()=>history.length)});
   await page.screenshot({path:OUT+`/history-${viewport}-${route==='/upgrade'?'upgrade':'unknown'}-after-back.png`});
   await page.goBack({waitUntil:'domcontentloaded'});await page.waitForTimeout(700);
   trace.push({step:'Back twice',url:page.url(),historyLength:await page.evaluate(()=>history.length)});
   qa.followup.history.push({viewport,width,height,route,expectedAfterBack:'/data-deletion',backOncePassed:new URL(trace[2].url).pathname==='/data-deletion',trace});
  }
  const idx=qa.events.length;
  await page.goto('https://cyfsanavigator.com/lawyers',{waitUntil:'domcontentloaded'});
  await qa.waitHeading('Ontario Child Welfare Lawyer Directory');await page.waitForTimeout(2500);
  await page.screenshot({path:OUT+`/directory-${viewport}-404.png`,fullPage:true});
  qa.followup.directory.push({viewport,width,height,text:await page.locator('main').innerText(),events:qa.events.slice(idx),loading:await page.evaluate(()=>window.__qaLoading)});
  // Same destination is a separate advertised menu item under My Case.
  const root=width<768?'#mobile-nav-panel':'#desktop-routing-rail';
  await page.evaluate(()=>scrollTo(0,0));
  if(width<768)await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
  const details=page.locator(root+' details').filter({has:page.locator('summary').filter({hasText:'My Case'})});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  await details.locator('a[href="/templates"]').click();
  await qa.waitHeading('Sign in to continue');
  qa.followup.duplicateMenu.push({viewport,url:page.url(),mobileClosed:width<768?await page.locator(root).count()===0:null});
  qa.followup.widgets.push(await checkWidgets(page, OUT, viewport));
 }
 fs.writeFileSync(OUT+'/followup.json',JSON.stringify(qa.followup,null,2));
 return qa.followup;
};
