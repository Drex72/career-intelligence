/** Strict request and execution budgets for the unsigned-JWT, HMAC-gated worker. */
export const MAX_BODY_BYTES=1500;
export const MAX_BOARDS_PER_RUN=6;
export const MAX_REVIEWS_PER_RUN=8;
export const MAX_ATS_JOBS_PER_BOARD=40;
export function validEnvelope(payload){
  return !!payload &&
    typeof payload.nonce==='string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.nonce) &&
    Number.isSafeInteger(payload.timestamp) &&
    typeof payload.signature==='string' &&
    /^[0-9a-f]{64}$/.test(payload.signature) &&
    Object.keys(payload).length===3;
}
export function selectDueSources(sources, limits, now=Date.now()){
  const lastRun=new Map((limits||[]).map(item=>[item.action,Date.parse(item.last_run_at)]));
  return (sources||[]).filter(src=>src&&src.kind==='ats'&&src.state==='active' &&
    ['greenhouse','lever','ashby'].includes(src.config?.provider)&&
    /^[A-Za-z0-9_-]{1,100}$/.test(src.config?.slug||'') &&
    typeof src.config?.company_name==='string' && src.config.company_name.trim().length>=2)
    .filter(src=>{
      const ts=lastRun.get('ats:'+src.name);
      return !Number.isFinite(ts)||ts<=now-6*3600*1000;
    })
    .sort((a,b)=>(lastRun.get('ats:'+a.name)||0)-(lastRun.get('ats:'+b.name)||0))
    .slice(0,MAX_BOARDS_PER_RUN);
}
