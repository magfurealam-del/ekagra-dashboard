import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "@supabase/supabase-js"

type Row = Record<string, unknown>
const record = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {}
const text = (v: unknown) => typeof v === "string" ? v : ""
async function equalSecret(a: string, b: string) {
  const encode = new TextEncoder()
  const [x,y] = await Promise.all([a,b].map(v=>crypto.subtle.digest("SHA-256",encode.encode(v))))
  const left=new Uint8Array(x),right=new Uint8Array(y)
  let difference=0
  for(let i=0;i<left.length;i++) difference|=left[i]^right[i]
  return difference===0
}
function localDate(zone: string) {
  const p=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  return ["year","month","day"].map(type=>p.find(x=>x.type===type)?.value).join("-")
}
class SyncError extends Error { constructor(public code: string) {super(code)} }

Deno.serve(async(req: Request)=>{
  if(req.method!=="POST") return new Response("Method Not Allowed",{status:405})
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""
  if(!key || !await equalSecret(req.headers.get("authorization")??"",`Bearer ${key}`))
    return new Response("Unauthorized",{status:401})
  const token=Deno.env.get("META_ADS_TOKEN")
  const db=createClient(Deno.env.get("SUPABASE_URL")??"",key,{auth:{persistSession:false}})
  const {data:run,error:runError}=await db.from("integration_sync_runs")
    .insert({integration:"meta_ads",job_type:"insights_daily"}).select("id").single()
  if(runError) return Response.json({status:"failed",code:"audit_unavailable"},{status:503})
  let seen=0,written=0,failed=0
  const outcomes: Row[]=[]
  const deadline=Date.now()+75_000
  async function graph(path: string) {
    const remaining=Math.max(1,Math.min(15_000,deadline-Date.now()))
    const response=await fetch(`https://graph.facebook.com/v25.0/${path}`,{
      headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(remaining)})
    const json=record(await response.json())
    if(!response.ok || json.error) throw new SyncError(`graph_error_${record(json.error).code??response.status}`)
    return json
  }
  try {
    if(!token) throw new SyncError("meta_ads_token_missing")
    const configured=(Deno.env.get("META_AD_ACCOUNT_IDS")??Deno.env.get("META_AD_ACCOUNT_ID")??"")
      .split(",").map(x=>x.trim().replace(/^act_/,"")).filter(x=>/^[0-9]{5,30}$/.test(x))
    let accounts=[...new Set(configured)]
    if(!accounts.length) {
      const {data,error}=await db.from("meta_active_ads").select("ad_account_id").eq("is_enabled",true).not("ad_account_id","is",null)
      if(error) throw new SyncError("account_lookup_failed")
      const counts=new Map<string,number>()
      for(const row of data??[]) {const id=text(row.ad_account_id).replace(/^act_/,"");if(/^[0-9]{5,30}$/.test(id))counts.set(id,(counts.get(id)??0)+1)}
      accounts=[...counts].filter(([,n])=>n>=2).map(([id])=>id)
    }
    if(!accounts.length) throw new SyncError("no_configured_ad_account")
    if(accounts.length>4) throw new SyncError("account_limit_requires_review")
    for(const account of accounts) {
      let lease: Row={}
      try {
        const info=await graph(`act_${account}?fields=currency,timezone_name`)
        const today=localDate(text(info.timezone_name)||"Asia/Dhaka")
        for(let page=0;page<24 && Date.now()<deadline-15_000;page++) {
          const claimed=await db.rpc("claim_marketing_spend_sync",{p_account_id:account,p_today:today})
          if(claimed.error) throw new SyncError("spend_claim_failed")
          lease=record(claimed.data)
          if(lease.status!=="claimed") {outcomes.push({account,status:lease.status});break}
          const qs=new URLSearchParams({
            fields:"ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,clicks,inline_link_clicks,frequency,ctr,cpc,cpm,actions",
            level:"ad",time_increment:"1",limit:"500",
            time_range:JSON.stringify({since:lease.since,until:lease.until})})
          if(lease.after) qs.set("after",text(lease.after))
          const json=await graph(`act_${account}/insights?${qs}`)
          if(!Array.isArray(json.data)) throw new SyncError('insights_payload_missing_data')
          const rows=json.data.map(record)
          seen+=rows.length
          const paging=record(json.paging)
          const next=paging.next?text(record(paging.cursors).after):null
          if(paging.next && !next) throw new SyncError("paging_cursor_missing")
          const saved=await db.rpc("apply_marketing_spend_page",{
            p_account_id:account,p_token:lease.token,p_today:today,p_currency:info.currency,
            p_rows:rows,p_next_cursor:next})
          if(saved.error) throw new SyncError(`spend_write_${saved.error.code??"failed"}`)
          written+=Number(record(saved.data).rows??0)
          outcomes.push({account,since:lease.since,until:lease.until,rows:rows.length,status:"applied"})
          lease={}
        }
      } catch(error) {
        failed++
        const code=error instanceof SyncError?error.code:"spend_sync_transport_error"
        if(lease.token) await db.rpc("fail_marketing_spend_sync",{p_account_id:account,p_token:lease.token,p_code:code})
        outcomes.push({account,status:"failed",code})
      }
    }
    const status=failed?"partial":"succeeded"
    await db.from("integration_sync_runs").update({status,completed_at:new Date().toISOString(),
      records_seen:seen,records_written:written,records_failed:failed,details:{outcomes}}).eq("id",run.id)
    return Response.json({status,records_written:written,records_failed:failed,outcomes})
  } catch(error) {
    const code=error instanceof SyncError?error.code:"spend_sync_failed"
    await db.from("integration_sync_runs").update({status:"failed",completed_at:new Date().toISOString(),
      records_seen:seen,records_written:written,records_failed:failed+1,error:code}).eq("id",run.id)
    return Response.json({status:"failed",code},{status:503})
  }
})

