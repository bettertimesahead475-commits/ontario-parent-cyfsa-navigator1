module.exports = async function run(qa) {
 const {page,fs,OUT,events}=qa;
 qa.stable=[];const eventStart=events.length;
 for(const [viewport,width,height] of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  for(const [route,heading,,redirect] of qa.routes){
   const result={viewport,width,height,route,expectedPath:redirect||route,expectedHeading:heading};const start=Date.now(),idx=events.length;
   try{
    await page.goto('https://cyfsanavigator.com'+route,{waitUntil:'networkidle',timeout:30000});
    await qa.waitHeading(heading);await page.waitForTimeout(2100);
    result.durationMs=Date.now()-start;
    result.loading=await page.evaluate(()=>window.__qaLoading);
    result.actualPath=new URL(page.url()).pathname;
    result.layout=await page.evaluate(()=>({innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));
    result.screenshot=OUT+`/${viewport}-${route.slice(1)||'home'}.png`;
    await page.screenshot({path:result.screenshot,fullPage:true});
   }catch(e){result.error=e.message;}
   result.events=events.slice(idx);
   qa.stable.push(result);fs.writeFileSync(OUT+'/stable.json',JSON.stringify(qa.stable,null,2));
  }
 }
 return {count:qa.stable.length,errors:qa.stable.filter(x=>x.error),events:events.slice(eventStart)};
};
