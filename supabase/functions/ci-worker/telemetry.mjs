/** Only narrowly allowlisted metadata reaches the dashboard event stream.
 * Never record raw ATS descriptions, approved note bodies, tokens or worker env. */
const strings={
 provider:32,board:100,company:120,title:180,location:140,
 format:60,source_job_id:140,job_id:40,source:60,status:40,
 reason:180,work_mode:35,sponsorship:35,knowledge_revision:70,
};
const numbers=new Set(['count','accepted','processed','boards_scanned','reviews','score','confidence','matched','failures']);
const booleans=new Set(['saved','approved','verified']);
export function safePreview(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const result={};
 for(const [k,v] of Object.entries(value)){
  if(Object.hasOwn(strings,k)&&typeof v==='string')result[k]=v.slice(0,strings[k]).replace(/[\r\n\t]/g,' ');
  else if(numbers.has(k)&&typeof v==='number'&&Number.isFinite(v))result[k]=v;
  else if(booleans.has(k)&&typeof v==='boolean')result[k]=v;
 }
 return result;
}
