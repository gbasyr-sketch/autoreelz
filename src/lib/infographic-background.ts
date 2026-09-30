export const backgroundShapes=[
 {value:'panel',label:'Скруглённая панель'},
 {value:'diagonal',label:'Диагональ'},
 {value:'arch',label:'Арка'},
 {value:'wave',label:'Волна'},
 {value:'circle',label:'Круг'},
 {value:'duo',label:'Две панели'},
] as const;
export type BackgroundShape=typeof backgroundShapes[number]['value'];
export function drawInfographicShape(ctx:CanvasRenderingContext2D,shape:BackgroundShape,color:string){
 ctx.save();ctx.fillStyle=color;ctx.beginPath();
 switch(shape){
  case 'panel':ctx.roundRect(970,0,620,1000,90);break;
  case 'diagonal':ctx.moveTo(1160,0);ctx.lineTo(1500,0);ctx.lineTo(1500,1000);ctx.lineTo(760,1000);ctx.closePath();break;
  case 'arch':ctx.roundRect(850,85,700,1110,[350,350,0,0]);break;
  case 'wave':ctx.moveTo(1120,0);ctx.lineTo(1500,0);ctx.lineTo(1500,1000);ctx.lineTo(1020,1000);ctx.bezierCurveTo(620,820,1400,260,1120,0);ctx.closePath();break;
  case 'circle':ctx.ellipse(1240,510,480,480,0,0,Math.PI*2);break;
  case 'duo':ctx.roundRect(950,0,620,320,90);ctx.roundRect(880,345,710,655,100);break;
 }
 ctx.fill();ctx.restore();
}
