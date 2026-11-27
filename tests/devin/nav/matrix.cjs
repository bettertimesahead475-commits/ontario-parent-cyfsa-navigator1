module.exports = async function run(qa) {
 const {page,fs,OUT}=qa;
 const { routes } = require('./routes.cjs');
 qa.results=[];qa.menuResults=[];
 const norm=t=>t.replace(/\s+/g,' ').trim();
 const wait = qa.waitHeading;
 for(const [name,width,height] of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  await page.goto('https://cyfsanavigator.com/',{waitUntil:'domcontentloaded'});
  await wait(routes[0][1]);
  for(const [route,heading,group,redirect] of routes){
   const start=Date.now(),result={viewport:name,width,height,route,expectedHeading:heading,expectedPath:redirect||route};
   const prior=new URL(page.url()).pathname;
   try{
    // Navigate by the visible header for all advertised menu destinations.
    if(group||route==='/'){
     await page.evaluate(()=>scrollTo(0,0));
     const root=width<768?'#mobile-nav-panel':'#desktop-routing-rail';
     if(width<768&&!await page.locator(root).count())await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
     if(group){
      const details=page.locator(root+' details').filter({has:page.locator('summary').filter({hasText:group})});
      if(!await details.getAttribute('open').then(x=>x!==null))await details.locator('summary').click();
      await details.locator(`a[href="${route}"]`).click();
     } else await page.locator(`${root} a[href="/"]`).click();
     if(width<768)result.mobileMenuClosed=await page.locator(root).count()===0;
    }else await page.goto('https://cyfsanavigator.com'+route,{waitUntil:'domcontentloaded'});
    await wait(heading);
    result.loadedMs=Date.now()-start;
    result.heading=true; result.actualPath=new URL(page.url()).pathname;
    result.path=result.actualPath===(redirect||route);
    if(width>=768)for(const summary of await page.locator('#desktop-routing-rail details[open] summary').all())await summary.click();
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?null:new Promise(r=>{i.onload=r;i.onerror=r;setTimeout(r,3000)})));});
    result.layout=await page.evaluate(()=>{
     const w=innerWidth;const overflow=[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>w+1||r.left< -1)}).slice(0,15).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,80),x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width}));
     return {innerWidth:w,documentScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,overflow};
    });
    result.screenshot=`${OUT}/${name}-${route==='/'?'home':route.slice(1)}.png`;
    await page.screenshot({path:result.screenshot,fullPage:true});
    await page.reload({waitUntil:'domcontentloaded'});await wait(heading);
    result.refresh=true;
    if(prior!==result.actualPath){
     await page.goBack({waitUntil:'domcontentloaded'});await page.waitForTimeout(150);
     result.back=new URL(page.url()).pathname===prior;
     result.backActual=new URL(page.url()).pathname;
     await page.goForward({waitUntil:'domcontentloaded'});await wait(heading);
     result.forward=new URL(page.url()).pathname===result.actualPath;
    }else result.history='not exercised: same route';
    result.headings=(await page.locator('main h1,main h2').allTextContents()).map(norm);
   }catch(e){result.error=e.message;await page.screenshot({path:OUT+`/${name}-${route.slice(1)||'home'}-error.png`,fullPage:true}).catch(()=>{});}
   qa.results.push(result);fs.writeFileSync(OUT+'/matrix.json',JSON.stringify(qa.results,null,2));
   console.log(name,route,result.error||'checked');
  }
 }
 return {total:qa.results.length,errors:qa.results.filter(r=>r.error),failedChecks:qa.results.filter(r=>r.path===false||r.back===false||r.forward===false||r.mobileMenuClosed===false||r.layout?.documentScrollWidth>r.width||r.layout?.bodyScrollWidth>r.width)};
};
