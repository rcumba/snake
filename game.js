(() => {
  'use strict';
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreLabel = document.getElementById('score');
  const bestLabel = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const startButton = document.getElementById('start');
  const pauseButton = document.getElementById('pause');
  const status = document.getElementById('status');
  const menu = document.getElementById('menu');
  const session = document.getElementById('session');
  const arena = document.getElementById('arena');
  let columns = 24, rows = 24;
  const cell = 30;
  const ground = document.createElement('canvas');
  function fitBoard() {
    const scale = Math.min((arena.clientWidth-18)/(columns*cell),(arena.clientHeight-18)/(rows*cell));
    arena.style.setProperty('--board-width', `${Math.max(0,columns*cell*scale)}px`);
    arena.style.setProperty('--board-height', `${Math.max(0,rows*cell*scale)}px`);
  }
  new ResizeObserver(fitBoard).observe(arena);
  window.addEventListener('resize', fitBoard);
  function prepareField() {
    const ratio = Math.max(.25,Math.min(4,arena.clientWidth/Math.max(1,arena.clientHeight)));
    columns = ratio >= 1 ? Math.round(24*ratio) : 24;
    rows = ratio >= 1 ? 24 : Math.round(24/ratio);
    canvas.width = columns*cell;canvas.height = rows*cell;
    ground.width = canvas.width;ground.height = canvas.height;
    const g = ground.getContext('2d');
    const light = g.createRadialGradient(canvas.width*.4,canvas.height*.35,0,canvas.width*.5,canvas.height*.5,canvas.width*.8);
    light.addColorStop(0,'#35402a');light.addColorStop(.55,'#283222');light.addColorStop(1,'#19281d');
    g.fillStyle=light;g.fillRect(0,0,canvas.width,canvas.height);
    let seed=173;
    const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
    for(let i=0;i<canvas.width*canvas.height/150;i++) {
      const x=random()*canvas.width,y=random()*canvas.height;
      g.fillStyle=random()>.5?'#ced09708':'#060e0914';
      g.beginPath();g.ellipse(x,y,random()*3+.4,random()*1.6+.3,random()*6,0,Math.PI*2);g.fill();
    }
    fitBoard();
  }
  const vectors = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
  let snake, direction, turns, food, score, timer, state = 'ready', best = 0;
  let previousSnake = null, movedAt = 0, moveDuration = 160, animation;
  const bonusLabel = document.getElementById('bonus-status');
  let giant = null, normalEaten = 0, growthPending = 0, bonusLast = 0, rewardMs = 0;
  const inGiant = (p) => giant && p.x>=giant.x && p.x<giant.x+2 && p.y>=giant.y && p.y<giant.y+2;
  function updateBonusLabel() {
    bonusLabel.hidden = !giant && rewardMs<=0;
    bonusLabel.textContent = giant ? `GIANT +30 · ${(giant.remaining/1000).toFixed(1)}s` : '+30 · Giant Apple!';
  }
  function clearBonus() {
    giant=null;normalEaten=0;growthPending=0;rewardMs=0;bonusLast=performance.now();updateBonusLabel();
  }
  function advanceBonus(now=performance.now()) {
    if(state!=='running')return;
    const elapsed=Math.max(0,now-bonusLast);bonusLast=now;
    if(giant) {giant.remaining-=elapsed;if(giant.remaining<=0)giant=null;}
    rewardMs=Math.max(0,rewardMs-elapsed);updateBonusLabel();
  }
  function tryGiant() {
    if(giant || Math.random()>=.4)return;
    // Flood-fill free space from the head. Only consider clear 2x2 footprints
    // reachable without crossing the current body and within the time budget.
    const blocked=new Set(snake.slice(1).map(p=>`${p.x},${p.y}`));
    const distances=new Map([[`${snake[0].x},${snake[0].y}`,0]]),queue=[snake[0]];
    for(let i=0;i<queue.length;i++) {
      const p=queue[i],distance=distances.get(`${p.x},${p.y}`);
      if(distance>=Math.floor(10000/160)-2)continue;
      for(const v of Object.values(vectors)) {
        if(i===0 && v.x===-direction.x && v.y===-direction.y)continue;
        const q={x:p.x+v.x,y:p.y+v.y},key=`${q.x},${q.y}`;
        if(q.x<0||q.x>=columns||q.y<0||q.y>=rows||blocked.has(key)||distances.has(key))continue;
        distances.set(key,distance+1);queue.push(q);
      }
    }
    const occupied=new Set(snake.map(p=>`${p.x},${p.y}`)),choices=[];
    for(let y=0;y<rows-1;y++)for(let x=0;x<columns-1;x++) {
      const cells=[{x,y},{x:x+1,y},{x,y:y+1},{x:x+1,y:y+1}];
      if(cells.every(p=>!occupied.has(`${p.x},${p.y}`)&&(!food||p.x!==food.x||p.y!==food.y)) && cells.some(p=>distances.has(`${p.x},${p.y}`)))choices.push({x,y});
    }
    if(choices.length) {giant={...choices[Math.floor(Math.random()*choices.length)],remaining:10000};bonusLast=performance.now();updateBonusLabel();}
  }
  // Storage can be unavailable in private browsing or for local files.
  try { best = Math.max(0, Number(localStorage.getItem('snake-best')) || 0); } catch (_) {}
  bestLabel.textContent = best;
  function placeFood() {
    const free = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      if (!inGiant({x,y}) && !snake.some(segment => segment.x === x && segment.y === y)) free.push({x,y});
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }
  function reset() {
    clearTimeout(timer);
    cancelAnimationFrame(animation);
    previousSnake = null;clearBonus();
    const x=Math.floor(columns/2),y=Math.floor(rows/2);
    snake = [{x,y},{x:x-1,y},{x:x-2,y},{x:x-3,y},{x:x-4,y},{x:x-5,y}];
    direction = vectors.right;
    turns = [];
    score = 0;
    scoreLabel.textContent = score;
    food = placeFood();
    draw();
  }
  // The grid remains authoritative. Curves and small lateral offsets are visual
  // only, kept within the occupied cells so controls and collisions stay stable.
  function draw(progress = 1, now = performance.now()) {
    ctx.drawImage(ground,0,0);
    for(const item of [food && {...food,special:false},giant && {...giant,special:true}].filter(Boolean)) {
      const x=(item.x+(item.special?1:.5))*cell,y=(item.y+(item.special?1:.5))*cell;
      ctx.save();ctx.translate(x,y);
      if(item.special) {
        ctx.strokeStyle='#ffe49c';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,27,-Math.PI/2,-Math.PI/2+Math.PI*2*item.remaining/10000);ctx.stroke();
        const pulse=1.65+Math.sin(now*.006)*.06;ctx.scale(pulse,pulse);
      }
      ctx.shadowColor=item.special?'#ffdb65':'#ffc56b55';ctx.shadowBlur=item.special?22:15;
      const red=ctx.createRadialGradient(-4,-5,1,0,0,13);
      red.addColorStop(0,'#ffbc72');red.addColorStop(.3,'#f85d3d');red.addColorStop(.7,'#c82924');red.addColorStop(1,'#7b171b');
      ctx.fillStyle=red;ctx.beginPath();ctx.moveTo(0,-8);
      ctx.bezierCurveTo(-17,-16,-15,10,-4,12);ctx.quadraticCurveTo(0,9,4,12);
      ctx.bezierCurveTo(15,10,17,-16,0,-8);ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle='#ba945b';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(0,-7);ctx.quadraticCurveTo(-1,-12,2,-15);ctx.stroke();
      ctx.fillStyle='#9dcc55';ctx.beginPath();ctx.ellipse(6,-12,6,2.7,-.4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffe9ca99';ctx.beginPath();ctx.ellipse(-6,-4,2,3.7,.5,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    let nodes=snake.map(p=>({...p}));
    if(previousSnake && progress<1) {
      nodes=[mix(previousSnake[0],snake[0],progress),...snake.slice(1)];
      if(snake.length===previousSnake.length) nodes.push(mix(previousSnake.at(-1),snake.at(-1),progress));
    }
    nodes=nodes.map(p=>({x:(p.x+.5)*cell,y:(p.y+.5)*cell}));
    // Round corners with quadratic curves, then sample along their arc length.
    const curve=[nodes[0]];
    for(let i=1;i<nodes.length-1;i++) {
      const a=mix(nodes[i],nodes[i-1],.28),b=mix(nodes[i],nodes[i+1],.28);
      curve.push(a);
      for(let j=1;j<=6;j++) {const t=j/6;curve.push(mix(mix(a,nodes[i],t),mix(nodes[i],b,t),t));}
    }
    curve.push(nodes.at(-1));
    const samples=[curve[0]];let carry=0;
    for(let i=1;i<curve.length;i++) {
      const a=curve[i-1],b=curve[i],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(!length)continue;
      for(let d=3-carry;d<=length;d+=3)samples.push(mix(a,b,d/length));
      carry=(carry+length)%3;
    }
    samples.push(curve.at(-1));
    const body=samples.map((p,i)=>{
      const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)];
      const angle=Math.atan2(b.y-a.y,b.x-a.x);
      const wave=Math.sin(i*.22-now*.007)*cell*.07*Math.min(1,i/10);
      return {x:p.x-Math.sin(angle)*wave,y:p.y+Math.cos(angle)*wave};
    });
    const edges=body.map((p,i)=>{
      const a=body[Math.max(0,i-1)],b=body[Math.min(body.length-1,i+1)];
      const angle=Math.atan2(b.y-a.y,b.x-a.x),radius=cell*.32*Math.min(1,.10+(body.length-1-i)/17);
      return {p,angle,radius,left:{x:p.x-Math.sin(angle)*radius,y:p.y+Math.cos(angle)*radius},right:{x:p.x+Math.sin(angle)*radius,y:p.y-Math.cos(angle)*radius}};
    });
    ctx.save();ctx.shadowColor='#08140bd0';ctx.shadowBlur=4;ctx.shadowOffsetY=2;
    ctx.beginPath();ctx.moveTo(edges[0].left.x,edges[0].left.y);
    for(const e of edges)ctx.lineTo(e.left.x,e.left.y);
    for(const e of [...edges].reverse())ctx.lineTo(e.right.x,e.right.y);
    ctx.closePath();ctx.fillStyle='#93b653';ctx.fill();ctx.restore();
    ctx.save();ctx.clip();
    ctx.strokeStyle='#d6e49266';ctx.lineWidth=5;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
    body.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x-2,p.y-2);else ctx.lineTo(p.x-2,p.y-2);});ctx.stroke();
    for(let i=7;i<edges.length-8;i+=6){const e=edges[i];ctx.fillStyle='#35532b88';ctx.beginPath();ctx.ellipse(e.p.x,e.p.y,e.radius*.68,e.radius*.4,e.angle,0,Math.PI*2);ctx.fill();}
    ctx.restore();
    const head=nodes[0];
    ctx.save();ctx.translate(head.x,head.y);ctx.rotate(Math.atan2(direction.y,direction.x));
    if(state==='running' && Math.sin(now*.004)>.88) {
      ctx.strokeStyle='#e77a72';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(18,0);ctx.lineTo(21,-3);ctx.moveTo(18,0);ctx.lineTo(21,3);ctx.stroke();
    }
    const skin=ctx.createLinearGradient(0,-11,0,11);skin.addColorStop(0,'#d9e799');skin.addColorStop(.5,'#accc68');skin.addColorStop(1,'#5d8537');
    ctx.fillStyle=skin;ctx.beginPath();ctx.ellipse(1,0,cell*.46,cell*.35,0,0,Math.PI*2);ctx.fill();
    for(const sign of [-1,1]) {
      ctx.fillStyle='#f6d880';ctx.beginPath();ctx.ellipse(5,sign*7,3.7,3,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#152219';ctx.beginPath();ctx.ellipse(6,sign*7,1.2,2.5,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff9d9';ctx.beginPath();ctx.arc(5.5,sign*7-1,.8,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  function animate(now) {
    if(state !== 'running') return;
    advanceBonus(now);
    draw(Math.min(1,(now-movedAt)/moveDuration),now);
    animation = requestAnimationFrame(animate);
  }
  function schedule() {
    moveDuration = Math.max(70,160-Math.floor(score/30)*10);
    timer = setTimeout(tick,moveDuration);
  }
  function tick() {
    if(state !== 'running') return;
    advanceBonus();
    if(turns.length) direction = turns.shift();
    const head = {x:snake[0].x+direction.x,y:snake[0].y+direction.y};
    const eating = food && head.x === food.x && head.y === food.y;
    // The tail vacates its cell on a normal move, so that cell is safe.
    const eatingGiant = inGiant(head);
    const body = (eating || eatingGiant || growthPending>0) ? snake : snake.slice(0,-1);
    if(head.x<0 || head.x>=columns || head.y<0 || head.y>=rows || body.some(s=>s.x===head.x && s.y===head.y)) {
      finish(false);return;
    }
    previousSnake = snake.map(p=>({...p}));
    movedAt = performance.now();
    snake.unshift(head);
    if(eating) {score+=10;normalEaten++;growthPending++;}
    if(eatingGiant) {score+=30;growthPending+=3;giant=null;rewardMs=1100;}
    if(growthPending>0)growthPending--;else snake.pop();
    if(eating || eatingGiant) {
      scoreLabel.textContent=score;
      if(score>best) {best=score;bestLabel.textContent=best;try {localStorage.setItem('snake-best',String(best));}catch(_) {}}
    }
    if(eating) {
      food=placeFood();
      // A bonus must never prevent normal food from returning on a packed board.
      if(!food && giant) {giant=null;food=placeFood();}
      if(food && normalEaten%5===0)tryGiant();
    }
    updateBonusLabel();
    draw(0);
    if(!food) {finish(true);return;}
    schedule();
  }
  function show(heading, description, button) {
    title.textContent = heading;message.textContent = description;startButton.textContent = button;overlay.hidden = false;
  }
  function start() {
    menu.hidden = true;session.hidden = false;prepareField();
    reset();state = 'running';overlay.hidden = true;pauseButton.disabled = false;pauseButton.textContent = 'Pause';status.textContent = 'Keep growing';schedule();animation = requestAnimationFrame(animate);
  }
  function finish(won) {
    clearTimeout(timer);cancelAnimationFrame(animation);draw();state = 'over';pauseButton.disabled = true;
    status.textContent = won ? 'Board complete!' : 'Game over';
    show(won ? 'You filled the board!' : 'One more round?',`You scored ${score} points. ${won ? 'Perfectly played.' : 'Try again and beat your best.'}`,'Play again');
  }
  function pause() {
    if(state === 'running') {
      advanceBonus();clearTimeout(timer);cancelAnimationFrame(animation);draw();state = 'paused';pauseButton.textContent = 'Resume';status.textContent = 'Paused';show('Take a breath.','Your snake will be right here.','Resume game');
    } else if(state === 'paused') {
      previousSnake = null;bonusLast=performance.now();state = 'running';overlay.hidden = true;pauseButton.textContent = 'Pause';status.textContent = 'Keep growing';schedule();animation = requestAnimationFrame(animate);
    }
  }
  function steer(name) {
    if(state !== 'running' || turns.length >= 2) return;
    const next = vectors[name], previous = turns.length ? turns[turns.length-1] : direction;
    if(next.x === previous.x && next.y === previous.y) return;
    if(next.x === -previous.x && next.y === -previous.y) return;
    turns.push(next);
  }
  const keys = {arrowup:'up',w:'up',arrowdown:'down',s:'down',arrowleft:'left',a:'left',arrowright:'right',d:'right'};
  document.addEventListener('keydown',event => {
    if(event.ctrlKey || event.altKey || event.metaKey) return;
    if(!menu.hidden) return;
    const key = event.key.toLowerCase();
    if(keys[key]) {event.preventDefault();steer(keys[key]);}
    else if(key === ' ' || key === 'p') {
      // Keep native Space activation for focused buttons.
      if(key === ' ' && event.target.tagName === 'BUTTON') return;
      event.preventDefault();if(event.repeat) return;
      if(state === 'ready' || state === 'over') start();else pause();
    }
  });
  startButton.addEventListener('click',()=> {if(state === 'paused') pause();else start();startButton.blur();});
  pauseButton.addEventListener('click',()=> {pause();pauseButton.blur();});
  document.getElementById('restart').addEventListener('click',event=> {start();event.currentTarget.blur();});
  document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('click',()=>{steer(button.dataset.direction);button.blur();}));
  document.addEventListener('visibilitychange',()=> {if(document.hidden && state === 'running') pause();});
  window.addEventListener('blur',()=> {if(state === 'running') pause();});
  document.getElementById('play').addEventListener('click',event=>{start();event.currentTarget.blur();});
  document.getElementById('how').addEventListener('click',()=>{
    document.getElementById('instructions').hidden = false;
    document.getElementById('how').hidden = true;
    document.getElementById('close-help').focus();
  });
  document.getElementById('close-help').addEventListener('click',()=>{
    document.getElementById('instructions').hidden = true;
    document.getElementById('how').hidden = false;
    document.getElementById('how').focus();
  });
  document.getElementById('menu-button').addEventListener('click',()=>{
    clearTimeout(timer);cancelAnimationFrame(animation);state = 'ready';clearBonus();
    session.hidden = true;menu.hidden = false;overlay.hidden = true;
    document.getElementById('play').focus();
  });
  ground.width=canvas.width;ground.height=canvas.height;
  reset();
})();
