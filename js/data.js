/* Workout v2 — program data.
 * Pure data, no logic or DOM access. Loaded before js/app.js via a classic
 * <script> tag, so everything here is a global read by app.js.
 *
 * Shape of an exercise: { name, sets, repsMin, repsMax, rest (seconds),
 *   type: 'compound'|'accessory', region, step (progression increment, lb),
 *   and ONE intensity spec: rirTarget (RIR) | intensityType:'rpe' (+ min/max)
 *   | intensityType:'special' (+ intensityLabel/intensityHint). }
 */

const PROGRAMS={
upperLower12:{key:'upperLower12',title:'12-Week Upper / Lower Hypertrophy',shortName:'Upper / Lower',profileHint:'dad',deloadWeek:7,
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
{name:'Standing Calf Raise',sets:4,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'DB, SSB, or rack-supported. Full ROM.'}]},
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
{name:'Barbell Hip Thrust / Glute Bridge',sets:3,repsMin:8,repsMax:12,rirTarget:2,rest:150,type:'compound',region:'lower',step:10,note:'Glute volume without turning the session into a squat day.'},
{name:'Cable Leg Curl',sets:3,repsMin:10,repsMax:15,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'Cable, DB, band, or KBox curl if setup is practical.'},
{name:'Seated DB Calf Raise',sets:4,repsMin:12,repsMax:20,rirTarget:2,rest:90,type:'accessory',region:'lower',step:5,note:'DB across knees or single-leg variation. Full ROM.'}]}},
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
'Barbell Hip Thrust / Glute Bridge':['Barbell Glute Bridge','Smith Hip Thrust','Cable Pull-Through','KBox Hip Thrust','Single-Leg Hip Thrust'],
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
recoveryNote:'Day 3 is rest or light cardio. Weekend can be full recovery or a make-up session.'}};

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
  'Barbell Hip Thrust / Glute Bridge':['Hip Thrust','Hip Thrusts','Barbell Glute Bridge','Glute Bridge'],
  'Spanish Squat / Cable Knee Extension':['Spanish Squat','Cable Knee Extension','Leg Extension','Leg Extensions'],
  'Cable Leg Curl':['Lying Leg Curl','Seated Leg Curl','Hamstring Curls','Swiss Ball Leg Curl','DB Leg Curl'],
  'Seated DB Calf Raise':['Seated Calf Raise','Seated Dumbbell Calf Raise'],
  'SSB Squat':['Safety Bar Squat','Smith Squat','Horizontal Leg Press (Tippy)'],
  'Landmine Squat':['Hack Squat / Leg Press Variant','Heel-Elevated Goblet Squat']
};
