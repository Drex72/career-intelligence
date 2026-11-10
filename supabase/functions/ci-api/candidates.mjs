/** Untrusted feed links are *candidates*, never verified company identities. */
const ATS_HOSTS={
  'boards.greenhouse.io':'greenhouse',
  'job-boards.greenhouse.io':'greenhouse',
  'jobs.lever.co':'lever',
  'jobs.ashbyhq.com':'ashby',
};
const slug=/^[a-zA-Z0-9_-]{1,100}$/;
const httpLink=/https:\/\/[^\s"'<>\\]+/gi;
export function candidateBoards(description, company, sourceURL) {
  if(typeof company!=='string'||company.trim().length<2||company.trim().length>180 ||
     typeof sourceURL!=='string'||!(/^(?:https:\/\/remotive\.com\/remote-jobs\/|https:\/\/himalayas\.app\/companies\/[A-Za-z0-9_-]+\/jobs\/[A-Za-z0-9_-]+$)/.test(sourceURL)))
    return [];
  const input=String(description||'').slice(0,50000).replaceAll('&amp;','&');
  const found=new Map();
  for(const raw of input.match(httpLink)||[]){
    let url;
    try{url=new URL(raw.replace(/[),.;]+$/g,''));}catch{continue;}
    if(url.protocol!=='https:'||url.port||url.username||url.password)continue;
    const provider=ATS_HOSTS[url.hostname];
    if(!provider)continue;
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts.length<2||!slug.test(parts[0]))continue;
    if(url.searchParams.has('redirect')||url.searchParams.has('next'))continue;
    const source=provider+':'+parts[0];
    if(!found.has(source)) found.set(source,{
      provider,slug:parts[0],company:company.trim(),evidenceURL:sourceURL
    });
    if(found.size>=5)break;
  }
  return [...found.values()];
}
