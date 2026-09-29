export {};
const hero=document.querySelector<HTMLElement>('[data-hero-carousel]');
if(hero){
 const slides=[...hero.querySelectorAll<HTMLElement>('[data-hero-slide]')],dots=[...hero.querySelectorAll<HTMLButtonElement>('[data-hero-dot]')];let index=0;
 const select=(next:number)=>{index=(next+slides.length)%slides.length;slides.forEach((slide,i)=>{slide.hidden=i!==index;});dots.forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===index)));hero.dataset.activeSlide=String(index);const count=hero.querySelector('[data-hero-counter]');if(count)count.textContent=`${index+1} / ${slides.length}`;};
 hero.querySelectorAll<HTMLButtonElement>('[data-hero-step]').forEach(button=>button.addEventListener('click',()=>select(index+Number(button.dataset.heroStep))));dots.forEach((dot,i)=>dot.addEventListener('click',()=>select(i)));
 hero.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();select(index+(event.key==='ArrowLeft'?-1:1));if(event.target instanceof Element&&event.target.closest('[data-hero-slide],[data-hero-dot]'))dots[index]?.focus();}});
 let start:{x:number;y:number}|undefined,suppressClick=false;const stage=hero.querySelector<HTMLElement>('[data-hero-stage]')!;
 stage.addEventListener('pointerdown',event=>{suppressClick=false;if(event.pointerType==='touch'||event.pointerType==='pen'){start={x:event.clientX,y:event.clientY};suppressClick=false;}});
 stage.addEventListener('pointercancel',()=>{start=undefined;});stage.addEventListener('pointerup',event=>{if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;start=undefined;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){select(index+(dx<0?1:-1));suppressClick=true;}});
 stage.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;}},true);
}
const motion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
document.querySelectorAll<HTMLElement>('[data-home-rail]').forEach(shell=>{
 const track=shell.querySelector<HTMLElement>('[data-rail-track]')!,buttons=[...shell.querySelectorAll<HTMLButtonElement>('[data-rail-step]')];
 const update=()=>{const end=Math.max(0,track.scrollWidth-track.clientWidth);const controls=shell.querySelector<HTMLElement>('.rail-controls');if(controls)controls.hidden=end<=2;buttons.forEach(button=>button.disabled=Number(button.dataset.railStep)<0?track.scrollLeft<=2:track.scrollLeft>=end-2);};
 const move=(direction:number)=>{const card=track.firstElementChild as HTMLElement|null;const gap=parseFloat(getComputedStyle(track).columnGap)||0;track.scrollBy({left:direction*((card?.getBoundingClientRect().width??track.clientWidth)+gap),behavior:motion()});};
 buttons.forEach(button=>button.addEventListener('click',()=>move(Number(button.dataset.railStep))));track.addEventListener('keydown',event=>{if(event.target===track&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}});track.addEventListener('scroll',update,{passive:true});new ResizeObserver(update).observe(track);track.querySelectorAll('img').forEach(img=>img.addEventListener('load',update));update();
});
