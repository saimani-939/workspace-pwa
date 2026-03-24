import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────
const PRIORITIES = { high: "#FF4D6D", medium: "#FFAA00", low: "#00C9A7" };
const TASK_TYPES = ["Task","Test","Interview","Meeting","Deadline","Event","Study","Other"];
const TYPE_ICONS = { Task:"✦",Test:"📝",Interview:"💼",Meeting:"🤝",Deadline:"⚑",Event:"★",Study:"📖",Other:"◎" };
const TYPE_COLORS = { Task:"#4A90D9",Test:"#FF6B9D",Interview:"#A78BFA",Meeting:"#34D399",Deadline:"#FF4D6D",Event:"#FFAA00",Study:"#00C9A7",Other:"#7A8CA8" };
const CATEGORIES = ["Work","Personal","Study","Health","Creative","Other"];
const RES_CATS = ["AI Tool","Website","Design","Dev","Learning","Productivity","Other"];
const CAT_COLORS = {"AI Tool":"#4A90D9","Website":"#00C9A7","Design":"#FF6B9D","Dev":"#FFAA00","Learning":"#A78BFA","Productivity":"#34D399","Other":"#7A8CA8"};
const NOTE_COLORS = ["#1A2540","#1A2520","#251A20","#25201A","#1A1A30","#251A30"];

// ─── Helpers ──────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0,10); }
function tomorrowStr() { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
function daysFromNow(ds) { const d=new Date(ds+"T00:00:00"),t=new Date(); t.setHours(0,0,0,0); return Math.round((d-t)/86400000); }
function fmtDate(d) { if(!d) return ""; return new Date(d+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); }
function fmtTime(t) { if(!t) return ""; const [h,m]=t.split(":").map(Number); return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`; }
function isOverdue(task) {
  if(task.done) return false;
  const today=todayStr();
  if(task.date<today) return true;
  if(task.date===today&&task.time) { const n=new Date(),[h,m]=task.time.split(":").map(Number); return n.getHours()>h||(n.getHours()===h&&n.getMinutes()>m); }
  return false;
}
function minutesUntil(task) {
  if(!task.date||!task.time) return null;
  return Math.round((new Date(`${task.date}T${task.time}`)-new Date())/60000);
}
function ls(key, fallback) { try { const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; } catch { return fallback; } }
function lsSet(key, val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch {} }

// ─── Sample Data ──────────────────────────────────────
const today = todayStr(), tomorrow = tomorrowStr();
const SAMPLE_TASKS = [
  {id:1,title:"Morning review",date:today,time:"09:00",priority:"high",type:"Task",category:"Work",done:false,notes:"Check emails and plan the day"},
  {id:2,title:"JavaScript Interview",date:tomorrow,time:"11:00",priority:"high",type:"Interview",category:"Work",done:false,notes:"Revise DSA, system design basics"},
  {id:3,title:"React Unit Test",date:tomorrow,time:"14:00",priority:"high",type:"Test",category:"Study",done:false,notes:"Components, hooks, lifecycle"},
];
const SAMPLE_NOTES = [
  {id:1,title:"Ideas 💡",content:"• Build a portfolio website\n• Learn system design\n• Read Clean Code book",color:"#1A2540",pinned:true,updated:Date.now()},
  {id:2,title:"Interview Prep 💼",content:"Topics:\n- DSA: Arrays, Trees, Graphs\n- System Design basics\n- React hooks & lifecycle\n- REST vs GraphQL",color:"#251A20",pinned:true,updated:Date.now()-3600000},
];
const SAMPLE_RES = [
  {id:1,name:"Claude AI",url:"https://claude.ai",category:"AI Tool",usage:"Writing, coding, brainstorming, analysis",tags:["ai","writing"],fav:true},
  {id:2,name:"Figma",url:"https://figma.com",category:"Design",usage:"UI/UX design, wireframing",tags:["design","ui"],fav:true},
  {id:3,name:"Notion",url:"https://notion.so",category:"Productivity",usage:"Notes, docs, project management",tags:["notes","pm"],fav:false},
];

// ─── Push Notification Helper ─────────────────────────
async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function scheduleTaskReminder(task, sw) {
  if (!task.date || !task.time || task.done) return;
  const mins = minutesUntil(task);
  if (mins === null || mins < 0 || mins > 1440) return;
  // 15 min before
  const delay15 = (mins - 15) * 60 * 1000;
  // At time
  const delayNow = mins * 60 * 1000;
  if (delay15 > 0 && sw) {
    sw.postMessage({ type:"SCHEDULE_REMINDER", title:`⏰ In 15 min: ${task.title}`, body:`${TYPE_ICONS[task.type]||"✦"} ${task.type} at ${fmtTime(task.time)}${task.notes?` — ${task.notes}`:""}`, delay: delay15 });
  }
  if (delayNow > 0 && sw) {
    sw.postMessage({ type:"SCHEDULE_REMINDER", title:`🔔 Now: ${task.title}`, body:`${TYPE_ICONS[task.type]||"✦"} ${task.type} starting now!${task.notes?` — ${task.notes}`:""}`, delay: delayNow });
  }
}

function showLocalNotification(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/icons/icon-192.png" });
  }
}

// ═══════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [tasks, setTasks] = useState(() => ls("wp_tasks", SAMPLE_TASKS));
  const [notes, setNotes] = useState(() => ls("wp_notes", SAMPLE_NOTES));
  const [resources, setResources] = useState(() => ls("wp_resources", SAMPLE_RES));
  const [notifGranted, setNotifGranted] = useState(Notification?.permission === "granted");
  const [toasts, setToasts] = useState([]);
  const [swReg, setSwReg] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const reminderFired = useRef(new Set());

  // Persist
  useEffect(() => { lsSet("wp_tasks", tasks); }, [tasks]);
  useEffect(() => { lsSet("wp_notes", notes); }, [notes]);
  useEffect(() => { lsSet("wp_resources", resources); }, [resources]);

  // Clock
  useEffect(() => { const t=setInterval(()=>setClock(new Date()),1000); return ()=>clearInterval(t); },[]);

  // SW registration
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(reg => setSwReg(reg));
    }
  }, []);

  // PWA install prompt
  useEffect(() => {
    const handler = e => { e.preventDefault(); setInstallPrompt(e); setShowInstall(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // In-app reminder checker (every 30s)
  useEffect(() => {
    const check = () => {
      tasks.forEach(task => {
        if (task.done || !task.date || !task.time) return;
        const mins = minutesUntil(task);
        const key15 = `r15_${task.id}_${task.date}`;
        const key0 = `r0_${task.id}_${task.date}`;
        if (mins !== null && mins >= 14 && mins <= 16 && !reminderFired.current.has(key15)) {
          reminderFired.current.add(key15);
          addToast(`⏰ In 15 min: ${task.title}`, `${fmtTime(task.time)} · ${task.type}`, "warning");
          if (notifGranted) showLocalNotification(`⏰ In 15 min: ${task.title}`, `${task.type} at ${fmtTime(task.time)}`);
        }
        if (mins !== null && mins >= -1 && mins <= 1 && !reminderFired.current.has(key0)) {
          reminderFired.current.add(key0);
          addToast(`🔔 Starting now: ${task.title}`, `${task.type} · ${task.notes||"Good luck!"}`, "alert");
          if (notifGranted) showLocalNotification(`🔔 Now: ${task.title}`, `${task.type} starting now!`);
        }
      });
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [tasks, notifGranted]);

  // Schedule SW reminders when tasks change
  useEffect(() => {
    if (!swReg?.active) return;
    tasks.forEach(task => scheduleTaskReminder(task, swReg.active));
  }, [tasks, swReg]);

  function addToast(title, body, type="info") {
    const id = Date.now();
    setToasts(t => [...t, {id, title, body, type}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
  }

  async function handleEnableNotif() {
    const granted = await requestNotificationPermission();
    setNotifGranted(granted);
    if (granted) addToast("✅ Notifications enabled!", "You'll get reminders 15 min before tasks", "success");
    else addToast("❌ Permission denied", "Enable notifications in your browser settings", "warning");
  }

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setShowInstall(false); addToast("🎉 App installed!", "Find WorkSpace on your home screen", "success"); }
  }

  const todayTasks = tasks.filter(t => t.date === today);
  const tomorrowTasks = tasks.filter(t => t.date === tomorrow);
  const upcomingAlerts = tasks.filter(t => !t.done && daysFromNow(t.date) >= 0 && daysFromNow(t.date) <= 7 && ["Test","Interview","Deadline","Exam"].includes(t.type));

  const NAV = [
    {id:"dashboard",icon:"⊙",label:"Home"},
    {id:"schedule",icon:"◷",label:"Schedule"},
    {id:"notepad",icon:"✎",label:"Notes"},
    {id:"resources",icon:"⊞",label:"Resources"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#060810",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto",position:"relative"}}>

      {/* Install Banner */}
      {showInstall && (
        <div style={{background:"#0D1525",borderBottom:"1px solid #1E2A44",padding:"12px 16px",display:"flex",alignItems:"center",gap:12,animation:"fadeUp 0.3s ease"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,color:"#E8ECF4",fontWeight:500}}>Add WorkSpace to Home Screen</div>
            <div style={{fontSize:11,color:"#4A5C7A",fontFamily:"'DM Mono',monospace",marginTop:2}}>Works like a real app, offline too</div>
          </div>
          <button onClick={handleInstall} style={{background:"#4A90D9",border:"none",color:"#fff",borderRadius:8,padding:"8px 14px",fontSize:12,fontFamily:"'DM Mono',monospace",cursor:"pointer",letterSpacing:1}}>INSTALL</button>
          <button onClick={()=>setShowInstall(false)} style={{background:"none",border:"none",color:"#3D5278",cursor:"pointer",fontSize:18,padding:"4px"}}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{background:"#0A0D18",borderBottom:"1px solid #141C30",padding:"16px 20px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:40}}>
        <div>
          <div style={{fontSize:9,color:"#2A3D5C",letterSpacing:4,fontFamily:"'DM Mono',monospace",textTransform:"uppercase"}}>
            {new Date().toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}
          </div>
          <div style={{fontSize:20,color:"#E8ECF4",letterSpacing:-0.5}}>WorkSpace</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:15,color:"#4A90D9",background:"#111827",border:"1px solid #1E2A44",borderRadius:8,padding:"5px 12px",letterSpacing:2}}>
            {clock.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:true})}
          </div>
          {!notifGranted && (
            <button onClick={handleEnableNotif} style={{background:"#1A2030",border:"1px solid #FFAA0055",color:"#FFAA00",borderRadius:8,padding:"6px 10px",fontSize:11,fontFamily:"'DM Mono',monospace",cursor:"pointer",letterSpacing:1}} title="Enable Notifications">
              🔔
            </button>
          )}
          {notifGranted && <span style={{fontSize:16}} title="Notifications ON">🔔</span>}
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 16px 90px"}}>
        {tab==="dashboard" && <DashboardTab tasks={tasks} setTasks={setTasks} todayTasks={todayTasks} tomorrowTasks={tomorrowTasks} upcomingAlerts={upcomingAlerts} notes={notes} setTab={setTab} />}
        {tab==="schedule" && <ScheduleTab tasks={tasks} setTasks={setTasks} addToast={addToast} />}
        {tab==="notepad" && <NotepadTab notes={notes} setNotes={setNotes} />}
        {tab==="resources" && <ResourcesTab resources={resources} setResources={setResources} />}
      </div>

      {/* Bottom Nav */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#0A0D18",borderTop:"1px solid #141C30",display:"flex",zIndex:50,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {NAV.map(n => (
          <button key={n.id} onClick={()=>setTab(n.id)} style={{flex:1,background:"none",border:"none",padding:"12px 4px 10px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all 0.15s"}}>
            <span style={{fontSize:18,opacity:tab===n.id?1:0.35,transition:"all 0.15s"}}>{n.icon}</span>
            <span style={{fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:1,color:tab===n.id?"#4A90D9":"#2A3D5C",textTransform:"uppercase",transition:"all 0.15s"}}>{n.label}</span>
            {tab===n.id && <span style={{width:4,height:4,borderRadius:"50%",background:"#4A90D9",marginTop:1}} />}
          </button>
        ))}
      </div>

      {/* Toast Notifications */}
      <div style={{position:"fixed",top:70,right:12,zIndex:200,display:"flex",flexDirection:"column",gap:8,maxWidth:320}}>
        {toasts.map(toast => (
          <div key={toast.id} onClick={()=>setToasts(t=>t.filter(x=>x.id!==toast.id))} style={{
            background:"#0D1525",
            border:`1px solid ${toast.type==="alert"?"#FF4D6D":toast.type==="warning"?"#FFAA00":toast.type==="success"?"#00C9A7":"#1E2A44"}`,
            borderRadius:12,padding:"12px 16px",animation:"slideIn 0.3s ease",cursor:"pointer",
            boxShadow:`0 8px 30px ${toast.type==="alert"?"rgba(255,77,109,0.3)":toast.type==="warning"?"rgba(255,170,0,0.2)":"rgba(0,0,0,0.4)"}`,
          }}>
            <div style={{fontSize:13,color:"#E8ECF4",fontWeight:500,marginBottom:2}}>{toast.title}</div>
            <div style={{fontSize:11,color:"#4A5C7A",fontFamily:"'DM Mono',monospace"}}>{toast.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════
function DashboardTab({ tasks, setTasks, todayTasks, tomorrowTasks, upcomingAlerts, notes, setTab }) {
  const todayDone = todayTasks.filter(t=>t.done).length;
  const pct = todayTasks.length ? Math.round(todayDone/todayTasks.length*100) : 0;
  const overdueCount = tasks.filter(t=>isOverdue(t)).length;
  const toggle = id => setTasks(ts=>ts.map(t=>t.id===id?{...t,done:!t.done}:t));
  const nextUp = tasks.filter(t=>!t.done&&daysFromNow(t.date)>=0).sort((a,b)=>(a.date+(a.time||"23:59")).localeCompare(b.date+(b.time||"23:59")))[0];
  const pinnedNotes = notes.filter(n=>n.pinned).slice(0,2);

  return (
    <div style={{animation:"fadeUp 0.3s ease"}}>
      {/* Hero */}
      <div style={{background:"linear-gradient(135deg,#0D1828,#111827,#0D1525)",border:"1px solid #1E2A44",borderRadius:18,padding:"22px 20px",marginBottom:16,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-30,right:-30,width:140,height:140,borderRadius:"50%",background:"radial-gradient(circle,#4A90D920,transparent 70%)",pointerEvents:"none"}} />
        <div style={{fontSize:10,color:"#2A3D5C",letterSpacing:4,fontFamily:"'DM Mono',monospace",marginBottom:4}}>TODAY'S BRIEF</div>
        <div style={{fontSize:24,color:"#E8ECF4",marginBottom:4}}>
          {todayTasks.length===0?"Free day 🎉":`${todayDone} / ${todayTasks.length} done`}
        </div>
        <div style={{fontSize:13,color:"#4A5C7A",marginBottom:14}}>
          {pct===100?"All done! Great work.":pct===0?"Let's get started!":"Keep going — you've got this."}
        </div>
        {todayTasks.length>0&&(
          <div>
            <div style={{height:5,background:"#1A2540",borderRadius:5,overflow:"hidden",marginBottom:4}}>
              <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#4A90D9,#00C9A7)",borderRadius:5,transition:"width 0.6s ease"}} />
            </div>
            <div style={{fontSize:10,color:"#2A3D5C",fontFamily:"'DM Mono',monospace",textAlign:"right"}}>{pct}% complete</div>
          </div>
        )}
        {overdueCount>0&&(
          <div style={{marginTop:12,background:"#1A0A0E",border:"1px solid #3A1525",borderRadius:8,padding:"8px 12px",display:"flex",alignItems:"center",gap:8,animation:"glow 2s infinite"}}>
            <span style={{animation:"pulse 1s infinite"}}>⚠</span>
            <span style={{fontSize:12,color:"#FF4D6D",fontFamily:"'DM Mono',monospace"}}>{overdueCount} OVERDUE — needs attention</span>
          </div>
        )}
      </div>

      {/* Next Up */}
      {nextUp&&(
        <div style={{background:"#0A0D18",border:`1px solid ${TYPE_COLORS[nextUp.type]||"#1E2A44"}44`,borderRadius:14,padding:"16px",marginBottom:16,display:"flex",gap:14,alignItems:"center"}}>
          <div style={{fontSize:28}}>{TYPE_ICONS[nextUp.type]}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:"#2A3D5C",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:2}}>NEXT UP</div>
            <div style={{fontSize:15,color:"#E8ECF4",marginBottom:2}}>{nextUp.title}</div>
            <div style={{fontSize:11,color:TYPE_COLORS[nextUp.type],fontFamily:"'DM Mono',monospace"}}>
              {daysFromNow(nextUp.date)===0?"Today":daysFromNow(nextUp.date)===1?"Tomorrow":`In ${daysFromNow(nextUp.date)} days`}
              {nextUp.time&&" · "+fmtTime(nextUp.time)}
            </div>
          </div>
        </div>
      )}

      {/* Today's Tasks */}
      <div style={{background:"#0A0D18",border:"1px solid #141C30",borderRadius:14,padding:"18px",marginBottom:16}}>
        <div style={{fontSize:10,color:"#4A90D9",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:12}}>TODAY · {new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
        {todayTasks.length===0
          ? <div style={{textAlign:"center",padding:"20px 0",color:"#2A3D5C",fontFamily:"'DM Mono',monospace",fontSize:12}}>No tasks today</div>
          : todayTasks.sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")).map((t,i)=>(
            <MiniRow key={t.id} task={t} onToggle={()=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,done:!x.done}:x))} delay={i*40} />
          ))
        }
      </div>

      {/* Tomorrow */}
      <div style={{background:"#0A0D18",border:"1px solid #141C30",borderRadius:14,padding:"18px",marginBottom:16}}>
        <div style={{fontSize:10,color:"#FFAA00",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:12}}>TOMORROW · {new Date(tomorrow+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
        {tomorrowTasks.length===0
          ? <div style={{textAlign:"center",padding:"20px 0",color:"#2A3D5C",fontFamily:"'DM Mono',monospace",fontSize:12}}>Nothing scheduled</div>
          : tomorrowTasks.sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")).map((t,i)=>(
            <MiniRow key={t.id} task={t} onToggle={()=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,done:!x.done}:x))} delay={i*40} />
          ))
        }
      </div>

      {/* Alerts */}
      {upcomingAlerts.length>0&&(
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#FF6B9D",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:10}}>⚑ ALERTS THIS WEEK</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {upcomingAlerts.sort((a,b)=>a.date.localeCompare(b.date)).map(task=><AlertCard key={task.id} task={task} />)}
          </div>
        </div>
      )}

      {/* Pinned Notes */}
      {pinnedNotes.length>0&&(
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#A78BFA",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:10}}>📌 PINNED NOTES</div>
          <div style={{display:"flex",gap:10}}>
            {pinnedNotes.map(note=>(
              <div key={note.id} onClick={()=>setTab("notepad")} style={{flex:1,background:note.color||"#1A2540",border:"1px solid #1E2A44",borderRadius:12,padding:"14px",cursor:"pointer"}}>
                <div style={{fontSize:13,color:"#E8ECF4",marginBottom:6,fontWeight:500}}>{note.title}</div>
                <div style={{fontSize:11,color:"#4A5C7A",lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical"}}>{note.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week Strip */}
      <WeekStrip tasks={tasks} />
    </div>
  );
}

function MiniRow({ task, onToggle, delay=0 }) {
  const overdue = isOverdue(task);
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",background:"#0D1018",border:`1px solid ${overdue?"#3A1525":"#111827"}`,borderLeft:`3px solid ${task.done?"#141C30":PRIORITIES[task.priority]}`,borderRadius:8,opacity:task.done?0.4:1,animation:`fadeUp 0.2s ease ${delay}ms both`,marginBottom:6}}>
      <button onClick={onToggle} style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${task.done?"#00C9A7":PRIORITIES[task.priority]}`,background:task.done?"#00C9A7":"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:9}}>{task.done?"✓":""}</button>
      <span style={{fontSize:14,flexShrink:0}}>{TYPE_ICONS[task.type||"Task"]}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,color:task.done?"#2A3D5C":"#D8DCE8",textDecoration:task.done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.title}</div>
        {task.time&&<div style={{fontSize:10,color:overdue?"#FF4D6D":"#3D5278",fontFamily:"'DM Mono',monospace"}}>{fmtTime(task.time)}</div>}
      </div>
      <span style={{fontSize:9,color:TYPE_COLORS[task.type||"Task"],background:(TYPE_COLORS[task.type||"Task"])+"18",borderRadius:4,padding:"1px 6px",fontFamily:"'DM Mono',monospace",flexShrink:0}}>{task.type}</span>
    </div>
  );
}

function AlertCard({ task }) {
  const days = daysFromNow(task.date);
  const typeColor = TYPE_COLORS[task.type]||"#FF6B9D";
  const urgency = days===0?"TODAY":days===1?"TOMORROW":`IN ${days} DAYS`;
  const urgencyColor = days===0?"#FF4D6D":days===1?"#FFAA00":"#A78BFA";
  return (
    <div style={{background:"#0A0D18",border:`1px solid ${typeColor}44`,borderLeft:`3px solid ${typeColor}`,borderRadius:12,padding:"14px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>{TYPE_ICONS[task.type]}</span>
          <span style={{fontSize:14,color:"#E8ECF4"}}>{task.title}</span>
        </div>
        <span style={{fontSize:9,color:urgencyColor,background:urgencyColor+"18",borderRadius:20,padding:"2px 8px",fontFamily:"'DM Mono',monospace",letterSpacing:1,animation:days<=1?"pulse 1.5s infinite":"none"}}>{urgency}</span>
      </div>
      <div style={{fontSize:11,color:"#3D5278",fontFamily:"'DM Mono',monospace"}}>{fmtDate(task.date)}{task.time&&" · "+fmtTime(task.time)}</div>
      {task.notes&&<div style={{marginTop:8,fontSize:11,color:"#4A5C7A",background:"#111827",borderRadius:6,padding:"6px 10px"}}>📌 {task.notes}</div>}
    </div>
  );
}

function WeekStrip({ tasks }) {
  const days = Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return d.toISOString().slice(0,10); });
  return (
    <div style={{background:"#0A0D18",border:"1px solid #141C30",borderRadius:14,padding:"16px",marginBottom:16}}>
      <div style={{fontSize:10,color:"#2A3D5C",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:12}}>WEEK AHEAD</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {days.map((ds,i)=>{
          const dt=tasks.filter(t=>t.date===ds&&!t.done);
          const crit=dt.some(t=>["Test","Interview","Deadline"].includes(t.type));
          return (
            <div key={ds} style={{background:i===0?"#162040":"#0D1018",border:`1px solid ${i===0?"#4A90D9":crit?"#FF6B9D44":"#141C30"}`,borderRadius:8,padding:"8px 4px",textAlign:"center",minHeight:70}}>
              <div style={{fontSize:8,color:i===0?"#4A90D9":"#2A3D5C",fontFamily:"'DM Mono',monospace",marginBottom:1}}>{new Date(ds+"T00:00:00").toLocaleDateString("en-US",{weekday:"short"}).toUpperCase()}</div>
              <div style={{fontSize:15,color:i===0?"#E8ECF4":"#3D5278",fontFamily:"'DM Mono',monospace",marginBottom:4}}>{new Date(ds+"T00:00:00").getDate()}</div>
              {dt.slice(0,2).map(t=><div key={t.id} style={{fontSize:9,color:TYPE_COLORS[t.type],marginBottom:1}}>{TYPE_ICONS[t.type]}</div>)}
              {dt.length>2&&<div style={{fontSize:8,color:"#2A3D5C",fontFamily:"'DM Mono',monospace"}}>+{dt.length-2}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCHEDULE TAB
// ═══════════════════════════════════════════════════════
function ScheduleTab({ tasks, setTasks, addToast }) {
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [filterType, setFilterType] = useState("All");
  const [form, setForm] = useState({ title:"",date:todayStr(),time:"",priority:"medium",type:"Task",category:"Work",notes:"" });

  const openAdd = () => { setEditTask(null); setForm({title:"",date:todayStr(),time:"",priority:"medium",type:"Task",category:"Work",notes:""}); setShowForm(true); };
  const openEdit = t => { setEditTask(t); setForm({title:t.title,date:t.date,time:t.time,priority:t.priority,type:t.type||"Task",category:t.category,notes:t.notes}); setShowForm(true); };
  const save = () => {
    if(!form.title.trim()) return;
    if(editTask) setTasks(ts=>ts.map(t=>t.id===editTask.id?{...t,...form}:t));
    else { setTasks(ts=>[...ts,{id:Date.now(),...form,done:false}]); addToast("✅ Task added!",form.title,"success"); }
    setShowForm(false);
  };
  const del = id => { setTasks(ts=>ts.filter(t=>t.id!==id)); setShowForm(false); };
  const toggle = id => setTasks(ts=>ts.map(t=>t.id===id?{...t,done:!t.done}:t));

  const filtered = tasks.filter(t=>filterType==="All"||(t.type||"Task")===filterType);
  const groups = {"Today":filtered.filter(t=>t.date===today),"Tomorrow":filtered.filter(t=>t.date===tomorrow),"Upcoming":filtered.filter(t=>t.date>tomorrow),"Past":filtered.filter(t=>t.date<today)};

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:18,alignItems:"center"}}>
        <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={SS}>
          <option>All</option>{TASK_TYPES.map(t=><option key={t}>{t}</option>)}
        </select>
        <div style={{flex:1}} />
        <button onClick={openAdd} style={PB}>+ New Task</button>
      </div>

      {Object.entries(groups).map(([g,gt])=>gt.length===0?null:(
        <div key={g} style={{marginBottom:22}}>
          <div style={{fontSize:9,letterSpacing:3,color:g==="Today"?"#4A90D9":g==="Tomorrow"?"#FFAA00":"#2A3D5C",fontFamily:"'DM Mono',monospace",textTransform:"uppercase",marginBottom:10,paddingBottom:6,borderBottom:"1px solid #141C30"}}>{g} · {gt.length}</div>
          {gt.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(task=>(
            <FullTaskCard key={task.id} task={task} onToggle={toggle} onEdit={openEdit} />
          ))}
        </div>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",padding:"50px 0",color:"#2A3D5C",fontFamily:"'DM Mono',monospace",fontSize:12}}>No tasks · tap + New Task</div>}

      {showForm&&(
        <Sheet onClose={()=>setShowForm(false)} title={editTask?"Edit Task":"New Task"}>
          <FI label="Title" value={form.title} onChange={v=>setForm(f=>({...f,title:v}))} placeholder="What needs to be done?" />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,margin:"12px 0"}}>
            <FI label="Date" type="date" value={form.date} onChange={v=>setForm(f=>({...f,date:v}))} />
            <FI label="Time" type="time" value={form.time} onChange={v=>setForm(f=>({...f,time:v}))} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <FS label="Type" value={form.type} onChange={v=>setForm(f=>({...f,type:v}))} options={TASK_TYPES} color={TYPE_COLORS[form.type]} />
            <FS label="Priority" value={form.priority} onChange={v=>setForm(f=>({...f,priority:v}))} options={["high","medium","low"]} color={PRIORITIES[form.priority]} />
          </div>
          <FS label="Category" value={form.category} onChange={v=>setForm(f=>({...f,category:v}))} options={CATEGORIES} />
          <div style={{marginTop:12}}><FT label="Notes / Prep Tips" value={form.notes} onChange={v=>setForm(f=>({...f,notes:v}))} placeholder="Topics to revise, things to prepare..." /></div>
          <div style={{display:"flex",gap:8,marginTop:18}}>
            <button onClick={save} style={{...PB,flex:1}}>SAVE</button>
            {editTask&&<button onClick={()=>del(editTask.id)} style={{background:"none",border:"1px solid #3A1525",color:"#FF4D6D",borderRadius:8,padding:"11px 14px",fontFamily:"'DM Mono',monospace",cursor:"pointer",fontSize:11}}>DEL</button>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function FullTaskCard({ task, onToggle, onEdit }) {
  const overdue = isOverdue(task);
  const mins = minutesUntil(task);
  const soon = !task.done&&mins!==null&&mins>=0&&mins<=60;
  return (
    <div style={{background:task.done?"#080B14":"#0D1018",border:`1px solid ${overdue?"#3A1525":"#141C30"}`,borderLeft:`3px solid ${task.done?"#141C30":PRIORITIES[task.priority]}`,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,opacity:task.done?0.45:1,marginBottom:8,animation:"fadeUp 0.2s ease"}}>
      <button onClick={()=>onToggle(task.id)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${task.done?"#00C9A7":PRIORITIES[task.priority]}`,background:task.done?"#00C9A7":"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:9,transition:"all 0.2s"}}>{task.done?"✓":""}</button>
      <span style={{fontSize:16,flexShrink:0}}>{TYPE_ICONS[task.type||"Task"]}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,color:task.done?"#2A3D5C":"#E8ECF4",textDecoration:task.done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.title}</div>
        <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap",alignItems:"center"}}>
          {task.time&&<span style={{fontSize:10,color:overdue?"#FF4D6D":soon?"#FFAA00":"#3D5278",fontFamily:"'DM Mono',monospace"}}>{fmtTime(task.time)}</span>}
          <span style={{fontSize:10,color:"#2A3D5C",fontFamily:"'DM Mono',monospace"}}>{fmtDate(task.date)}</span>
          {overdue&&<span style={{fontSize:9,color:"#FF4D6D",fontFamily:"'DM Mono',monospace",animation:"pulse 1.5s infinite"}}>OVERDUE</span>}
          {soon&&!overdue&&<span style={{fontSize:9,color:"#FFAA00",fontFamily:"'DM Mono',monospace",animation:"pulse 1.5s infinite"}}>DUE SOON</span>}
        </div>
        {task.notes&&<div style={{fontSize:11,color:"#3D5278",marginTop:4,fontFamily:"'DM Mono',monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📌 {task.notes}</div>}
      </div>
      <button onClick={()=>onEdit(task)} style={{background:"none",border:"none",color:"#2A3D5C",cursor:"pointer",fontSize:14,padding:"4px"}} onMouseEnter={e=>e.currentTarget.style.color="#4A90D9"} onMouseLeave={e=>e.currentTarget.style.color="#2A3D5C"}>✎</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// NOTEPAD TAB
// ═══════════════════════════════════════════════════════
function NotepadTab({ notes, setNotes }) {
  const [view, setView] = useState("grid"); // grid | edit
  const [activeNote, setActiveNote] = useState(null);
  const [search, setSearch] = useState("");
  const textRef = useRef(null);

  const createNote = () => {
    const note = { id:Date.now(), title:"New Note", content:"", color:NOTE_COLORS[Math.floor(Math.random()*NOTE_COLORS.length)], pinned:false, updated:Date.now() };
    setNotes(ns=>[note,...ns]);
    setActiveNote(note);
    setView("edit");
  };

  const openNote = note => { setActiveNote(note); setView("edit"); };

  const updateNote = (field, val) => {
    const updated = {...activeNote, [field]:val, updated:Date.now()};
    setActiveNote(updated);
    setNotes(ns=>ns.map(n=>n.id===updated.id?updated:n));
  };

  const deleteNote = id => { setNotes(ns=>ns.filter(n=>n.id!==id)); setView("grid"); setActiveNote(null); };
  const togglePin = id => setNotes(ns=>ns.map(n=>n.id===id?{...n,pinned:!n.pinned}:n));

  const filtered = notes.filter(n=>!search||n.title.toLowerCase().includes(search.toLowerCase())||n.content.toLowerCase().includes(search.toLowerCase()));
  const pinned = filtered.filter(n=>n.pinned);
  const unpinned = filtered.filter(n=>!n.pinned);

  if (view==="edit" && activeNote) {
    return (
      <div style={{animation:"fadeUp 0.2s ease"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
          <button onClick={()=>{setView("grid");setActiveNote(null);}} style={{background:"#0D1018",border:"1px solid #141C30",color:"#4A90D9",borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:13,fontFamily:"'DM Mono',monospace"}}>← Back</button>
          <div style={{flex:1}} />
          <button onClick={()=>togglePin(activeNote.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:activeNote.pinned?"#FFAA00":"#2A3D5C"}} title={activeNote.pinned?"Unpin":"Pin"}>📌</button>
          <button onClick={()=>deleteNote(activeNote.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#3A2030"}} onMouseEnter={e=>e.currentTarget.style.color="#FF4D6D"} onMouseLeave={e=>e.currentTarget.style.color="#3A2030"}>🗑</button>
        </div>

        {/* Color Picker */}
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {NOTE_COLORS.map(c=>(
            <button key={c} onClick={()=>updateNote("color",c)} style={{width:24,height:24,borderRadius:"50%",background:c,border:`2px solid ${activeNote.color===c?"#E8ECF4":"transparent"}`,cursor:"pointer",flexShrink:0}} />
          ))}
        </div>

        <input
          value={activeNote.title}
          onChange={e=>updateNote("title",e.target.value)}
          style={{width:"100%",background:"transparent",border:"none",borderBottom:"1px solid #1E2A44",color:"#E8ECF4",fontSize:22,fontFamily:"'DM Serif Display',serif",padding:"0 0 12px",marginBottom:16}}
          placeholder="Note title..."
        />
        <textarea
          ref={textRef}
          value={activeNote.content}
          onChange={e=>updateNote("content",e.target.value)}
          placeholder="Start writing... use • for bullets, # for headings"
          style={{width:"100%",background:activeNote.color||"#1A2540",border:"1px solid #1E2A44",borderRadius:12,color:"#C8D0E0",fontSize:14,fontFamily:"'DM Mono',monospace",lineHeight:1.8,padding:"16px",resize:"none",minHeight:"calc(100vh - 280px)"}}
          autoFocus
        />
        <div style={{fontSize:10,color:"#2A3D5C",fontFamily:"'DM Mono',monospace",marginTop:8,textAlign:"right"}}>
          {activeNote.content.length} chars · {activeNote.content.split("\n").filter(l=>l.trim()).length} lines · saved
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:18,alignItems:"center"}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#2A3D5C",fontSize:14}}>⌕</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes..." style={{width:"100%",background:"#0D1018",border:"1px solid #141C30",borderRadius:8,color:"#E8ECF4",padding:"9px 12px 9px 30px",fontSize:13,fontFamily:"'DM Mono',monospace"}} />
        </div>
        <button onClick={createNote} style={PB}>+ Note</button>
      </div>

      {pinned.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#FFAA00",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:10}}>📌 PINNED</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {pinned.map(note=><NoteCard key={note.id} note={note} onOpen={openNote} onPin={togglePin} onDelete={deleteNote} />)}
          </div>
        </div>
      )}

      {unpinned.length>0&&(
        <div>
          {pinned.length>0&&<div style={{fontSize:9,color:"#2A3D5C",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:10}}>OTHER NOTES</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {unpinned.map(note=><NoteCard key={note.id} note={note} onOpen={openNote} onPin={togglePin} onDelete={deleteNote} />)}
          </div>
        </div>
      )}

      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:"60px 0",color:"#2A3D5C",fontFamily:"'DM Mono',monospace",fontSize:12}}>
          <div style={{fontSize:40,marginBottom:12}}>✎</div>
          No notes yet · tap + Note to start
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, onOpen, onPin, onDelete }) {
  const preview = note.content.trim().slice(0,120) || "Empty note";
  const lines = note.content.split("\n").filter(l=>l.trim()).length;
  const timeAgo = (() => {
    const diff = Date.now()-note.updated;
    if(diff<60000) return "just now";
    if(diff<3600000) return `${Math.floor(diff/60000)}m ago`;
    if(diff<86400000) return `${Math.floor(diff/3600000)}h ago`;
    return `${Math.floor(diff/86400000)}d ago`;
  })();
  return (
    <div style={{background:note.color||"#1A2540",border:"1px solid #1E2A44",borderRadius:12,padding:"14px",cursor:"pointer",position:"relative",animation:"fadeUp 0.25s ease",minHeight:140,display:"flex",flexDirection:"column"}}
      onClick={()=>onOpen(note)}
      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
      onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
      <div style={{fontSize:14,color:"#E8ECF4",marginBottom:8,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{note.title}</div>
      <div style={{fontSize:11,color:"#6A7A94",flex:1,lineHeight:1.6,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical"}}>{preview}</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
        <span style={{fontSize:9,color:"#2A3D5C",fontFamily:"'DM Mono',monospace"}}>{timeAgo} · {lines} lines</span>
        <div style={{display:"flex",gap:4}}>
          <button onClick={e=>{e.stopPropagation();onPin(note.id);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:note.pinned?"#FFAA00":"#2A3D5C",padding:"2px"}}>📌</button>
          <button onClick={e=>{e.stopPropagation();onDelete(note.id);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#2A3D5C",padding:"2px"}}
            onMouseEnter={e=>{e.stopPropagation();e.currentTarget.style.color="#FF4D6D";}}
            onMouseLeave={e=>{e.stopPropagation();e.currentTarget.style.color="#2A3D5C";}}>🗑</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// RESOURCES TAB
// ═══════════════════════════════════════════════════════
function ResourcesTab({ resources, setResources }) {
  const [showForm, setShowForm] = useState(false);
  const [editRes, setEditRes] = useState(null);
  const [filterCat, setFilterCat] = useState("All");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({name:"",url:"",category:"AI Tool",usage:"",tags:"",fav:false});

  const openAdd = () => { setEditRes(null); setForm({name:"",url:"",category:"AI Tool",usage:"",tags:"",fav:false}); setShowForm(true); };
  const openEdit = r => { setEditRes(r); setForm({name:r.name,url:r.url,category:r.category,usage:r.usage,tags:r.tags.join(", "),fav:r.fav}); setShowForm(true); };
  const save = () => {
    if(!form.name.trim()) return;
    const entry={...form,tags:form.tags.split(",").map(t=>t.trim()).filter(Boolean)};
    if(editRes) setResources(rs=>rs.map(r=>r.id===editRes.id?{...r,...entry}:r));
    else setResources(rs=>[...rs,{id:Date.now(),...entry}]);
    setShowForm(false);
  };
  const del = id => { setResources(rs=>rs.filter(r=>r.id!==id)); setShowForm(false); };
  const toggleFav = id => setResources(rs=>rs.map(r=>r.id===id?{...r,fav:!r.fav}:r));

  const filtered = resources
    .filter(r=>filterCat==="All"||r.category===filterCat)
    .filter(r=>!search||r.name.toLowerCase().includes(search.toLowerCase())||r.tags.some(t=>t.toLowerCase().includes(search.toLowerCase())));

  const favs = filtered.filter(r=>r.fav);
  const byCategory = RES_CATS.reduce((acc,cat)=>{ const it=filtered.filter(r=>r.category===cat); if(it.length) acc[cat]=it; return acc; },{});

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:18,alignItems:"center"}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#2A3D5C",fontSize:14}}>⌕</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{width:"100%",background:"#0D1018",border:"1px solid #141C30",borderRadius:8,color:"#E8ECF4",padding:"9px 12px 9px 30px",fontSize:13,fontFamily:"'DM Mono',monospace"}} />
        </div>
        <button onClick={openAdd} style={PB}>+ Add</button>
      </div>
      <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{...SS,width:"100%",marginBottom:16}}>
        <option>All</option>{RES_CATS.map(c=><option key={c}>{c}</option>)}
      </select>

      {favs.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#FFAA00",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:10}}>★ FAVOURITES</div>
          {favs.map(r=><ResCard key={r.id} res={r} onEdit={openEdit} onFav={toggleFav} />)}
        </div>
      )}
      {Object.entries(byCategory).map(([cat,items])=>(
        <div key={cat} style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#2A3D5C",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:10,paddingBottom:6,borderBottom:"1px solid #141C30"}}>{cat} · {items.length}</div>
          {items.map(r=><ResCard key={r.id} res={r} onEdit={openEdit} onFav={toggleFav} />)}
        </div>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",padding:"50px 0",color:"#2A3D5C",fontFamily:"'DM Mono',monospace",fontSize:12}}>No resources · tap + Add</div>}

      {showForm&&(
        <Sheet onClose={()=>setShowForm(false)} title={editRes?"Edit Resource":"Add Resource"}>
          <FI label="Name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="Tool or website name" />
          <div style={{margin:"12px 0"}}><FI label="URL" value={form.url} onChange={v=>setForm(f=>({...f,url:v}))} placeholder="https://..." /></div>
          <div style={{marginBottom:12}}><FS label="Category" value={form.category} onChange={v=>setForm(f=>({...f,category:v}))} options={RES_CATS} /></div>
          <FT label="Usage / Description" value={form.usage} onChange={v=>setForm(f=>({...f,usage:v}))} placeholder="What do you use this for?" />
          <div style={{margin:"12px 0"}}><FI label="Tags (comma separated)" value={form.tags} onChange={v=>setForm(f=>({...f,tags:v}))} placeholder="ai, design, free..." /></div>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
            <input type="checkbox" checked={form.fav} onChange={e=>setForm(f=>({...f,fav:e.target.checked}))} style={{accentColor:"#FFAA00",width:16,height:16}} />
            <span style={{fontSize:12,color:"#7A8CA8",fontFamily:"'DM Mono',monospace"}}>Mark as favourite</span>
          </label>
          <div style={{display:"flex",gap:8,marginTop:18}}>
            <button onClick={save} style={{...PB,flex:1}}>SAVE</button>
            {editRes&&<button onClick={()=>del(editRes.id)} style={{background:"none",border:"1px solid #3A1525",color:"#FF4D6D",borderRadius:8,padding:"11px 14px",fontFamily:"'DM Mono',monospace",cursor:"pointer",fontSize:11}}>DEL</button>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ResCard({ res, onEdit, onFav }) {
  const color = CAT_COLORS[res.category]||"#7A8CA8";
  return (
    <div style={{background:"#0D1018",border:"1px solid #141C30",borderLeft:`3px solid ${color}`,borderRadius:10,padding:"12px 14px",marginBottom:8,animation:"fadeUp 0.2s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
        <div>
          <div style={{fontSize:14,color:"#E8ECF4",marginBottom:2}}>{res.name}</div>
          <div style={{fontSize:9,color,background:color+"18",borderRadius:4,padding:"1px 7px",fontFamily:"'DM Mono',monospace",display:"inline-block"}}>{res.category}</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={()=>onFav(res.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:res.fav?"#FFAA00":"#2A3D5C"}}>★</button>
          <button onClick={()=>onEdit(res)} style={{background:"none",border:"none",color:"#2A3D5C",cursor:"pointer",fontSize:13}}>✎</button>
        </div>
      </div>
      {res.usage&&<div style={{fontSize:11,color:"#4A5C7A",marginBottom:8,lineHeight:1.5}}>{res.usage}</div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {res.tags.map(t=><span key={t} style={{fontSize:9,color:"#2A3D5C",background:"#141C30",borderRadius:3,padding:"1px 6px",fontFamily:"'DM Mono',monospace"}}>{t}</span>)}
        </div>
        {res.url&&<a href={res.url} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#4A90D9",fontFamily:"'DM Mono',monospace",textDecoration:"none",letterSpacing:1}}>OPEN ↗</a>}
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────
const SS = {background:"#0D1018",border:"1px solid #141C30",color:"#7A8CA8",borderRadius:8,padding:"8px 12px",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none"};
const PB = {background:"#162040",border:"1px solid #4A90D9",color:"#4A90D9",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontSize:12,fontFamily:"'DM Mono',monospace",letterSpacing:1,whiteSpace:"nowrap"};

function Sheet({ children, onClose, title }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(8px)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D1018",border:"1px solid #1E2A44",borderRadius:"20px 20px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",animation:"slideUp 0.3s ease"}}>
        <div style={{width:40,height:4,background:"#1E2A44",borderRadius:2,margin:"0 auto 20px"}} />
        <div style={{fontSize:11,color:"#2A3D5C",letterSpacing:3,fontFamily:"'DM Mono',monospace",marginBottom:16,textTransform:"uppercase"}}>{title}</div>
        {children}
      </div>
    </div>
  );
}
function FI({ label, value, onChange, type="text", placeholder="" }) {
  return (
    <div>
      <div style={{fontSize:9,color:"#2A3D5C",letterSpacing:2,fontFamily:"'DM Mono',monospace",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",background:"#060810",border:"1px solid #141C30",borderRadius:8,color:"#E8ECF4",padding:"10px 12px",fontSize:13,fontFamily:"'DM Mono',monospace"}} />
    </div>
  );
}
function FS({ label, value, onChange, options, color }) {
  return (
    <div>
      <div style={{fontSize:9,color:"#2A3D5C",letterSpacing:2,fontFamily:"'DM Mono',monospace",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:"#060810",border:"1px solid #141C30",borderRadius:8,color:color||"#E8ECF4",padding:"10px 12px",fontSize:13,fontFamily:"'DM Mono',monospace"}}>
        {options.map(o=><option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
function FT({ label, value, onChange, placeholder="" }) {
  return (
    <div>
      <div style={{fontSize:9,color:"#2A3D5C",letterSpacing:2,fontFamily:"'DM Mono',monospace",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={3} style={{width:"100%",background:"#060810",border:"1px solid #141C30",borderRadius:8,color:"#7A8CA8",padding:"10px 12px",fontSize:12,resize:"vertical",fontFamily:"'DM Mono',monospace"}} />
    </div>
  );
}
