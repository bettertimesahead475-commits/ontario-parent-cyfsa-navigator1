const routes=[
['/','What your CAS affidavits really say — and what they don\'t.',null],
['/cas-powers-rights',"CAS Powers, Limits & Parents' Rights",'Your Rights & CAS Powers'],
['/rights','Understand the rights, responsibilities, and family impact.','Your Rights & CAS Powers'],
['/charter-rights','Your Charter Rights During a CAS Interaction','Your Rights & CAS Powers'],
['/cyfsa-procedure','See the procedure CAS must follow and the issue they must establish.','Your Rights & CAS Powers'],
['/investigation','How a CAS Investigation Typically Proceeds','Your Rights & CAS Powers'],
['/five-day-rule','The first five days are crucial. Be prepared for the first hearing — and what comes next.','Court Process'],
['/45-day-roadmap','Turn scattered papers into a 45-day parent action plan.','Court Process'],
['/defense-strategies','The "Least Intrusive Alternative" Principle','Court Process'],
['/cyfsa-guide','Emergency Apprehension Without a Warrant','Court Process'],
['/templates','Sign in to continue','Court Process'],
['/document-analyzer','Sign in to continue','Document Analyzer'],
['/analysis-example','File Analysis & Evidence Strength Report','Document Analyzer'],
['/case-workspace','Sign in to continue','My Case'],
['/lawyers','Ontario Child Welfare Lawyer Directory','Resources'],
['/pricing','Membership Plans & Document Analyzer Access','Resources'],
['/privacy','Privacy Policy & Professional Access Notice','Resources'],
['/data-deletion','Data Deletion Instructions','Resources'],
['/upgrade','Membership Plans & Document Analyzer Access',null,'/pricing'],
['/family-court','Ontario Child Protection Court Lifecycle',null],
['/child-development','Evidence-Based Child Welfare Development Science',null],
['/qa-unknown-route-20261127','What your CAS affidavits really say — and what they don\'t.',null,'/'],
];
const waitHeading=page=>async heading=>{
 await page.getByRole('heading',{name:heading,exact:true}).first().waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>![...document.querySelectorAll('main [aria-busy="true"],main .animate-spin')].some(e=>e.getBoundingClientRect().height>0),null,{timeout:15000});
};

module.exports = {routes,waitHeading};
