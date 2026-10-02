const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const {
  history, dayAnalysis, dailyUsage, weeklyUsage, monthlyUsage, dataRange
} = require('./store.cjs');

const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>电量使用分析</title>
<style>
:root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#172033;background:#f4f6fa}
*{box-sizing:border-box}body{margin:0;padding:22px}.wrap{max-width:1420px;margin:auto}
h1{margin:0;font-size:28px}h2{margin:0;font-size:18px}.subtitle{color:#708097;font-size:13px;margin-top:5px}
.topbar,.toolbar,.section-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.topbar{justify-content:space-between;margin-bottom:15px}
.toolbar{margin-bottom:14px}.status{margin-left:auto;font-size:13px;color:#607086}
button,input,select{border-radius:9px;padding:9px 12px;border:1px solid #ccd5e3;background:white;color:#23314a}
button{background:#1f6feb;color:white;border:0;font-weight:600;cursor:pointer}button.secondary{background:#e7edf8;color:#223655}
button.ghost{background:white;color:#26364f;border:1px solid #ccd5e3}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e2e7ef;border-radius:16px;padding:17px;box-shadow:0 4px 16px rgba(30,45,75,.05)}
.label{font-size:13px;color:#718096}.value{font-size:28px;font-weight:700;margin-top:5px}.small{font-size:12px;color:#748197;margin-top:6px}
.good{color:#08783e}.bad{color:#b42318}.muted{color:#69768a}
.section{margin-top:18px}.section-head{justify-content:space-between;margin-bottom:10px}
.date-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.summary-chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.chip{background:#eef3fb;border-radius:999px;padding:7px 11px;font-size:12px;color:#3a4a65}
.chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.long-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.chart-card{height:350px}.chart-card canvas{width:100%;height:285px;display:block}.chart-title{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:6px}
.chart-note{font-size:11px;color:#8390a4}
.table-card{padding:0;overflow:hidden}.table-head{padding:14px 16px;border-bottom:1px solid #e6eaf1;display:flex;justify-content:space-between;align-items:center}
.table-wrap{max-height:470px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 12px;border-bottom:1px solid #edf0f5;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}thead th{position:sticky;top:0;background:#f8fafc;color:#536078;z-index:1}
.estimate{color:#ad6800}.no-data{color:#9aa5b4}.tooltip{position:fixed;display:none;pointer-events:none;z-index:100;background:rgba(20,29,45,.94);color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5;box-shadow:0 5px 18px rgba(0,0,0,.2);max-width:260px}
.legend{display:flex;gap:12px;align-items:center;font-size:11px;color:#758198}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:#1f6feb}.dot.est{background:#d97706}
@media(max-width:1050px){.long-grid{grid-template-columns:1fr}.chart-grid{grid-template-columns:1fr}}
@media(max-width:600px){body{padding:11px}.value{font-size:24px}.status{width:100%;margin-left:0}.chart-card{height:320px}.chart-card canvas{height:255px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div><h1>电量使用分析</h1><div class="subtitle">每分钟采样 · 日 / 周 / 月用量统计 · 断档区间自动标注估算</div></div>
    <div class="legend"><span><i class="dot"></i>正常采样</span><span><i class="dot est"></i>断档估算</span></div>
  </div>

  <div class="toolbar">
    <button id="refresh">立即刷新</button>
    <button class="secondary" id="login">重新登录</button>
    <span class="status" id="status">连接中...</span>
  </div>

  <div class="grid">
    <div class="card"><div class="label">当前剩余电量</div><div class="value" id="remain">--</div><div class="small" id="meterTime">--</div></div>
    <div class="card"><div class="label">今日记录用电</div><div class="value" id="todayUsage">--</div><div class="small" id="todayEst">--</div></div>
    <div class="card"><div class="label">本周记录用电</div><div class="value" id="weekUsage">--</div><div class="small" id="weekEst">--</div></div>
    <div class="card"><div class="label">本月记录用电</div><div class="value" id="monthUsage">--</div><div class="small" id="monthEst">--</div></div>
    <div class="card"><div class="label">采集状态</div><div class="value" style="font-size:20px" id="auth">--</div><div class="small" id="sampleTime">--</div></div>
  </div>

  <section class="section">
    <div class="section-head">
      <div><h2>当天详细分析</h2><div class="subtitle">选择任意有记录的日期，查看当天每个采样时间点和每小时用量</div></div>
      <div class="date-controls">
        <button class="ghost" id="prevDay">← 前一天</button>
        <input type="date" id="dayPicker">
        <button class="ghost" id="nextDay">后一天 →</button>
        <button class="ghost" id="todayBtn">今天</button>
        <button class="secondary" id="csvBtn">导出当天 CSV</button>
      </div>
    </div>
    <div class="summary-chips">
      <span class="chip" id="dayUsed">当天用电：--</span>
      <span class="chip" id="dayRecharge">充值/补入：--</span>
      <span class="chip" id="dayStart">起始电量：--</span>
      <span class="chip" id="dayEnd">结束电量：--</span>
      <span class="chip" id="coverage">采样覆盖：--</span>
      <span class="chip" id="estimated">断档估算：--</span>
    </div>
    <div class="chart-grid">
      <div class="card chart-card">
        <div class="chart-title"><span class="label">当天剩余电量曲线</span><span class="chart-note">虚线表示采样间隔超过 3 分钟</span></div>
        <canvas id="dayLine"></canvas>
      </div>
      <div class="card chart-card">
        <div class="chart-title"><span class="label">当天每小时用电量</span><span class="chart-note">长时间断档按时间比例分摊</span></div>
        <canvas id="hourBars"></canvas>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>长期用电趋势</h2><div class="subtitle">用于看作息、周末差异和月度变化 · <span id="rangeNote">历史起点：--</span></div></div></div>
    <div class="long-grid">
      <div class="card chart-card"><div class="chart-title"><span class="label">每日用电 · 最近 31 天</span></div><canvas id="dailyBars"></canvas></div>
      <div class="card chart-card"><div class="chart-title"><span class="label">每周用电 · 最近 12 周</span></div><canvas id="weeklyBars"></canvas></div>
      <div class="card chart-card"><div class="chart-title"><span class="label">每月用电 · 最近 12 个月</span></div><canvas id="monthlyBars"></canvas></div>
    </div>
  </section>

  <section class="section">
    <div class="card table-card">
      <div class="table-head"><div><strong>当天原始采样记录</strong><div class="subtitle">每一分钟的剩余电量都会保留；断档后第一条记录会显示间隔时长</div></div><span class="small" id="rowCount">0 条</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>采样时间</th><th>剩余电量</th><th>该间隔用电</th><th>充值/补入</th><th>距上次采样</th><th>电表更新时间</th></tr></thead>
          <tbody id="rawRows"></tbody>
        </table>
      </div>
    </div>
  </section>
</div>
<div class="tooltip" id="tip"></div>
<script>
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):'--';
const fmt4=n=>Number.isFinite(Number(n))?Number(n).toFixed(4):'--';
let selectedDay=null, dayData=null, longData={daily:[],weekly:[],monthly:[]}, rangeData=null;

function setupCanvas(c){
  const rect=c.getBoundingClientRect(), d=window.devicePixelRatio||1;
  c.width=Math.max(320,Math.floor(rect.width*d)); c.height=Math.max(220,Math.floor(rect.height*d));
  const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  c._hover=[];
  return {ctx,w:c.width,h:c.height,d};
}
function emptyChart(ctx,w,h,d,text='暂无数据'){
  ctx.fillStyle='#98a3b3';ctx.font=13*d+'px Segoe UI';ctx.textAlign='center';ctx.fillText(text,w/2,h/2);ctx.textAlign='left';
}
function showTip(ev,html){const t=$('tip');t.innerHTML=html;t.style.display='block';t.style.left=Math.min(innerWidth-280,ev.clientX+14)+'px';t.style.top=Math.min(innerHeight-120,ev.clientY+14)+'px'}
function hideTip(){$('tip').style.display='none'}
function bindHover(c){
  if(c._hoverBound)return;c._hoverBound=true;
  c.addEventListener('mousemove',ev=>{
    const r=c.getBoundingClientRect(),d=devicePixelRatio||1,x=(ev.clientX-r.left)*d,y=(ev.clientY-r.top)*d;
    let best=null,bestDist=Infinity;
    for(const p of c._hover||[]){
      let dist;
      if(p.rect){dist=(x>=p.rect.x&&x<=p.rect.x+p.rect.w&&y>=p.rect.y&&y<=p.rect.y+p.rect.h)?0:Math.abs(x-(p.rect.x+p.rect.w/2))}
      else dist=Math.abs(x-p.x);
      if(dist<bestDist){bestDist=dist;best=p}
    }
    if(best&&bestDist<35*d)showTip(ev,best.html);else hideTip();
  });c.addEventListener('mouseleave',hideTip);
}
function drawDayLine(){
  const c=$('dayLine'),{ctx,w,h,d}=setupCanvas(c);bindHover(c);
  const rows=dayData?.samples||[];if(!rows.length)return emptyChart(ctx,w,h,d);
  const parts=selectedDay.split('-').map(Number),start=new Date(parts[0],parts[1]-1,parts[2]).getTime(),end=new Date(parts[0],parts[1]-1,parts[2]+1).getTime();
  const pL=52*d,pR=18*d,pT=18*d,pB=34*d,vals=rows.map(x=>+x.remain),mn=Math.min(...vals),mx=Math.max(...vals),spread=Math.max(.02,mx-mn),lo=mn-spread*.08,hi=mx+spread*.08;
  ctx.strokeStyle='#e0e6ef';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pT+(h-pT-pB)*i/4;ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(w-pR,y);ctx.stroke();const val=hi-(hi-lo)*i/4;ctx.fillStyle='#6f7d91';ctx.font=11*d+'px Segoe UI';ctx.fillText(val.toFixed(2),5*d,y+4*d)}
  for(let i=0;i<=4;i++){const x=pL+(w-pL-pR)*i/4;ctx.fillStyle='#6f7d91';ctx.font=11*d+'px Segoe UI';ctx.textAlign='center';ctx.fillText(String(i*6).padStart(2,'0')+':00',x,h-9*d);ctx.textAlign='left'}
  const px=t=>pL+(w-pL-pR)*(t-start)/(end-start),py=v=>pT+(h-pT-pB)*(hi-v)/(hi-lo);
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],gap=(+b.epochMs-+a.epochMs)/1000;
    ctx.save();ctx.strokeStyle=gap>180?'#d97706':'#1f6feb';ctx.lineWidth=2.2*d;ctx.setLineDash(gap>180?[6*d,5*d]:[]);
    ctx.beginPath();ctx.moveTo(px(+a.epochMs),py(+a.remain));ctx.lineTo(px(+b.epochMs),py(+b.remain));ctx.stroke();ctx.restore();
  }
  rows.forEach((r,i)=>{const x=px(+r.epochMs),y=py(+r.remain);c._hover.push({x,y,html:'<b>'+r.sampledAt.slice(11,19)+'</b><br>剩余电量：'+fmt(r.remain)+(i?'<br>距上次：'+Math.round((+r.epochMs-+rows[i-1].epochMs)/1000)+' 秒':'')})});
}
function drawBars(id,rows,labelFn,opts={}){
  const c=$(id),{ctx,w,h,d}=setupCanvas(c);bindHover(c);
  const valid=(rows||[]).filter(x=>x.sampleCount>0);
  if(!valid.length)return emptyChart(ctx,w,h,d);
  const pL=48*d,pR=12*d,pT=18*d,pB=42*d,max=Math.max(.01,...valid.map(x=>+x.used||0));
  ctx.strokeStyle='#e0e6ef';for(let i=0;i<=4;i++){const y=pT+(h-pT-pB)*i/4;ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(w-pR,y);ctx.stroke();ctx.fillStyle='#6f7d91';ctx.font=11*d+'px Segoe UI';ctx.fillText((max*(1-i/4)).toFixed(2),5*d,y+4*d)}
  const all=rows||[],step=(w-pL-pR)/Math.max(1,all.length),bw=Math.max(2,step*.62);
  all.forEach((r,i)=>{
    const x=pL+i*step+(step-bw)/2,val=+r.used||0,barH=(h-pT-pB)*val/max,y=h-pB-barH;
    const missing=!(r.sampleCount>0),estimated=(+r.estimatedUsed||0)>0.0001;
    ctx.fillStyle=missing?'#e8edf4':estimated?'#d97706':'#4f8df7';
    const dh=missing?2*d:Math.max(2*d,barH);ctx.fillRect(x,h-pB-dh,bw,dh);
    const every=opts.labelEvery||1;if(i%every===0||i===all.length-1){ctx.fillStyle='#6f7d91';ctx.font=10*d+'px Segoe UI';ctx.textAlign='center';ctx.fillText(labelFn(r,i),x+bw/2,h-15*d);ctx.textAlign='left'}
    c._hover.push({rect:{x,y:h-pB-Math.max(dh,12*d),w:bw,h:Math.max(dh,12*d)},html:'<b>'+ (r.key||r.label) +'</b><br>'+(missing?'无采样数据':'用电：'+fmt4(r.used)+'<br>充值/补入：'+fmt4(r.recharged)+(estimated?'<br><span style="color:#fbbf24">其中估算：'+fmt4(r.estimatedUsed)+'</span>':'')+'<br>采样：'+r.sampleCount+' 条')});
  });
}
function renderTable(){
  const rows=dayData?.samples||[];$('rowCount').textContent=rows.length+' 条';
  $('rawRows').innerHTML=rows.slice().reverse().map((r,ri)=>{
    const idx=rows.length-1-ri,prev=idx>0?rows[idx-1]:null,gap=prev?(+r.epochMs-+prev.epochMs)/1000:null,long=gap>180;
    return '<tr><td>'+r.sampledAt.slice(11,19)+(long?' <span class="estimate">断档后</span>':'')+'</td><td>'+fmt(r.remain)+'</td><td>'+fmt4(r.used)+'</td><td>'+fmt4(r.recharged)+'</td><td class="'+(long?'estimate':'')+'">'+(gap==null?'--':gap<120?Math.round(gap)+' 秒':(gap/60).toFixed(1)+' 分钟')+'</td><td>'+(r.serverUpdatedAt||'--')+'</td></tr>'
  }).join('');
}
function renderDay(){
  const s=dayData?.summary||{};$('dayUsed').textContent='当天用电：'+fmt4(s.used);$('dayRecharge').textContent='充值/补入：'+fmt4(s.recharged);$('dayStart').textContent='起始电量：'+fmt(s.firstRemain);$('dayEnd').textContent='结束电量：'+fmt(s.lastRemain);$('coverage').textContent='采样覆盖：'+(s.coveragePercent??0)+'% · '+(s.sampleCount||0)+' 条';$('estimated').textContent='断档估算：'+fmt4(s.estimatedUsed);
  drawDayLine();drawBars('hourBars',dayData?.hourly||[],r=>r.label,{labelEvery:3});renderTable();
}
async function loadDay(date){
  selectedDay=date;$('dayPicker').value=date;dayData=await fetch('/api/analysis/day?date='+encodeURIComponent(date)).then(r=>r.json());renderDay();
}
async function loadOverview(){
  const [s,r,d,w,m]=await Promise.all([
    fetch('/api/status').then(r=>r.json()),fetch('/api/analysis/range').then(r=>r.json()),
    fetch('/api/analysis/daily?days=31').then(r=>r.json()),fetch('/api/analysis/weekly?weeks=12').then(r=>r.json()),fetch('/api/analysis/monthly?months=12').then(r=>r.json())
  ]);
  rangeData=r;longData={daily:d,weekly:w,monthly:m};
  $('remain').textContent=s.current?fmt(s.current.remain):'--';$('meterTime').textContent=s.current?.server_updated_at?'电表更新时间：'+s.current.server_updated_at:'暂无数据';
  $('todayUsage').textContent=fmt4(s.todayUsage);$('todayEst').textContent=s.estimatedToday>0?'其中估算 '+fmt4(s.estimatedToday):'全部来自连续采样';
  $('weekUsage').textContent=fmt4(s.weekUsage);$('weekEst').textContent=s.estimatedWeek>0?'其中估算 '+fmt4(s.estimatedWeek):'暂无断档估算';
  $('monthUsage').textContent=fmt4(s.monthUsage);$('monthEst').textContent=s.estimatedMonth>0?'其中估算 '+fmt4(s.estimatedMonth):'暂无断档估算';
  $('sampleTime').textContent=s.lastSampleAt?'最后采样：'+s.lastSampleAt:'尚未采样';$('auth').textContent=s.auth==='ok'?'运行正常':s.auth==='required'?'需要重新登录':'正在检查';$('auth').className='value '+(s.auth==='ok'?'good':s.auth==='required'?'bad':'muted');$('status').textContent=s.lastError?'错误：'+s.lastError:'每 '+s.intervalSeconds+' 秒自动刷新';
  $('dayPicker').min=r.firstDate||'';$('dayPicker').max=r.today||'';$('rangeNote').textContent='历史起点：'+(r.firstDate||'暂无数据');
  drawBars('dailyBars',d,r=>r.label,{labelEvery:5});drawBars('weeklyBars',w,r=>r.label,{labelEvery:2});drawBars('monthlyBars',m,r=>r.label,{labelEvery:2});
  if(!selectedDay)await loadDay(r.lastDate||r.today);
}
function moveDay(delta){const p=selectedDay.split('-').map(Number),d=new Date(p[0],p[1]-1,p[2]+delta);const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');if(rangeData?.today&&k>rangeData.today)return;loadDay(k)}
function exportCsv(){
  if(!dayData?.samples?.length)return;const rows=[['采样时间','剩余电量','该间隔用电','充值/补入','距上次采样秒数','电表更新时间']];
  dayData.samples.forEach((r,i)=>rows.push([r.sampledAt,r.remain,r.used,r.recharged,i?(+r.epochMs-+dayData.samples[i-1].epochMs)/1000:'',r.serverUpdatedAt||'']));
  const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='electricity-'+selectedDay+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
$('refresh').onclick=async()=>{$('status').textContent='正在刷新...';await fetch('/api/force-refresh',{method:'POST'});await loadOverview();if(selectedDay===rangeData?.today)await loadDay(selectedDay)};
$('login').onclick=async()=>{await fetch('/api/open-login',{method:'POST'});$('status').textContent='已打开登录窗口，完成登录后会自动保存'};
$('dayPicker').onchange=e=>loadDay(e.target.value);$('prevDay').onclick=()=>moveDay(-1);$('nextDay').onclick=()=>moveDay(1);$('todayBtn').onclick=()=>loadDay(rangeData.today);$('csvBtn').onclick=exportCsv;
window.onresize=()=>{renderDay();drawBars('dailyBars',longData.daily,r=>r.label,{labelEvery:5});drawBars('weeklyBars',longData.weekly,r=>r.label,{labelEvery:2});drawBars('monthlyBars',longData.monthly,r=>r.label,{labelEvery:2})};
loadOverview().catch(e=>{$('status').textContent='加载失败：'+e.message});
const es=new EventSource('/events');es.addEventListener('reading',async()=>{await loadOverview();if(selectedDay===rangeData?.today)await loadDay(selectedDay)});es.addEventListener('status',()=>loadOverview());
setInterval(()=>loadOverview().catch(()=>{}),60000);
</script>
</body></html>`;

function json(res, value, status=200) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function startDashboard(options) {
  const { port, getStatus, sampleNow } = options;
  const clients = new Set();

  function push(type, payload) {
    const msg='event: '+type+'\ndata: '+JSON.stringify(payload)+'\n\n';
    for(const res of [...clients]){try{res.write(msg)}catch{clients.delete(res)}}
  }

  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    res.setHeader('Cache-Control','no-store');
    try {
      if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html)}
      if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.statusCode=204;return res.end()}
      if(req.method==='GET'&&url.pathname==='/api/status')return json(res,getStatus());
      if(req.method==='GET'&&url.pathname==='/api/history')return json(res,history(url.searchParams.get('hours')||24));
      if(req.method==='GET'&&url.pathname==='/api/analysis/range')return json(res,dataRange());
      if(req.method==='GET'&&url.pathname==='/api/analysis/day')return json(res,dayAnalysis(url.searchParams.get('date')||dataRange().today));
      if(req.method==='GET'&&url.pathname==='/api/analysis/daily')return json(res,dailyUsage(url.searchParams.get('days')||31));
      if(req.method==='GET'&&url.pathname==='/api/analysis/weekly')return json(res,weeklyUsage(url.searchParams.get('weeks')||12));
      if(req.method==='GET'&&url.pathname==='/api/analysis/monthly')return json(res,monthlyUsage(url.searchParams.get('months')||12));
      if(req.method==='GET'&&url.pathname==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('event: status\ndata: '+JSON.stringify(getStatus())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return}
      if(req.method==='POST'&&url.pathname==='/api/force-refresh')return json(res,await sampleNow('manual'));
      if(req.method==='POST'&&url.pathname==='/api/open-login'){const child=spawn(process.execPath,[path.join(__dirname,'login.cjs')],{cwd:__dirname,detached:true,stdio:'ignore',windowsHide:false});child.unref();return json(res,{ok:true})}
      res.statusCode=404;res.end('not found');
    } catch(error) {
      json(res,{ok:false,error:String(error.message||error)},400);
    }
  });

  server.listen(port,'127.0.0.1');
  return {server,push};
}

module.exports={startDashboard};
