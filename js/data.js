/* Workout v2 — program data.
 * Pure data, no logic or DOM access. Loaded before js/app.js via a classic
 * <script> tag, so everything here is a global read by app.js.
 *
 * Shape of an exercise: { name, sets, repsMin, repsMax, rest (seconds),
 *   type: 'compound'|'accessory', region, step (progression increment, lb),
 *   and ONE intensity spec: rirTarget (RIR) | intensityType:'rpe' (+ min/max)
 *   | intensityType:'special' (+ intensityLabel/intensityHint)
 *   | rirMin/rirMax (cycle programs — a range, adjusted per phase). }
 *
 * Cycle programs (blockModel.type === 'cycles') additionally use, per
 * exercise: slot/variantId (prescription slot vs. performance identity),
 * weightConvention, cue, perSide, symptom ('shoulder'|'back'),
 * progression ('benchTwoSession'|'inclineReview'), officeCeiling,
 * legacyRefs (same-movement names in older programs, shown as reference
 * only), warmupNote. Office/YMCA variants of one workout keep their
 * exercises in the same slot order.
 */

const PROGRAMS={
upperLower12:{key:'upperLower12',title:'12-Week Upper / Lower Hypertrophy',shortName:'Upper / Lower',profileHint:'dad',deloadWeek:7,gymToggle:true,
schedule:{1:'Upper A',2:'Lower A',4:'Upper B',5:'Lower B'},
workouts:{
upperA:{key:'upperA',dayNumber:1,day:'Monday',name:'Upper A',focus:'Horizontal push / pull',exercises:[
{name:'Barbell Bench Press',sets:4,repsMin:5,repsMax:7,rirTarget:2,rest:180,note:'Main press. Add reps before load; no planned failure.',type:'compound',region:'upper',step:5},
{name:'Chest-Supported Row',sets:4,repsMin:6,repsMax:8,rirTarget:2,rest:180,note:'Stable main row. Keep reps controlled.',type:'compound',region:'upper',step:5},
{name:'Incline DB Press',sets:3,repsMin:8,repsMax:12,rirTarget:2,rest:120,note:'Last set may be 1 RIR; avoid grinding to failure.',type:'compound',region:'upper',step:5},
{name:'Lat Pulldown (V-bar)',sets:3,repsMin:8,repsMax:10,rirTarget:2,rest:120,note:'Controlled reps. Do not turn this into a swing.',type:'compound',region:'upper',step:5},
{name:'Face Pulls / Cable Y Raise',sets:2,repsMin:12,repsMax:20,rirTarget:3,rest:90,note:'Shoulder health / rear delt work. Smooth reps.',type:'accessory',region:'upper',step:2.5},
{name:'Barbell Curl',sets:2,repsMin:8,repsMax:12,rirTarget:2,rest:90,note:'Clean reps. No cheating as the default.',type:'accessory',region:'upper',step:2.5}]},
lowerA:{key:'lowerA',dayNumber:2,day:'Tuesday',name:'Lower A',focus:'YMCA quad bias',exercises:[
{name:'Horizontal Leg Press / 45° Leg Press',sets:3,repsMin:6,repsMax:10,rirTarget:2,rest:180,type:'compound',region:'lower',step:10,note:'Main quad movement. Stop before grinders; no 0-RIR leg press sets.'},
{name:'Hack Squat / SSB Squat / Leg Press Variant',sets:2,repsMin:8,repsMax:10,rirTarget:3,rest:150,type:'compound',region:'lower',step:10,note:'Secondary quad movement. Keep 2–3 RIR and clean depth.'},
{name:'Leg Extension',sets:2,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Controlled. Optional hard final set only if knees feel good.'},
{name:'Lying or Seated Leg Curl',sets:3,repsMin:8,repsMax:12,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Hamstring balance. Full control through the eccentric.'},
{name:'Standing Calf Raise',sets:3,repsMin:8,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Full ROM with a pause in the stretch.'}]},
lowerAOffice:{key:'lowerAOffice',dayNumber:2.1,day:'Tuesday / Office',name:'Lower A — Office',focus:'Office gym quad focus',autoSchedule:false,exercises:[
{name:'SSB Squat',sets:3,repsMin:6,repsMax:8,rirTarget:2,rest:180,type:'compound',region:'lower',step:10,note:'Office main quad/strength lift. Keep 2–3 RIR; no planned failure.'},
{name:'Landmine Squat',sets:3,repsMin:10,repsMax:12,rirTarget:2,rest:150,type:'compound',region:'lower',step:10,note:'Lower spinal load than a straight-bar squat. Smooth reps.'},
{name:'Spanish Squat / Cable Knee Extension',sets:2,repsMin:15,repsMax:20,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Leg-extension replacement. Controlled burn, not sloppy failure.'},
{name:'Cable Leg Curl',sets:3,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Use cable, DB, band, or KBox setup if practical.'},
{name:'Standing Calf Raise',sets:3,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'DB, SSB, or rack-supported. Full ROM. Add a 4th set only if load is limited or calves are a priority.'}]},
upperB:{key:'upperB',dayNumber:4,day:'Thursday',name:'Upper B',focus:'Vertical push / pull',exercises:[
{name:'Seated Overhead Press',sets:3,repsMin:5,repsMax:8,rirTarget:2,rest:180,note:'Reduced to 3 sets. No heavy overhead failure.',type:'compound',region:'upper',step:5},
{name:'Weighted Pull-up / Lat Pulldown',sets:4,repsMin:6,repsMax:10,rirTarget:2,rest:180,type:'compound',region:'upper',step:5,note:'Main vertical pull. Add reps before load.'},
{name:'Machine Chest Press',sets:3,repsMin:8,repsMax:12,rirTarget:2,rest:120,type:'compound',region:'upper',step:5,note:'Stable pressing volume. Keep reps clean.'},
{name:'Seated Cable Row',sets:3,repsMin:8,repsMax:12,rirTarget:2,rest:120,type:'compound',region:'upper',step:5,note:'Horizontal pull. Controlled stretch and squeeze.'},
{name:'Lateral Raise',sets:3,repsMin:12,repsMax:20,rirTarget:2,rest:90,type:'accessory',region:'upper',step:2.5,note:'Extra delt volume moved here instead of more OHP.'},
{name:'Triceps Pushdown / Overhead Extension',sets:2,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'upper',step:2.5,note:'Joint-friendly setup. Occasional 1 RIR is fine; avoid ugly reps.'}]},
lowerB:{key:'lowerB',dayNumber:5,day:'Friday',name:'Lower B',focus:'YMCA posterior chain + unilateral',exercises:[
{name:'Romanian Deadlift',sets:3,repsMin:6,repsMax:8,rirTarget:2,rest:180,type:'compound',region:'lower',step:10,note:'No failure. Stop if back stiffness changes your position.'},
{name:'Hand-Supported Split Squat',sets:2,repsMin:8,repsMax:10,rirTarget:3,rest:150,type:'compound',region:'lower',step:5,note:'Per side. Replaces Bulgarian split squat. Start weaker/stiffer side; do not chase load until back stays quiet.'},
{name:'Goblet Squat or Light Leg Press',sets:2,repsMin:10,repsMax:12,rirTarget:3,rest:120,type:'compound',region:'lower',step:10,note:'Supplemental lower-body work. Keep 2–3 RIR.'},
{name:'Seated Leg Curl',sets:3,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Prefer seated when available. Controlled final reps.'},
{name:'Seated Calf Raise',sets:3,repsMin:8,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Full ROM. Pause the stretch.'}]},
lowerBOffice:{key:'lowerBOffice',dayNumber:5.1,day:'Friday / Office',name:'Lower B — Office',focus:'Office gym posterior chain',autoSchedule:false,exercises:[
{name:'Barbell Romanian Deadlift',sets:3,repsMin:6,repsMax:8,rirTarget:2,rest:180,type:'compound',region:'lower',step:10,note:'Controlled posterior-chain work. No failure and no back-position loss.'},
{name:'Hand-Supported Split Squat',sets:2,repsMin:8,repsMax:10,rirTarget:3,rest:150,type:'compound',region:'lower',step:5,note:'Per side. Start weaker/stiffer side. Hand support keeps the back quiet.'},
{name:'Barbell Hip Thrust / Glute Bridge',sets:3,repsMin:8,repsMax:12,rirTarget:2,rest:150,type:'compound',region:'lower',step:10,note:'Glute volume without turning the session into a squat day. Log which variant: a true barbell hip thrust loads heavier (often 150lb+); a DB glute bridge is usually much lighter — keep the logged weight consistent with whichever you actually did.'},
{name:'Cable Leg Curl',sets:3,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Cable, DB, band, or KBox curl if setup is practical.'},
{name:'Seated DB Calf Raise',sets:3,repsMin:12,repsMax:20,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'DB across knees or single-leg variation. Full ROM. Add a 4th set only if load is limited or calves are a priority.'}]}},
substitutions:{
'Barbell Bench Press':['DB Bench Press','Machine Chest Press','Floor Press','Close-Grip Bench Press','Weighted Dips'],
'Chest-Supported Row':['T-Bar Row','Chest-Supported DB Row','Machine Row','Seal Row','Pendlay Row'],
'Incline DB Press':['Incline Machine Press','Incline Smith Press','Landmine Press','Low Incline Barbell Press','Cable Incline Press'],
'Lat Pulldown (V-bar)':['Neutral Grip Pull-up','Close-Grip Pulldown','Sternum Pulldown','Single-Arm Pulldown','DB Pullover'],
'Face Pulls / Cable Y Raise':['Face Pulls','Cable Y Raise','Rear Delt Fly','Band Face Pull','Reverse Pec Deck','Prone Y Raise'],
'Barbell Curl':['EZ-Bar Curl','Cable Curl','Preacher Curl','Incline DB Curl','Spider Curl'],
'Horizontal Leg Press / 45° Leg Press':['45° Leg Press','Horizontal Leg Press','SSB Squat','Landmine Squat','Belt Squat','Hack Squat'],
'Hack Squat / SSB Squat / Leg Press Variant':['Hack Squat','SSB Squat','Front Squat','Landmine Squat','Heel-Elevated Goblet Squat','Pendulum Squat','V-Squat'],
'Leg Extension':['Cable Knee Extension','Spanish Squat','Sissy Squat Support','Single-Leg Leg Press','Reverse Nordic Curl','Cyclist Squat'],
'Lying or Seated Leg Curl':['Seated Leg Curl','Lying Leg Curl','Cable Leg Curl','DB Leg Curl','KBox Hamstring Curl','Swiss Ball Leg Curl'],
'Standing Calf Raise':['SSB Calf Raise','DB Single-Leg Calf Raise','Leg Press Calf Raise','Donkey Calf Raise','KBox Calf Raise','Seated Calf Raise'],
'SSB Squat':['SSB Box Squat','Front Squat','Goblet Squat','Landmine Squat','KBox Squat'],
'Landmine Squat':['Heel-Elevated Goblet Squat','SSB Squat','Goblet Squat','KBox Squat','Front Squat'],
'Spanish Squat / Cable Knee Extension':['Cable Knee Extension','Spanish Squat','Sissy Squat Support','Heel-Elevated Goblet Squat','Cyclist Squat'],
'Cable Leg Curl':['DB Leg Curl','KBox Hamstring Curl','Sliding Leg Curl','Swiss Ball Curl','Nordic Curl'],
'Seated Overhead Press':['Machine Shoulder Press','Standing OHP','Landmine Press','DB Shoulder Press','Arnold Press'],
'Weighted Pull-up / Lat Pulldown':['Assisted Pull-up','Band-Assisted Chin-up','Inverted Row','Wide-Grip Pulldown','Single-Arm Pulldown'],
'Machine Chest Press':['Cable Chest Press','Weighted Push-Up','Smith Press','Hammer Strength Press','Svend Press'],
'Seated Cable Row':['Machine Row','Supported DB Row','Meadows Row','Chest-Supported DB Row','Barbell Bent-Over Row'],
'Lateral Raise':['Cable Lateral Raise','Machine Lateral Raise','DB Partial Raise','Leaning Lateral Raise','Band Lateral Raise'],
'Triceps Pushdown / Overhead Extension':['Triceps Pushdown','Overhead Triceps Extension','Skull Crusher','JM Press','Diamond Push-Up','Triceps Dip'],
'Romanian Deadlift':['Trap Bar RDL','Stiff-Leg Deadlift','Good Morning','DB Romanian Deadlift','Cable Pull-Through','KBox RDL'],
'Hand-Supported Split Squat':['Bulgarian Split Squat','Step-Up','Reverse Lunge','Goblet Split Squat','KBox Split Squat','Walking Lunge'],
'Goblet Squat or Light Leg Press':['Light Leg Press','Goblet Squat','Landmine Squat','Belt Squat','Smith Squat','KBox Squat'],
'Seated Leg Curl':['Cable Leg Curl','Lying Leg Curl','Nordic Curl','Sliding Leg Curl','Swiss Ball Curl','KBox Hamstring Curl'],
'Seated Calf Raise':['Seated DB Calf Raise','Single-Leg Calf Raise','45° Calf Raise','Deficit Calf Raise','Leg Press Calf Raise','KBox Calf Raise'],
'Barbell Romanian Deadlift':['DB Romanian Deadlift','KBox RDL','Trap Bar RDL','Cable Pull-Through','Good Morning'],
'Barbell Hip Thrust / Glute Bridge':['Barbell Hip Thrust','Barbell Glute Bridge','DB Glute Bridge','Smith Hip Thrust','Cable Pull-Through','KBox Hip Thrust','Single-Leg Hip Thrust'],
'Seated DB Calf Raise':['Single-Leg Calf Raise','KBox Calf Raise','Standing Calf Raise','Deficit Calf Raise','SSB Calf Raise']},
checklist:['Use double progression: add reps first, then load when all sets hit the top of the range at target RIR.','Compound lifts stay mostly around 2 RIR; occasional 1 RIR is fine, but 0-RIR compound failure is not the goal.','Isolation lifts can occasionally reach 0–1 RIR on the final safe set only; do not stack repeated failure across the whole session.','If a compound hits 0 RIR before the final set, reduce load 5–10% next time.','If back stiffness appears, stop that movement, choose a supported variation, and log the note.','Use the Gym toggle: YMCA keeps machine-based lower days; Office automatically swaps Lower A and Lower B to the office versions.','Deload on week 7: reduce sets about 40–50%, keep movement patterns, use 4–5 RIR, no failure, and no new exercises.','Add 2 × 20–30 minutes Zone 2 cardio weekly after upper days or on non-lifting days if recovery stays good.'],
referenceSections:[
{title:'Gym toggle rule',items:['Use the YMCA / Office toggle before selecting or auto-selecting the day.','YMCA mode keeps the normal machine-based lower days; Office mode automatically swaps Lower A to Lower A — Office and Lower B to Lower B — Office.','Upper days stay unchanged because the office gym has enough upper-body equipment.','Do not make up missed machine volume later; choose the office equivalent and move on.']},
{title:'KBox / flywheel guidance',items:['KBox is an office option, not a low-fatigue machine replacement.','Keep KBox lower-body work moderate at first: 2–3 sets of 8–12 on squats/RDLs, 2 sets of 8 per side on split squats, or 2–3 sets of 12–20 on calves.','Avoid maximal eccentric overload and avoid hard KBox lower-body work immediately before or after heavy lower sessions.']},
{title:'Conditioning and athleticism',items:['Target 2 Zone 2 cardio sessions per week for 20–30 minutes.','Optional power primers: med ball chest pass 3×5, rotational throw 3×4/side, low box jump or pogo hop 3×3–5 if joints tolerate.','Keep conditioning supportive. It should not compromise hypertrophy recovery.']},
{title:'Deload triggers',items:['Deload early if two of these happen: performance drops on the same lift twice, soreness persists into the next exposure, sleep/energy stay poor for several days, or joint/back stiffness changes execution.','During deload, use 4–5 RIR, no failure, and no new exercises.']},
{title:'Safety notes',items:['Lower-body headache, dizziness, chest pain, neurological symptoms, unusual shortness of breath, or blood-pressure concerns mean stop training and seek appropriate medical guidance.','Back stiffness is a signal to stop the movement, use a supported substitution, and record what happened.']}],
recoveryNote:'Wednesday / Weekend: walk, mobility, low-stress cardio, Zone 2, or run a missed session manually. Use the Gym toggle to swap lower days when training at the office.'},

glutePullPush:{key:'glutePullPush',title:'12-Week Glute / Pull / Legs / Push',shortName:'Glute Split',profileHint:'daughter',deloadWeek:7,
schedule:{1:'Day 1 – Glutes',2:'Day 2 – Back & Biceps',4:'Day 4 – Quads & Hamstrings',5:'Day 5 – Chest, Shoulders & Triceps'},
workouts:{
glutes:{key:'glutes',dayNumber:1,day:'Monday',name:'Day 1 – Glutes',focus:'Glute bias',exercises:[
{name:'Hip Thrusts',sets:4,repsMin:6,repsMax:8,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:180,type:'compound',region:'lower',step:10},
{name:'Bulgarian Split Squats',sets:3,repsMin:8,repsMax:10,intensityType:'rpe',intensityMin:8,intensityMax:8,rest:150,type:'compound',region:'lower',step:5,note:'Per leg.'},
{name:'Romanian Deadlifts',sets:3,repsMin:8,repsMax:10,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:180,type:'compound',region:'lower',step:10},
{name:'Glute Kickbacks',sets:2,repsMin:12,repsMax:15,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 2 to true failure',rest:75,type:'accessory',region:'lower',step:5,note:'Set 2 goes to true failure.'}]},
backBiceps:{key:'backBiceps',dayNumber:2,day:'Tuesday',name:'Day 2 – Back & Biceps',focus:'Vertical + horizontal pull',exercises:[
{name:'Lat Pulldowns',sets:4,repsMin:6,repsMax:10,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:150,type:'compound',region:'upper',step:5},
{name:'Rows',sets:4,repsMin:6,repsMax:10,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:150,type:'compound',region:'upper',step:5},
{name:'Straight-Arm Pulldowns',sets:2,repsMin:10,repsMax:15,intensityType:'rpe',intensityMin:8,intensityMax:8,rest:90,type:'accessory',region:'upper',step:5},
{name:'Hammer Curls',sets:2,repsMin:10,repsMax:12,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 2 to true failure',rest:75,type:'accessory',region:'upper',step:2.5,note:'Set 2 goes to true failure.'},
{name:'Biceps Curls',sets:2,repsMin:10,repsMax:12,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 2 to true failure',rest:75,type:'accessory',region:'upper',step:2.5,note:'Set 2 goes to true failure.'}]},
quadsHamstrings:{key:'quadsHamstrings',dayNumber:4,day:'Thursday',name:'Day 4 – Quads & Hams',focus:'Quad + hamstring bias',exercises:[
{name:'Leg Press',sets:4,repsMin:6,repsMax:10,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:180,type:'compound',region:'lower',step:10},
{name:'Hip Thrusts',sets:3,repsMin:8,repsMax:10,intensityType:'rpe',intensityMin:7,intensityMax:8,rest:150,type:'compound',region:'lower',step:10},
{name:'Hamstring Curls',sets:3,repsMin:10,repsMax:12,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 3 to true failure',rest:90,type:'accessory',region:'lower',step:5,note:'Set 3 goes to true failure.'},
{name:'Leg Extensions',sets:3,repsMin:10,repsMax:12,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 3 to true failure',rest:90,type:'accessory',region:'lower',step:5,note:'Set 3 goes to true failure.'},
{name:'Step-Ups',sets:2,repsMin:8,repsMax:10,intensityType:'special',intensityLabel:'RPE 8 + fail',intensityHint:'Set 1 at RPE 8, set 2 to true failure',rest:120,type:'compound',region:'lower',step:5,note:'Per leg. Set 1 around RPE 8, set 2 to true failure.'}]},
push:{key:'push',dayNumber:5,day:'Friday',name:'Day 5 – Push',focus:'Pressing + triceps',exercises:[
{name:'Flat Press',sets:4,repsMin:6,repsMax:8,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:180,type:'compound',region:'upper',step:5},
{name:'Chest Flies',sets:3,repsMin:10,repsMax:15,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 3 to true failure',rest:75,type:'accessory',region:'upper',step:2.5,note:'Set 3 goes to true failure.'},
{name:'Shoulder Press',sets:3,repsMin:8,repsMax:10,intensityType:'rpe',intensityMin:7,intensityMax:9,rest:150,type:'compound',region:'upper',step:5},
{name:'Skull Crushers',sets:2,repsMin:10,repsMax:12,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 2 to true failure',rest:75,type:'accessory',region:'upper',step:2.5,note:'Set 2 goes to true failure.'},
{name:'Triceps Pushdowns',sets:2,repsMin:10,repsMax:15,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 2 to true failure',rest:75,type:'accessory',region:'upper',step:2.5,note:'Set 2 goes to true failure.'},
{name:'Upright Rows',sets:2,repsMin:10,repsMax:12,intensityType:'special',intensityLabel:'Failure',intensityHint:'Set 2 to true failure',rest:75,type:'accessory',region:'upper',step:2.5,note:'Set 2 goes to true failure.'}]}},
substitutions:{'Hip Thrusts':['Barbell Glute Bridge','Smith Hip Thrust','Cable Pull-Through','Kas Glute Bridge','Single-Leg Hip Thrust'],'Bulgarian Split Squats':['Step-Up','Walking Lunge','Rear Foot Elevated Split Squat','Reverse Lunge','Goblet Split Squat'],'Romanian Deadlifts':['DB Romanian Deadlift','Trap Bar RDL','Stiff-Leg Deadlift','Cable Pull-Through','Good Morning'],'Glute Kickbacks':['Cable Kickback','Machine Kickback','45° Back Extension','Banded Kickback','Reverse Hyper'],'Lat Pulldowns':['Neutral-Grip Pulldown','Assisted Pull-Up','Pull-Up','Single-Arm Pulldown','DB Pullover'],'Rows':['Chest-Supported Row','Seated Cable Row','Machine Row','Barbell Bent-Over Row','T-Bar Row'],'Straight-Arm Pulldowns':['Cable Pullover','Dumbbell Pullover','Band Pulldown','Straight-Arm Cable Row','Barbell Pullover'],'Hammer Curls':['DB Hammer Curl','Rope Hammer Curl','Cross-Body Hammer Curl','Reverse Curl','Zottman Curl'],'Biceps Curls':['EZ-Bar Curl','Cable Curl','Preacher Curl','Incline DB Curl','Spider Curl'],'Leg Press':['Hack Squat','Pendulum Squat','Belt Squat','V-Squat','Smith Squat'],'Hamstring Curls':['Seated Leg Curl','Lying Leg Curl','Nordic Curl','Sliding Leg Curl','Swiss Ball Curl'],'Leg Extensions':['Single-Leg Extension','Spanish Squat','Sissy Squat','Reverse Nordic Curl','Cyclist Squat'],'Step-Ups':['Walking Lunge','Bulgarian Split Squat','Reverse Lunge','Goblet Split Squat','Lateral Lunge'],'Flat Press':['Barbell Bench Press','DB Bench Press','Machine Chest Press','Floor Press','Weighted Dips'],'Chest Flies':['Cable Fly','Pec Deck','Incline Cable Fly','DB Fly','Svend Press'],'Shoulder Press':['Machine Shoulder Press','Seated DB Press','Arnold Press','Landmine Press','Standing OHP'],'Skull Crushers':['EZ-Bar Skull Crusher','Overhead Triceps Extension','JM Press','Close-Grip Press','Cable Skull Crusher'],'Triceps Pushdowns':['Rope Pushdown','Straight-Bar Pushdown','Cross-Body Pushdown','Diamond Push-Up','Overhead Cable Extension'],'Upright Rows':['Cable Upright Row','DB Upright Row','High Pull','Band Upright Row','Lateral Raise']},
checklist:['Main lifts live in the lower rep ranges; chase cleaner reps before adding load.','For RPE-based work, stay inside the target range instead of forcing PRs every session.','For exercises marked true failure, only the listed final set should go all the way.','Use Wednesday for rest, walking, or light cardio so Thursday and Friday stay high quality.','Deload on week 7 by cutting volume roughly in half and keeping bar speed clean.','Keep notes when a substitution feels better so the history tab stays meaningful.'],
recoveryNote:'Day 3 is rest or light cardio. Weekend can be full recovery or a make-up session.'},

/* Six-cycle Upper / Lower — specification revision 2 (2026-10-21), dad
 * profile. A pre-block deload (cycle 0) then six training cycles; a cycle is
 * one explicit completion of each workout, however long it takes. */
upperLower6_20261021:{key:'upperLower6_20261021',title:'Upper / Lower — Six-Cycle Progression',shortName:'Six-Cycle',profileHint:'dad',profiles:['dad'],revision:2,
gymToggle:true,strictHistory:true,
blockModel:{type:'cycles',trainingCycles:6,preBlockDeload:true},
workouts:{
upperA:{key:'upperA',dayNumber:1,day:'Monday',name:'Upper A',focus:'Bench · chest-supported row · incline DB · pulldown',targetMinutes:[50,60],pairs:[['Cable Y Raise','EZ-Bar Curl']],exercises:[
{name:'Barbell Bench Press',slot:'ua_bench',variantId:'barbell_bench',sets:2,repsMin:8,repsMax:10,rirMin:3,rirMax:3,rest:180,type:'compound',region:'upper',step:5,weightConvention:'bar_included_total_lb',symptom:'shoulder',progression:'benchTwoSession',legacyRefs:['Barbell Bench Press'],cue:'Controlled lowering; repeatable touch point; no forced reps.',note:'Go lighter than the old 165-lb sets of 5–6: choose a load from easy warm-ups that gives 8–10 clean reps with 3 RIR. Two working sets maximum, no back-off sets. If catching, pain or a need to reposition occurs, stop and safely rack — never reposition under load and keep going. Check in on the shoulder later that day and the next morning.'},
{name:'Chest-Supported DB Row',slot:'ua_row',variantId:'db_chest_supported_row',sets:3,repsMin:8,repsMax:12,rirMin:2,rirMax:2,rest:150,type:'compound',region:'upper',step:5,weightConvention:'per_dumbbell_lb',cue:'Keep your chest on the bench; no torso heave.',note:'A chest-supported machine row may replace this at the YMCA — choose it from the list so its load history stays separate.'},
{name:'Low-Incline DB Press',slot:'ua_incline',variantId:'low_incline_db_press',sets:2,repsMin:8,repsMax:15,rirMin:2,rirMax:3,rest:150,type:'compound',region:'upper',step:5,weightConvention:'per_dumbbell_lb',symptom:'shoulder',progression:'inclineReview',legacyRefs:['Incline DB Press'],warmupNote:'Usually one easy acclimation set after flat bench is enough.',cue:'Bench about 15–30°; choose a comfortable angle and grip.',note:'The 70-lb dumbbells are a reference, not a required start — use a lighter pair if 8 clean reps at the phase RIR isn’t there. Every rep free of catching and pain, with no later or next-day flare. At 15/15 with at least 2 RIR the app suggests heavier DBs or a low-incline barbell press for your review — it never switches automatically.'},
{name:'Neutral-Grip Lat Pulldown',slot:'ua_pulldown',variantId:'neutral_pulldown',sets:2,repsMin:8,repsMax:12,rirMin:2,rirMax:2,rest:120,type:'compound',region:'upper',step:5,weightConvention:'machine_display_lb',cue:'Same handle and torso angle each time; no swinging.'},
{name:'Cable Y Raise',slot:'ua_y_raise',variantId:'cable_y_raise',sets:2,repsMin:12,repsMax:20,rirMin:2,rirMax:3,rest:90,type:'accessory',region:'upper',step:2.5,weightConvention:'per_cable_stack_lb',cue:'Controlled elevation in a comfortable range; don’t shrug to finish reps.'},
{name:'EZ-Bar Curl',slot:'ua_curl',variantId:'ez_bar_curl',sets:2,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'upper',step:5,weightConvention:'bar_included_total_lb',legacyRefs:['EZ-Bar Curl'],cue:'Keep your torso still; choose a comfortable grip.'}]},
lowerA:{key:'lowerA',dayNumber:2,day:'Tuesday',name:'Lower A',focus:'YMCA: leg press · hack squat · leg extension · leg curl · calves',targetMinutes:[45,55],exercises:[
{name:'45-Degree Leg Press',slot:'la_main',variantId:'leg_press_45',sets:3,repsMin:8,repsMax:10,rirMin:2,rirMax:2,rest:180,type:'compound',region:'lower',step:10,weightConvention:'plates_only_total_lb',cue:'Keep your pelvis supported; consistent depth; don’t bounce.',note:'A horizontal leg press is a separate variant — choose it from the list if that’s what you use.'},
{name:'Hack Squat',slot:'la_secondary',variantId:'hack_squat',sets:2,repsMin:10,repsMax:12,rirMin:2,rirMax:2,rest:120,type:'compound',region:'lower',step:10,weightConvention:'plates_only_total_lb',cue:'Use a consistent, comfortable range of motion.'},
{name:'Leg Extension',slot:'la_extension',variantId:'leg_extension',sets:2,repsMin:12,repsMax:20,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'machine_display_lb',cue:'Use a consistent, comfortable range of motion.'},
{name:'Seated Leg Curl',slot:'la_curl',variantId:'seated_leg_curl',sets:3,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'machine_display_lb',cue:'Same seat and back-pad settings; keep your pelvis against the pad.'},
{name:'Standing Calf Raise Machine',slot:'la_calf',variantId:'standing_calf_machine',sets:3,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'machine_display_lb',cue:'Controlled lowering and rise; no bouncing.'}]},
lowerAOffice:{key:'lowerAOffice',dayNumber:2.1,day:'Tuesday / Office',name:'Lower A — Office',focus:'Office: SSB squat · landmine squat · cable knee extension · cable leg curl · calves',targetMinutes:[45,55],autoSchedule:false,exercises:[
{name:'SSB Squat',slot:'la_main',variantId:'ssb_squat',sets:3,repsMin:8,repsMax:10,rirMin:2,rirMax:2,rest:180,type:'compound',region:'lower',step:5,weightConvention:'bar_included_total_lb',symptom:'back',legacyRefs:['SSB Squat'],cue:'Brace consistently; use a repeatable, comfortable depth.',note:'Calibrate for 8–10 reps — the historical 125 × 6 is not a prescribed starting weight.'},
{name:'Landmine Squat',slot:'la_secondary',variantId:'landmine_squat',sets:2,repsMin:10,repsMax:12,rirMin:2,rirMax:2,rest:120,type:'compound',region:'lower',step:5,weightConvention:'plates_only_total_lb',legacyRefs:['Landmine Squat'],cue:'Use a consistent, comfortable range of motion.'},
{name:'Seated Cable Knee Extension',slot:'la_extension',variantId:'cable_knee_extension',sets:2,repsMin:12,repsMax:20,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:2.5,weightConvention:'per_cable_stack_lb',perSide:'leg',cue:'Secure the ankle cuff and seat; align the cable; controlled reps on each leg.'},
{name:'Standing Cable Leg Curl',slot:'la_curl',variantId:'standing_cable_leg_curl',sets:3,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:2.5,weightConvention:'per_cable_stack_lb',perSide:'leg',cue:'Ankle cuff; support yourself; keep the pelvis stable.'},
{name:'Supported Single-Leg DB Calf Raise',slot:'la_calf',variantId:'supported_single_leg_calf',sets:3,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'single_implement_lb',perSide:'side',cue:'Hand support and stable footing; controlled stretch and a full comfortable rise.'}]},
upperB:{key:'upperB',dayNumber:4,day:'Thursday',name:'Upper B',focus:'Pulldown · seated overhead press · cable row · laterals · pushdown',targetMinutes:[45,55],pairs:[['Cable Lateral Raise','Cable Triceps Pushdown']],exercises:[
{name:'Neutral-Grip Lat Pulldown',slot:'ub_pulldown',variantId:'neutral_pulldown',sets:3,repsMin:8,repsMax:12,rirMin:2,rirMax:2,rest:150,type:'compound',region:'upper',step:5,weightConvention:'machine_display_lb',cue:'Same handle and torso angle each time; no swinging.'},
{name:'Seated Barbell Overhead Press',slot:'ub_overhead',variantId:'seated_barbell_overhead_press',sets:2,repsMin:6,repsMax:10,rirMin:3,rirMax:3,rest:180,type:'compound',region:'upper',step:5,weightConvention:'bar_included_total_lb',symptom:'shoulder',legacyRefs:['Seated Overhead Press'],cue:'Your established comfortable seated setup; stable torso; no excessive backward lean or forced reps.',note:'Kept because overhead pressing stayed comfortable even during shoulder flare-ups. Calibrate to 3 RIR instead of copying the old 105-lb sets. Stop for pain, catching or a later flare. This replaces the old Upper B chest-press slot — it isn’t added on top.'},
{name:'Seated Cable Row',slot:'ub_row',variantId:'seated_cable_row',sets:3,repsMin:8,repsMax:12,rirMin:2,rirMax:2,rest:150,type:'compound',region:'upper',step:5,weightConvention:'machine_display_lb',cue:'Keep the torso angle stable; don’t lean back to finish.'},
{name:'Cable Lateral Raise',slot:'ub_lateral',variantId:'cable_lateral_raise',sets:3,repsMin:12,repsMax:20,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'upper',step:2.5,weightConvention:'per_cable_stack_lb',perSide:'arm',cue:'Raise through a comfortable arc without swinging.'},
{name:'Cable Triceps Pushdown',slot:'ub_triceps',variantId:'cable_pushdown',sets:2,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'upper',step:5,weightConvention:'machine_display_lb',cue:'Keep the upper arms steady; don’t lean to finish reps.'}]},
lowerB:{key:'lowerB',dayNumber:5,day:'Friday',name:'Lower B',focus:'YMCA: RDL · split squat · leg curl · seated calves',targetMinutes:[40,50],exercises:[
{name:'Barbell Romanian Deadlift',slot:'lb_rdl',variantId:'barbell_rdl',sets:3,repsMin:6,repsMax:10,rirMin:2,rirMax:3,rest:180,type:'compound',region:'lower',step:5,weightConvention:'bar_included_total_lb',symptom:'back',legacyRefs:['Barbell Romanian Deadlift','Romanian Deadlift'],cue:'Soft knees, hips back, bar close; stop the descent before pelvic or spinal control changes.',note:'First-cycle trial: 155–160 lb if that allows 3 RIR and comfortable movement. The recent 165 × 7 × 3 is history, not an automatic target.'},
{name:'Hand-Supported Split Squat',slot:'lb_split',variantId:'supported_split_squat',sets:2,repsMin:8,repsMax:12,rirMin:2,rirMax:3,rest:120,type:'compound',region:'lower',step:5,weightConvention:'single_implement_lb',perSide:'leg',symptom:'back',officeCeiling:{lb:70,repsMax:15},legacyRefs:['Hand-Supported Split Squat'],cue:'Your established floor-based split stance with hand support; start with the weaker side and match reps.',note:'Each set = one set per leg. Rest 30–60 s between legs, then 2:00 after both. Office: use the 70-lb DB or ~71-lb KB — never an unavailable 85 lb. At the office load ceiling, build to 15 reps per leg before reassessing.'},
{name:'Seated Leg Curl',slot:'lb_curl',variantId:'seated_leg_curl',sets:3,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'machine_display_lb',cue:'Same seat and back-pad settings; keep your pelvis against the pad.'},
{name:'Seated Calf Raise Machine',slot:'lb_calf',variantId:'seated_calf_machine',sets:3,repsMin:12,repsMax:20,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'plates_only_total_lb',cue:'Note the exact machine; controlled stretch and rise.'}]},
lowerBOffice:{key:'lowerBOffice',dayNumber:5.1,day:'Friday / Office',name:'Lower B — Office',focus:'Office: RDL · split squat · cable leg curl · seated barbell calves',targetMinutes:[40,50],autoSchedule:false,exercises:[
{name:'Barbell Romanian Deadlift',slot:'lb_rdl',variantId:'barbell_rdl',sets:3,repsMin:6,repsMax:10,rirMin:2,rirMax:3,rest:180,type:'compound',region:'lower',step:5,weightConvention:'bar_included_total_lb',symptom:'back',legacyRefs:['Barbell Romanian Deadlift','Romanian Deadlift'],cue:'Soft knees, hips back, bar close; stop the descent before pelvic or spinal control changes.',note:'First-cycle trial: 155–160 lb if that allows 3 RIR and comfortable movement. The recent 165 × 7 × 3 is history, not an automatic target.'},
{name:'Hand-Supported Split Squat',slot:'lb_split',variantId:'supported_split_squat',sets:2,repsMin:8,repsMax:12,rirMin:2,rirMax:3,rest:120,type:'compound',region:'lower',step:5,weightConvention:'single_implement_lb',perSide:'leg',symptom:'back',officeCeiling:{lb:70,repsMax:15},legacyRefs:['Hand-Supported Split Squat'],cue:'Your established floor-based split stance with hand support; start with the weaker side and match reps.',note:'Each set = one set per leg. Rest 30–60 s between legs, then 2:00 after both. Office: use the 70-lb DB or ~71-lb KB — never an unavailable 85 lb. At the office load ceiling, build to 15 reps per leg before reassessing.'},
{name:'Standing Cable Leg Curl',slot:'lb_curl',variantId:'standing_cable_leg_curl',sets:3,repsMin:10,repsMax:15,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:2.5,weightConvention:'per_cable_stack_lb',perSide:'leg',cue:'Ankle cuff; support yourself; keep the pelvis stable.'},
{name:'Seated Barbell Calf Raise',slot:'lb_calf',variantId:'seated_barbell_calf',sets:3,repsMin:12,repsMax:20,rirMin:1,rirMax:2,rest:90,type:'accessory',region:'lower',step:5,weightConvention:'bar_included_total_lb',cue:'Use padding and a stable bench/foot platform; control the bar and don’t bounce.'}]}},
/* Explicit alternatives only — picking one logs it under its own name, so
 * its load history stays separate. No bench/overhead/RDL/squat swaps, and
 * deliberately no Hammer Strength or other horizontal chest press. */
substitutions:{
'Chest-Supported DB Row':['Chest-Supported Machine Row'],
'Low-Incline DB Press':['Low-Incline Barbell Press'],
'Neutral-Grip Lat Pulldown':['Wide-Grip Lat Pulldown'],
'Cable Y Raise':['Prone DB Y Raise'],
'EZ-Bar Curl':['Straight-Bar Curl','DB Curl'],
'45-Degree Leg Press':['Horizontal Leg Press'],
'Seated Leg Curl':['Lying Leg Curl'],
'Standing Calf Raise Machine':['Leg Press Calf Raise'],
'Seated Cable Knee Extension':['Spanish Squat'],
'Standing Cable Leg Curl':['Sliding Leg Curl'],
'Cable Lateral Raise':['DB Lateral Raise'],
'Cable Triceps Pushdown':['Rope Pushdown'],
'Seated Cable Row':['Chest-Supported Machine Row']},
substitutionConventions:{'Chest-Supported Machine Row':'machine_display_lb','Low-Incline Barbell Press':'bar_included_total_lb','Wide-Grip Lat Pulldown':'machine_display_lb','Prone DB Y Raise':'per_dumbbell_lb','Straight-Bar Curl':'bar_included_total_lb','DB Curl':'per_dumbbell_lb','Horizontal Leg Press':'plates_only_total_lb','Lying Leg Curl':'machine_display_lb','Leg Press Calf Raise':'plates_only_total_lb','Spanish Squat':'single_implement_lb','Sliding Leg Curl':'single_implement_lb','DB Lateral Raise':'per_dumbbell_lb','Rope Pushdown':'machine_display_lb'},
checklist:[
'Four sessions a week, run as a sequence: Upper A → Lower A → Upper B → Lower B. A delayed session just slides — continue the sequence and never stack catch-up workouts.',
'One easier pre-block deload week first, then six training cycles. A cycle is one completion of all four workouts (office and YMCA versions count the same) — usually a week, longer if needed. Cycles advance only when you mark workouts complete.',
'Cycle 1: listed sets and reps at 3 RIR on everything. Cycles 2–6: each exercise’s own RIR target. Flat bench and overhead press always stay at 3 RIR.',
'Flat bench: two moderate sets of 8–10 at 3 RIR, lighter than the old 165-lb work. No third or fourth sets and no back-off sets.',
'Seated barbell overhead press (2 × 6–10 at 3 RIR) replaces the old Upper B chest-press slot. No Hammer Strength iso-chest press and no extra horizontal chest press in this block.',
'Incline DBs stay: build toward 15 reps on both sets at 2 RIR before considering a switch — a practical trigger, not a limit on growth.',
'RDLs, SSB squats and supported split squats stay. The extra Lower B squat/pull-through slot is gone — keep full rest on the main lifts.',
'Normal volume: 50 working sets per cycle (Upper A 13, Lower A 13, Upper B 13, Lower B 11). Unilateral sets count once per exercise.',
'Symptom stop rules override every set, rep, load and progression target.'],
referenceSections:[
{title:'Pre-block deload',items:['Complete each workout once over roughly 7–10 days.','One working set per exercise (normal sets halved and rounded down, minimum one) at 4–5 RIR — lower the load or reps as needed.','Keep the normal rest intervals and don’t chase personal records. These four sessions don’t count toward the six cycles.']},
{title:'Starting weights',items:['Use the most recent comparable session as a reference, then calibrate to the prescribed rep range and RIR — the RIR target beats any suggested number.','Flat bench has no mandatory starting weight: choose a load lighter than the historical 165-lb work that allows 8–10 clean reps at 3 RIR with no symptoms. The earlier 150–155-lb idea is not an automatic target.','RDL: 155–160 lb is a reasonable first-cycle trial based on the logs, not a requirement. Seated overhead press: calibrate independently for 6–10 reps at 3 RIR — don’t automatically copy 105 lb.','Incline DBs can stay at 70 lb per hand if at least 8 clean reps leave 3 RIR; otherwise use a lighter pair. Recalibrate SSB squats for the new 8–10 range.','No universal machine starting loads — the history spans different machines and conventions.']},
{title:'Double progression',items:['Add reps within the range at the prescribed RIR. When every working set reaches the top of the range at or above the minimum RIR — consistent technique, comfortable symptoms — add 5 lb to a barbell or the smallest practical DB, cable or machine increment.','Unilateral work: both sides must qualify. A large equipment jump can mean staying at a load longer. Don’t manufacture an increase every session.','First set below the minimum: reduce about 5–10% (or the smallest appropriate step) instead of grinding. Later sets dropping: use the full rest first, then lower the load if needed — log each set’s load accurately.','Flat-bench exception: both sets must reach 10 reps at 3 RIR, with consistent technique and no symptoms during training, later that day or the next morning, on two consecutive sessions before a 5-lb increase. Unknown next-day status defers the increase. The two-set cap and 8–10 range never change, and progression never returns automatically to heavy low-rep work.','After three comparable sessions without added load or reps, review rest, symptoms, execution, sleep and scheduling before changing volume. An illness session, a different machine or a deload doesn’t count as a plateau.']},
{title:'Warm-ups',items:['A few minutes of easy movement if useful.','First main lift: 2–3 easy ramp sets, for example 40–50% × 6–8, 65–70% × 4–5 and 80–85% × 2–3 of the working load.','Later similar movements need fewer ramps (0–2); incline pressing usually needs one easy acclimation set after flat bench.','Warm-ups are logged separately and never count as working sets, volume or progression.']},
{title:'Rest, pairs and short sessions',items:['Full rest on the first two exercises — straight sets while you calibrate.','Optional pairs: Y raise + curl (Upper A) and lateral raise + pushdown (Upper B). Keep at least 90 s between sets of the same exercise, including the time spent on its partner, and only pair if neither performance nor symptoms get worse.','Do incline press and pulldown separately at first so performance is repeatable.','Short on time? Drop an accessory set and log it — don’t rush the main lifts.']},
{title:'Office equipment',items:['Office dumbbells top out at 70 lb, plus a ~71-lb kettlebell — the app never suggests more than that at the office. Never copy an 85-lb split-squat entry into an office session.','At that load ceiling, supported split squats can run to 15 reps per leg before reassessing.','The office Lower B calf exercise is the established seated barbell version — make sure support and padding are stable. Use an ankle cuff for single-leg cable curls and extensions.','If an attachment isn’t available, pick and log an explicit alternative instead of relabeling another exercise.','Machine and cable loads are only compared within the same gym — and the same machine, if you name it. A different machine resets load calibration, not your cycle.']},
{title:'Shoulder and back',items:['During flare-ups the shoulder caught or jammed near the bottom of heavy horizontal pressing, with slight pain and a need to reposition — more often late in bench sets 3–4. Overhead pressing stayed comfortable and symptoms have improved. That doesn’t establish a diagnosis or guarantee that two heavy sets are safe.','Use only symptom-free pressing at the prescribed reserve. If catching, pain or a need to reposition occurs, stop and safely rack — don’t reposition under load and push through. Check in on the shoulder later that day and the next morning.','Arrange a routine sports-physio assessment before returning to heavier, lower-repetition bench work.','If the shoulder becomes stuck and won’t release, or sudden marked weakness or inability to lift the arm develops, seek urgent assessment.','Stop and get assessed for exertional chest symptoms, new neurological signs or severe persistent joint pain.','No current training-related back pain is reported: RDLs, SSB squats and split squats stay, but never force range or progression through pain.','No planned failure sets, forced reps, drop sets or rest-pause work.']},
{title:'Scheduling and conditioning',items:['Example week: Upper A / Lower A / rest / Upper B / rest / Lower B / rest. Your calendar days and times from the Sunday review carry over.','Aim to separate training of the same region by about 48 hours, and place lower sessions around hockey according to how you actually recover.','Keep two familiar, easy Zone 2 sessions of 30–45 minutes if they fit around existing cardio and hockey — on rest days or after upper sessions. No harder conditioning is added during the lifting transition.']},
{title:'Tracking and review',items:['Blank means unknown, not zero. Suggested loads are shown separately and never logged for you; warm-ups are tagged separately.','For a weight goal, use consistent morning weigh-ins and a weekly average; a weekly waist measurement is optional. Lifted load alone doesn’t prove muscle gain.','After cycle 6 the app shows a performance, completion, symptom and recovery summary — review it to decide whether to repeat, adjust or deload. Nothing escalates volume or forces a deload automatically.']},
{title:'Evidence',items:['The exercise mix, set counts and six-cycle length are individualized coaching decisions. Evidence supports adequate rest and productive training short of failure; it doesn’t establish this precise routine as uniquely optimal.','Schoenfeld et al. — longer versus shorter interset rest in resistance-trained men (PubMed 26605807).','Refalo et al. — training to failure versus repetitions in reserve in trained participants (PubMed 38393985).','NHS — shoulder pain guidance (nhs.uk/symptoms/shoulder-pain).']}],
recoveryNote:'Rest days: easy Zone 2 (30–45 min) if it fits around hockey, or walking and mobility. A missed session simply slides — continue the sequence.'}};

/* Office gym mode (Upper/Lower program only): swaps the two lower days. */
const OFFICE_WORKOUT_MAP={lowerA:'lowerAOffice',lowerB:'lowerBOffice'},OFFICE_BASE_MAP={lowerAOffice:'lowerA',lowerBOffice:'lowerB'};

/* Alias table so exercise history follows a movement across substitutions
 * and across program-name variants (e.g. old logs recorded under a
 * different name still feed "Last:" hints, suggestions and trends). */
const EXERCISE_ALIASES={
  'Horizontal Leg Press / 45° Leg Press':['Horizontal Leg Press (Tippy)','45° Leg Press','Leg Press'],
  'Hack Squat / SSB Squat / Leg Press Variant':['Hack Squat / Leg Press Variant','Hack Squat','SSB Squat','Safety Bar Squat'],
  'Lying or Seated Leg Curl':['Lying Leg Curl','Seated Leg Curl','Hamstring Curls','Leg Curl'],
  'Triceps Pushdown / Overhead Extension':['Triceps Pushdown','Overhead Triceps Extension','Cable Triceps Pushdown'],
  'Goblet Squat or Light Leg Press':['Leg Press (Flat Foot)','Goblet Squat','Light Leg Press'],
  'Hand-Supported Split Squat':['Bulgarian Split Squat','Bulgarian Split Squats','Rear Foot Elevated Split Squat'],
  'Barbell Romanian Deadlift':['Romanian Deadlift','Romanian Deadlifts','Barbell RDL','DB Romanian Deadlift'],
  // 'DB Glute Bridge' is deliberately NOT in this group: it loads far
  // lighter than the barbell variants, and conflating it here would make
  // "Last:"/suggestions compare across equipment (the exact ambiguity this
  // substitution split exists to remove).
  'Barbell Hip Thrust / Glute Bridge':['Hip Thrust','Hip Thrusts','Barbell Hip Thrust','Barbell Glute Bridge','Glute Bridge'],
  'Spanish Squat / Cable Knee Extension':['Spanish Squat','Cable Knee Extension','Leg Extension','Leg Extensions'],
  'Cable Leg Curl':['Lying Leg Curl','Seated Leg Curl','Hamstring Curls','Swiss Ball Leg Curl','DB Leg Curl'],
  'Seated DB Calf Raise':['Seated Calf Raise','Seated Dumbbell Calf Raise'],
  'SSB Squat':['Safety Bar Squat','Smith Squat','Horizontal Leg Press (Tippy)'],
  'Landmine Squat':['Hack Squat / Leg Press Variant','Heel-Elevated Goblet Squat']
};
