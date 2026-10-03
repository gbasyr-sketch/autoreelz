export type CollageCell={x:number;y:number;width:number;height:number};
export function collageLayout(count:number){
 if(!Number.isInteger(count)||count<1||count>20)throw new Error('Выберите от 1 до 20 позиций для коллажа.');
 const columns=count<=3?count:Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns),gap=8;
 // Portrait cells match the main catalog photographs. Other ratios fit whole inside a cell.
 const unit= Math.min((1600-gap*(columns+1))/columns,(1600-gap*(rows+1))/(rows*4/3));
 const cellWidth=Math.floor(unit),cellHeight=Math.floor(unit*4/3),width=columns*cellWidth+(columns+1)*gap,height=rows*cellHeight+(rows+1)*gap;
 const cells=Array.from({length:count},(_,index)=>{const row=Math.floor(index/columns),length=Math.min(columns,count-row*columns),offset=(width-(length*cellWidth+(length-1)*gap))/2;return{x:offset+(index%columns)*(cellWidth+gap),y:gap+row*(cellHeight+gap),width:cellWidth,height:cellHeight};});
 return{width,height,columns,rows,cells};
}
export function containImage(width:number,height:number,cell:CollageCell){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Не удалось прочитать размер фотографии.');
 const scale=Math.min(cell.width/width,cell.height/height),w=width*scale,h=height*scale;
 return{x:cell.x+(cell.width-w)/2,y:cell.y+(cell.height-h)/2,width:w,height:h};
}
