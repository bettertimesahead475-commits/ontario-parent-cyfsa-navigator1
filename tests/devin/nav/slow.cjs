module.exports = async function run(qa) {
 const {page,context,fs,OUT}=qa;
 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');
 await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 qa.slow=qa.slow||[];
 for(const [viewport,width,height] of (qa.slowViewports||[['desktop',1440,900],['mobile',390,844]])){
  await page.setViewportSize({width,height});
  for(const route of ['/','/analysis-example','/cyfsa-guide','/document-analyzer']){
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:2000,downloadThroughput:50000,uploadThroughput:50000,connectionType:'cellular3g'});
   // Avoid a cached back-forward entry or JS module cache: every navigation is a document load.
   const result={viewport,width,height,route,network:{latencyMs:2000,downBytesPerSec:50000,upBytesPerSec:50000,cacheDisabled:true}};
   const start=Date.now();
   const nav=page.goto('https://cyfsanavigator.com'+route,{waitUntil:'domcontentloaded',timeout:120000}).catch(e=>{result.navigationError=e.message});
   await page.waitForTimeout(15050);
   result.at15s=await page.evaluate(()=>({elapsed:performance.now(),text:document.body?.innerText?.slice(0,250),busy:[...document.querySelectorAll('[aria-busy="true"],.animate-spin')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height}).map(e=>({tag:e.tagName,aria:e.getAttribute('aria-busy')})),heading:[...document.querySelectorAll('main h1,main h2')].map(e=>e.textContent)})).catch(e=>({error:e.message}));
   result.screenshotAt15=OUT+`/slow-${viewport}-${route.slice(1)||'home'}-15s.png`;
   await page.screenshot({path:result.screenshotAt15}).catch(()=>{});
   await nav;
   const heading=qa.routes.find(r=>r[0]===route)[1];
   try {await page.getByRole('heading',{name:heading,exact:true}).first().waitFor({timeout:120000});result.headingMs=Date.now()-start;}
   catch(e){result.error=e.message;}
   result.final=await page.evaluate(()=>({time:performance.now(),loading:window.__qaLoading,busy:document.querySelectorAll('main [aria-busy="true"],main .animate-spin').length,headings:[...document.querySelectorAll('main h1,main h2')].map(e=>e.textContent)}));
   await page.screenshot({path:OUT+`/slow-${viewport}-${route.slice(1)||'home'}-final.png`,fullPage:true});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
   qa.slow.push(result);fs.writeFileSync(OUT+'/slow.json',JSON.stringify(qa.slow,null,2));
  }
 }
 await cdp.detach();
 return qa.slow;
};
