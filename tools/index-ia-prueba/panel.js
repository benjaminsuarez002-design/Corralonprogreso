/* Se incorpora dentro de index copia ia.html: no depende del nombre del HTML. */
(() => {
 'use strict';
 const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(value);
 const decimal=value=>Number(value).toLocaleString('es-AR',{maximumFractionDigits:2});
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 function parseArea(text){
   const value=norm(text);
   const dimensions=value.match(/(\d+(?:[.,]\d+)?)\s*(?:(?:metros?|mts?\.?|m)\s*)?(?:x|×|\*|\bpor\b)\s*(\d+(?:[.,]\d+)?)\s*(?:metros?|mts?\.?|m)(?:\s*(?:2|²|\^2))?(?![a-z0-9])/);
   if(dimensions){
     const area=Number(dimensions[1].replace(',','.'))*Number(dimensions[2].replace(',','.'));
     dimensions[1]=String(Number(area.toFixed(8)));dimensions.dimensions=true;return dimensions;
   }
   return value.match(/(\d+(?:[.,]\d+)?)\s*(?:metros?\s+cuadrados?|metros?|mts?\.?|m)(?:\s*(?:2|²|\^2))?(?![a-z0-9])/);
 }
 function ceramicModel(text,areaMatch){
   const source=areaMatch?text.slice(0,areaMatch.index)+' '+text.slice(areaMatch.index+areaMatch[0].length):text;
   return source.split(/\b(?:con|mas)\b/)[0]
     .replace(/\b(?:hola|buenas|buenos|dias|tardes|noches|tenes|tienen|tendra|hay|necesito|necesitamos|quiero|busco|buscando|quisiera|mostrame|mostrar|mostras|cuanto|cuantos|cuanta|cuantas|son|sale|salen|cuesta|cuestan|precio|precios|valor|me|te|se|que|por|para|favor|podes|puedo|podrias|es|esta|estan|seria|serian|modelo|modelos|pegamentos?|apegamento|adhesivos?|pastinas?|pastine|pastona|patina|de|del|el|la|lo|los|las|un|una|unos|unas|y|o|en|ceramicos?|ceramicas?|porcelanatos?|pisos?|primera|segunda|1ra|2da|1a|2a|calidad)\b/g,' ')
     .replace(/[^a-z0-9 x]/g,' ').replace(/\s+/g,' ').trim();
 }
 function quote(article,area){
   const m2=Number(article.ceramicoM2),price=Number(article.precioVigente??article.precio);
   if(!article.ceramico||!Number.isFinite(m2)||m2<=0||!Number.isFinite(price)||price<=0)return null;
   const boxes=area?Math.ceil(Number((area/m2).toFixed(8))):null;
   return {article,m2,perM2:price/m2,boxes,coverage:boxes===null?null:boxes*m2,total:boxes===null?null:Math.round(boxes*price*100)/100};
 }
 function choose(list){
   const sorted=[...list].sort((a,b)=>a.perM2-b.perM2),selected=[],seen=new Set();
   const add=item=>{if(item&&!seen.has(item.article.codigo)){seen.add(item.article.codigo);selected.push(item);}};
   add(sorted.find(item=>/\b(1ra|primera|1a|1c)\b/.test(norm(item.article.nombre))));
   add(sorted.find(item=>/\b(2da|segunda|2a|2c)\b/.test(norm(item.article.nombre))));
   add(sorted.find(item=>/43\s*[x×]\s*43/i.test(item.article.nombre)));
   const dimensions=item=>norm(item.article.nombre).match(/\d{2,3}\s*[x×]\s*\d{2,3}/)?.[0].replace(/\s/g,'')||'';
   const sizes=new Set(selected.map(dimensions));
   add(sorted.find(item=>dimensions(item)&&!sizes.has(dimensions(item))));
   for(const index of [0,Math.floor(sorted.length/3),Math.floor(sorted.length*2/3),sorted.length-1]){if(selected.length>=4)break;add(sorted[index]);}
   return selected.slice(0,4);
 }
 window.CorralonIaMath={quote,choose};
 const style=document.createElement('style');style.textContent=`
 #cpIaLaunch{position:fixed;right:16px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:9900;display:flex;align-items:center;gap:9px;border:1px solid #f37b7b;border-radius:30px;padding:12px 18px;background:linear-gradient(135deg,#e0000a,#c80007);color:#fff;box-shadow:0 5px 22px #0003;font:700 15px Arial;cursor:pointer}
 #cpIaLaunch svg{width:23px;height:23px}#cpIaPanel{position:fixed;right:16px;bottom:calc(133px + env(safe-area-inset-bottom));width:min(410px,calc(100vw - 24px));height:min(650px,calc(100dvh - 152px));z-index:9901;background:#fffaf2;color:#24211e;border:1px solid #ebd9c6;border-radius:20px;box-shadow:0 15px 48px #0004;display:flex;flex-direction:column;font:14px Arial;overflow:hidden}#cpIaPanel[hidden]{display:none}
 #cpIaPanel header{background:linear-gradient(120deg,#e4000c,#c70008);color:#fff;padding:13px 16px;display:flex;align-items:center;gap:12px;flex:none}#cpIaPanel button{cursor:pointer}#cpIaClose{margin-left:auto;background:none;border:0;color:#fff;font-size:29px;line-height:1;padding:3px}#cpIaIdentity strong{font-size:23px;display:block;line-height:1.1}#cpIaIdentity span{font-size:12px;display:block;margin-top:4px}.cp-ia-avatar{width:43px;height:43px;overflow:hidden;border:2px solid #fff;border-radius:50%;background:#fff7e9;flex:none;position:relative}.cp-ia-avatar img{width:58px;height:68px;object-fit:contain;position:absolute;left:-7px;top:0}
 #cpIaLog{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain;overflow-anchor:none}.cp-ia-turn{display:flex;flex-direction:column;gap:12px;flex-shrink:0}.cp-ia-turn>*{flex-shrink:0}
 #cpIaWelcome{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:100%;text-align:center}#cpIaWelcome[hidden]{display:none}.cp-ia-hero{position:relative;isolation:isolate;width:100%;height:140px;flex:1 1 140px;min-height:70px;max-height:155px;display:flex;align-items:center;justify-content:center}.cp-ia-hero>img{height:100%;width:auto;max-width:150px;object-fit:contain;position:relative;z-index:1}.cp-ia-site{position:absolute;inset:0;width:100%;height:100%;color:#ead9c3;opacity:.65}
 #cpIaWelcome h2{font:bold 23px/1.15 Arial;margin:0;letter-spacing:-.6px}#cpIaWelcome p{font:14px/1.45 Arial;color:#6a625b;margin:0;max-width:320px}#cpIaHints{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;width:100%;margin-top:2px}#cpIaHints button{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:10px;border:1px solid #e6d4bf;border-radius:13px;background:#fffdf9;padding:12px 9px;min-height:92px;text-align:left;color:#26221f;font:12px/1.25 Arial}#cpIaHints button svg{width:27px;height:27px;color:#d00009}#cpIaHints button span{max-width:82%;pointer-events:none}#cpIaHints button:after{content:'›';position:absolute;right:8px;bottom:13px;color:#d00009;font:bold 22px Arial}#cpIaHints button:hover{background:#fff1e3;border-color:#d00009}
 #cpIaExample{width:100%;border:1px solid #e9dac9;border-radius:28px;padding:9px 13px;background:#faf2e8;color:#24211e;text-align:left;font:12px/1.35 Arial;display:flex;align-items:center;gap:9px}#cpIaExample svg{width:21px;height:21px;flex:none;color:#918a82}#cpIaExample small{display:block;font:700 9px Arial;color:#918a82;margin-bottom:3px;letter-spacing:.5px}#cpIaExample:after{content:'›';margin-left:auto;color:#d00009;font:bold 24px Arial}
 .cp-ia-message{white-space:pre-wrap;line-height:1.45;padding:10px;border-radius:10px;background:white;border:1px solid #eadbca}.cp-ia-user{align-self:flex-end;background:#ffe5cf;max-width:90%}.cp-ia-options{display:grid;gap:8px}.cp-ia-card{border:1px solid #e6d0b5;border-radius:12px;background:white;padding:10px;display:grid;grid-template-columns:66px 1fr;gap:9px}.cp-ia-card img{width:66px;height:78px;object-fit:contain;border-radius:6px}.cp-ia-photo-placeholder{width:66px;height:78px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:#f6f6f5;color:#e4d8c8}.cp-ia-photo-placeholder svg{width:23px;height:23px}.cp-ia-card h4{margin:0 0 5px;font-size:13px;line-height:1.3}.cp-ia-card p{margin:4px 0;font-size:12px}.cp-ia-link,.cp-ia-more{display:inline-block;color:#075ec8;text-decoration:underline;border:0;background:none;font:700 13px Arial;padding:5px 0}.cp-ia-more{width:100%;padding:10px 0;text-align:left;color:#075ec8;text-decoration:underline;border:0;border-radius:0}
 #cpIaForm{margin:0 14px;padding:11px 0 8px;border-top:1px solid #dfd2c3;display:flex;gap:7px;flex:none}#cpIaInput{min-width:0;flex:1;height:43px;padding:10px 12px;border:1px solid #c7c3be;border-radius:11px;background:#fff;font:16px Arial;color:#292522}#cpIaSend{width:43px;height:43px;display:grid;place-items:center;border:0;border-radius:11px;background:#ce0008;color:#fff;padding:10px;flex:none}#cpIaSend svg{width:23px;height:23px}#cpIaSend:disabled{opacity:.5}#cpIaPanel small.cp-ia-note{padding:0 16px 12px;color:#8b847d;font:10px/1.3 Arial;flex:none}
 @media(max-height:700px){#cpIaPanel{bottom:calc(122px + env(safe-area-inset-bottom));height:calc(100dvh - 138px)}#cpIaWelcome{gap:8px}.cp-ia-hero{height:90px;flex-basis:90px;min-height:45px}#cpIaWelcome h2{font-size:20px}#cpIaWelcome p{font-size:12px}#cpIaHints button{min-height:72px;padding:9px 8px;gap:5px}#cpIaHints button svg{width:23px;height:23px}}

 #ceramicoBudgetModal.cp-ia-budget-mode{padding:8px;align-items:center}
 .cp-ia-budget-mode .ceramico-budget-modal{margin-top:0;width:min(96vw,520px);padding:12px;gap:7px;max-height:calc(var(--popup-visual-height,100dvh) - 16px)}
 .cp-ia-budget-mode .ceramico-budget-head{gap:8px}.cp-ia-budget-mode .ceramico-budget-head>div:first-child{min-width:0;flex:1}
 #cpIaBudgetPhotoWrap{float:left;position:relative;width:64px;height:64px;margin:0 9px 3px 0;padding:0;border:0;border-radius:7px;background:#fff;overflow:hidden;cursor:zoom-in}#cpIaBudgetPhoto{display:block;width:100%;height:100%;object-fit:contain}#cpIaBudgetPhotoWrap span{position:absolute;bottom:0;left:0;right:0;padding:3px 0;background:#075ec8;color:#fff;font:700 9px Arial;text-align:center}#cpIaBudgetPhotoWrap:focus-visible{outline:2px solid #075ec8;outline-offset:2px}
 .cp-ia-budget-mode .ceramico-budget-title{font-size:22px}.cp-ia-budget-mode .ceramico-budget-product{font-size:12px;line-height:1.2}
 #cpIaBudgetNav{display:flex;align-items:center;justify-content:center;gap:12px;margin:0}
 #cpIaBudgetNav button{flex:none;min-width:34px;width:34px;min-height:28px;height:28px;padding:0;font-size:20px;line-height:1}
 .cp-ia-budget-mode .ceramico-budget-field{gap:3px}.cp-ia-budget-mode .ceramico-budget-field label{font-size:14px}.cp-ia-budget-mode .ceramico-budget-field input{height:34px;font-size:16px}
 .cp-ia-budget-mode .ceramico-budget-options{padding:7px 9px;gap:4px}.cp-ia-budget-mode .ceramico-budget-selected{font-size:11px;line-height:1.2}
 .cp-ia-budget-mode .ceramico-budget-summary{padding:8px;gap:5px}.cp-ia-budget-mode .ceramico-budget-row{font-size:12px;gap:8px;line-height:1.15}
 .cp-ia-budget-mode .ceramico-budget-total{padding-top:6px;margin-top:2px;font-size:22px}
 .cp-ia-budget-mode .ceramico-budget-actions{gap:8px}.cp-ia-budget-mode .ceramico-budget-actions button{min-height:34px}
 @media(max-height:620px){.cp-ia-budget-mode .ceramico-budget-modal{gap:4px;padding:8px}.cp-ia-budget-mode .ceramico-budget-summary{gap:3px;padding:6px}.cp-ia-budget-mode .ceramico-budget-row{font-size:11px}#cpIaBudgetPhotoWrap{width:50px;height:50px}.cp-ia-budget-mode .ceramico-budget-title{font-size:20px}}
 @media(max-width:600px){#cpIaPanel{right:12px;bottom:calc(140px + env(safe-area-inset-bottom));height:min(620px,calc(100dvh - 165px))}#cpIaLaunch{right:12px}}`;
 document.head.appendChild(style);
 function icon(name){const paths={chat:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z"/>',tiles:'<path d="M3 3h9v9H3zM12 3h9v9h-9zM3 12h9v9H3zM12 12h9v9h-9z"/>',search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',store:'<path d="m3 9 2-6h14l2 6M3 9h18v3a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9ZM5 15v6h14v-6M10 21v-5h4v5"/>',paper:'<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6"/>',send:'<path d="m21 3-7 18-4-8-8-4L21 3ZM10 13 21 3"/>'};return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';}
 const host=document.createElement('div');host.innerHTML=`<button id="cpIaLaunch" type="button" aria-controls="cpIaPanel" aria-expanded="false">${icon("chat")}Preguntale a Obri</button><section id="cpIaPanel" hidden role="dialog" aria-label="Obri, asistente de Corralón Progreso"><header><span class="cp-ia-avatar"><img src="obri-mascota.png" alt=""></span><div id="cpIaIdentity"><strong>Obri</strong><span>Tu ayudante para la obra</span></div><button id="cpIaClose" type="button" aria-label="Cerrar asistente">×</button></header><div id="cpIaLog" aria-live="polite"><div id="cpIaWelcome"><div class="cp-ia-hero"><svg class="cp-ia-site" viewBox="0 0 360 140" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M0 130h360M12 130V35l65 15v80M8 35l73 17M23 130V5M49 130V15M75 130V24M10 73l67 15M10 98l67 15M250 130V23h7v107M224 23h118L254 5l-30 18ZM250 7v16M269 23v49h-11M234 130v-35h48v35M290 130V83h48v47M286 83l28-21 28 21M298 99h9v14h-9M321 99h9v14h-9"/></svg><img src="obri-mascota.png" alt="Obri saludando"></div><h2>¿Qué necesitás para tu obra?</h2><p>Buscá materiales, compará precios<br>y armá tu presupuesto.</p><div id="cpIaHints"><button type="button" data-prompt="cerámicos">${icon("tiles")}<span>Calcular<br>cerámicos</span></button><button type="button" data-action="product">${icon("search")}<span>Buscar un<br>producto</span></button><button type="button" data-prompt="Horarios y retiro">${icon("store")}<span>Horarios y<br>sucursales</span></button></div><button id="cpIaExample" type="button">${icon("paper")}<span><small>POR EJEMPLO</small>50 m² con pegamento y pastina</span></button></div></div><form id="cpIaForm"><input id="cpIaInput" maxlength="700" placeholder="Escribile a Obri…" aria-label="Consulta al asistente" autocomplete="off"><button id="cpIaSend" type="submit" aria-label="Enviar mensaje">${icon("send")}</button></form><small class="cp-ia-note">Precios del catálogo · Confirmá disponibilidad.</small></section>`;document.body.appendChild(host);
 const $=id=>document.getElementById(id),panel=$('cpIaPanel'),input=$('cpIaInput'),log=$('cpIaLog');let busy=false,lastArea=null,previousFocus,activeTurn=null,lastCeramicArea=null,lastBudget=null;const history=[];const articleReferences=new Map();
 function open(){previousFocus=document.activeElement;panel.hidden=false;$('cpIaLaunch').setAttribute('aria-expanded','true');if(history.length)input.focus({preventScroll:true});}
 function close(){panel.hidden=true;$('cpIaLaunch').setAttribute('aria-expanded','false');previousFocus?.focus?.();}
 $('cpIaLaunch').onclick=()=>panel.hidden?open():close();$('cpIaClose').onclick=close;
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}if(event.key==='Tab'){const elements=[...panel.querySelectorAll('button,input,a[href]')].filter(el=>!el.disabled&&!el.hidden),first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
 function appendChat(element){(activeTurn||log).appendChild(element);}
 function startTurn(){
   $('cpIaWelcome').hidden=true;
   activeTurn=document.createElement('div');activeTurn.className='cp-ia-turn';
   const style=getComputedStyle(log),paddingTop=parseFloat(style.paddingTop)||0,paddingBottom=parseFloat(style.paddingBottom)||0;
   activeTurn.style.minHeight=Math.max(0,log.clientHeight-paddingTop-paddingBottom)+'px';
   log.appendChild(activeTurn);
 }
 function showQuestion(){
   if(!log.clientHeight)return;
   const padding=parseFloat(getComputedStyle(log).paddingTop)||0;
   log.scrollTop+=activeTurn.getBoundingClientRect().top-log.getBoundingClientRect().top-log.clientTop-padding;
 }
 function say(text,user=false,remember=true){const el=document.createElement('div');el.className='cp-ia-message'+(user?' cp-ia-user':'');el.textContent=text;appendChat(el);if(remember){history.push({role:user?'user':'assistant',content:text.slice(0,600)});if(history.length>8)history.shift();}return el;}
 function link(code){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('articulo',code);return url.href;}
 log.addEventListener('click',event=>{
   const anchor=event.target.closest('a.cp-ia-link');if(!anchor)return;
   const code=new URL(anchor.href).searchParams.get('articulo'),article=articleReferences.get(code);
   event.preventDefault();if(!article||!window.CorralonIaCatalog?.open)return;
   close();window.CorralonIaCatalog.open(article);
 });
 function emptyPhoto(){
   const placeholder=document.createElement('div');placeholder.className='cp-ia-photo-placeholder';placeholder.setAttribute('role','img');placeholder.setAttribute('aria-label','Artículo sin foto');
   placeholder.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';return placeholder;
 }
 function renderProduct(article,estimate=null){
   articleReferences.set(String(article.codigo),article);
   const price=money(Number(article.precioVigente??article.precio));
   const card=say(article.nombre+' · '+price);card.className='cp-ia-card';
   const photo=[article.fotoUrl,...(Array.isArray(article.imagenes)?article.imagenes:[])].find(url=>typeof url==='string'&&/^https?:\/\//.test(url));
   const content=document.createElement('div'),title=document.createElement('h4'),amount=document.createElement('p'),anchor=document.createElement('a');
   const titleLink=document.createElement('a');titleLink.className='cp-ia-link';titleLink.href=link(article.codigo);titleLink.textContent=article.nombre;title.appendChild(titleLink);amount.textContent=price;amount.style.fontWeight='bold';
   anchor.className='cp-ia-link';anchor.href=link(article.codigo);anchor.textContent='Ver artículo';
   card.textContent='';
   if(photo){const image=document.createElement('img');image.loading='lazy';image.src=photo;image.alt=article.nombre;image.onerror=()=>image.replaceWith(emptyPhoto());card.appendChild(image);}
   else card.appendChild(emptyPhoto());
   content.append(title,amount);
   if(estimate){const summary=document.createElement('p');summary.className='cp-ia-estimate';summary.textContent=estimate.quantity+' '+estimate.unit+' estimados · Total adicional: '+money(estimate.quantity*Number(article.precioVigente??article.precio));content.appendChild(summary);}
   if(estimate?.companion){
     const grout=estimate.companion;articleReferences.set(String(grout.codigo),grout);
     const line=document.createElement('p'),name=document.createElement('a');name.className='cp-ia-link';name.href=link(grout.codigo);name.textContent=grout.nombre;
     line.append('Más '+estimate.quantity+' envases de ',name,' · '+money(estimate.quantity*Number(grout.precioVigente??grout.precio)));
     const total=document.createElement('p');total.className='cp-ia-combined-total';total.style.fontWeight='bold';total.textContent='Pegamento + pastina: '+money(estimate.quantity*(Number(article.precioVigente??article.precio)+Number(grout.precioVigente??grout.precio)));
     content.append(line,total);
   }
   content.appendChild(anchor);card.appendChild(content);
 }
 function renderOptions(options,all,area,term){
   const block=document.createElement('div');block.className='cp-ia-options';
   block.innerHTML=options.slice(0,2).map(item=>{const a=item.article;articleReferences.set(String(a.codigo),a);const photo=a.fotoUrl||a.imagenes?.[0]||'',src=/^https?:\/\//.test(photo)?photo:'';return `<article class="cp-ia-card">${src?`<img loading="lazy" src="${esc(src)}" alt="${esc(a.nombre)}">`:emptyPhoto().outerHTML}<div><h4><a class="cp-ia-link" href="${esc(link(a.codigo))}">${esc(a.nombre)}</a></h4><p>${money(item.perM2)} / m²</p>${area?`<p>${item.boxes} cajas · cubren ${decimal(item.coverage)} m²</p><p><strong>Total: ${money(item.total)}</strong></p>`:`<p>Caja de ${decimal(item.m2)} m²</p>`}${renderCeramicExtras(item)}<a class="cp-ia-link" href="${esc(link(a.codigo))}">Ver artículo</a></div></article>`;}).join('');
   block.querySelectorAll('img').forEach(image=>image.onerror=()=>image.replaceWith(emptyPhoto()));
   appendChat(block);
   if(options.length)addSimilarButton(all.map(item=>item.article),term);
 }
 function renderCeramicExtras(item){
   if(!item.extras)return '';
   const parts=item.extras.items.map(({article,quantity,total})=>{
     articleReferences.set(String(article.codigo),article);
     return '<p>'+quantity+' × <a class="cp-ia-link" href="'+esc(link(article.codigo))+'">'+esc(article.nombre)+'</a> · '+money(total)+'</p>';
   });
   return parts.join('')+'<p><strong>Total con adicionales: '+money(item.total+item.extras.total)+'</strong></p>';
 }
 function showBudget(config){
   lastBudget=config;
   say('Preparé el presupuesto con los metros y adicionales que pediste.');
   const button=document.createElement('button');button.type='button';button.className='cp-ia-more';button.textContent='Ver presupuesto';
   button.onclick=()=>{close();window.CorralonIaCatalog.budget(config);};appendChat(button);
 }
 function addSimilarButton(articles,term){
   const button=document.createElement('button');button.type='button';button.className='cp-ia-more';button.textContent='Ver resultados similares';
   button.onclick=()=>{close();window.CorralonIaCatalog.showSimilar(articles,term);};appendChat(button);
 }
 async function findProducts(intent,message,progress){
   const primary=await window.CorralonIaCatalog.search(intent.query||message);
   if(primary.length)return primary;
   const alternatives=[...new Set((intent.alternatives||[]).filter(value=>typeof value==='string'&&value.trim()))].slice(0,3);
   progress.textContent='Buscando con otros nombres…';
   const results=[];
   for(const term of alternatives){const matches=await window.CorralonIaCatalog.search(term);results.push(...matches);}
   const unique=[...new Map(results.map(article=>[article.codigo,article])).values()];
   if(unique.length)return unique;
   const words=String(intent.query||'').trim().split(/\s+/),numbers=words.filter(word=>/\d/.test(word));
   const broad=[words[0],...numbers].filter(Boolean).join(' ');
   if(words[0]?.length>=4&&broad!==intent.query){
     const related=await window.CorralonIaCatalog.search(broad);
     if(related.length){intent.related=true;intent.searchTerm=broad;return related;}
   }
   return [];
 }
 async function interpret(message,history){
   const response=await fetch('https://corralon-index-ia-prueba.benjaminsuarez002.workers.dev/interpretar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,history}),signal:AbortSignal.timeout(45000)});
   const payload=await response.json();if(!response.ok)throw Error(payload.error||'No se pudo consultar la IA.');return payload.intent;
 }
 async function groundedReply(message,history,articles,related){
   try{
     const response=await fetch('https://corralon-index-ia-prueba.benjaminsuarez002.workers.dev/responder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,history,related,articles:articles.slice(0,4).map(a=>({codigo:a.codigo,nombre:a.nombre,detalle:a.detalle}))}),signal:AbortSignal.timeout(30000)});
     if(!response.ok)return '';const payload=await response.json();return typeof payload.reply==='string'?payload.reply:'';
   }catch{return '';}
 }
 async function run(message){
   if(busy||!message.trim())return;const previousTurns=history.slice(-6);busy=true;$('cpIaSend').disabled=true;startTurn();say(message,true);input.value='';const progress=say('Buscando opciones…',false,false);showQuestion();
   try{
     const text=norm(message);let intent;
     const wantsGrout=/\b(?:pastina\w*|pastine|pastona|patina)\b/.test(text),wantsGlue=/pegamento|apegamento|adhesivo/.test(text);
     const material=wantsGrout&&wantsGlue?'ambos':wantsGrout?'pastina':wantsGlue?'pegamento':'';
     const explicitArea=parseArea(text),requestedModel=ceramicModel(text,explicitArea);
     if(material&&!requestedModel&&(lastCeramicArea||explicitArea)&&!/\b(?:ceramic\w*|porcelanat\w*)\b/.test(text.split(/\bcon\b/)[0])){
       const area=explicitArea?Number(explicitArea[1].replace(',','.')):lastCeramicArea;
       if(!(area>0&&area<=100000))throw Error('Indicá cuántos metros cuadrados necesitás cubrir.');
       lastCeramicArea=area;lastArea=area;
       const both=material==='ambos';
       const [primary,grouts]=await Promise.all([window.CorralonIaCatalog.accessories(both?'pegamento':material),both?window.CorralonIaCatalog.accessories('pastina'):Promise.resolve([])]);
       let articles=primary;
       if(material==='pegamento'||both){
         articles=articles.filter(article=>/25\s*k(?:g|ilos?)?\b/i.test(article.nombre));
         const brand=text.match(/\b(optimo|perfecto|mapei|fullmix|klaukol|weber)\b/)?.[1];
         if(brand)articles=articles.filter(article=>norm(article.nombre).includes(brand));
       }
       if(window.CorralonIaCatalog.rank)articles=await window.CorralonIaCatalog.rank(articles);
       if(!articles.length){say('No pude ubicar esa presentación en el catálogo. Decime la marca o consultanos para confirmar cuál corresponde.');return;}
       if(both&&!grouts.length){say('Encontré pegamentos, pero no pude consultar la pastina para completar el total. Volvé a intentar o consultanos.');return;}
       if(lastBudget&&window.CorralonIaCatalog.budget){
         showBudget({...lastBudget,area,glue:material==='pegamento'||both?articles[0]:lastBudget.glue,grout:material==='pastina'?articles[0]:both?grouts[0]:lastBudget.grout});return;
       }
       const quantity=window.CorralonIaCatalog.materialQuantity(area),unit=material==='pegamento'||both?'bolsas de 25 kg':'envases de pastina';
       say('Para '+decimal(area)+' m², la estimación es de '+quantity+' '+unit+(both?' y '+quantity+' envases de pastina':'')+'. Estos importes se suman al cerámico.');
       for(const article of articles.slice(0,2))renderProduct(article,{quantity,unit,companion:both?grouts[0]:null});
       if(material==='pegamento'||both)say('Rendimiento orientativo de la calculadora: 3,5 m² por bolsa. Confirmá compatibilidad y consumo según la superficie.');
       if(material==='pastina'||both)say('Estimación según la calculadora de la página. El consumo de pastina depende de la medida del cerámico y del ancho y profundidad de la junta; confirmá el rendimiento.');
       addSimilarButton(articles,both?'pegamento':material);return;
     }
     let ceramicCandidates=null;
     if(explicitArea&&requestedModel&&window.CorralonIaCatalog){
       const candidates=await window.CorralonIaCatalog.search(requestedModel);
       const words=requestedModel.split(' ').filter(word=>word.length>=3&&/[a-z]/.test(word));
       const matched=candidates.filter(article=>article.ceramico&&words.some(word=>new Set(norm(article.nombre).match(/[a-z0-9]+/g)||[]).has(word)));
       if(matched.length){
         ceramicCandidates=matched;
         intent={kind:'ceramicos',area:Number(explicitArea[1].replace(',','.')),quality:/\b(primera|1ra|1a)\b/.test(text)?'primera':/\b(segunda|2da|2a)\b/.test(text)?'segunda':'',size:explicitArea.dimensions?'':text.match(/\b\d{2,3}\s*[x×]\s*\d{2,3}\b/)?.[0].replace(/\s/g,'').replace('×','x')||''};
       }
     }
     if(!intent){
       if(text==='horarios y retiro')intent={kind:'retiro'};
       else if(text==='¿donde estan?')intent={kind:'ubicacion'};
       else intent=await interpret(message,previousTurns);
     }
     if((requestedModel&&/ceramic|porcelanat|\bpiso\b/.test(text.split(/\bcon\b/)[0]))||(/ceramic|porcelanat/.test(text.split(/\bcon\b/)[0])&&explicitArea))intent.kind='ceramicos';
     if(['aclaracion','charla'].includes(intent.kind)){say(intent.reply||'Contame un poco más de lo que necesitás y te ayudo a buscarlo.');return;}
     if(/ceramic|porcelanat/.test(text)&&!/pegamento|pastina|adhesivo/.test(text))intent.kind='ceramicos';
     const areaMatch=explicitArea;if(areaMatch)intent.area=Number(areaMatch[1].replace(',','.'));
     if(areaMatch?.dimensions)intent.size='';
     if(intent.area>0&&intent.area<=100000)lastArea=intent.area;const area=intent.area>0&&intent.area<=100000?intent.area:lastArea;
     if(!window.CorralonIaCatalog)throw Error('La lista todavía está cargando. Volvé a consultar en unos segundos.');
     if(['horarios','ubicacion','retiro','contacto'].includes(intent.kind)){
       if(['horarios','retiro'].includes(intent.kind)){
         try{
           const data=await window.CorralonIaCatalog.hours();
           const branches=[['progreso_ruta','Progreso y Ruta'],['calle5_espana','Calle 5 y España']];
           const lines=branches.filter(([id])=>data.sucursales?.[id]).map(([id,name])=>name+':\n'+data.sucursales[id]);
           if(data.retiros)lines.push('Retiro de mercadería y aclaraciones:\n'+data.retiros);
           if(lines.length){say('Estos son los horarios y las aclaraciones publicados:');say(lines.join('\n\n'));}
           else say('Todavía no hay horarios cargados. Podés confirmarlos por WhatsApp.');
         }catch{say('No pude consultar los horarios en este momento. Podés confirmarlos por WhatsApp.');}
       }else say(intent.kind==='contacto'?'El número de contacto que figura en la página es +54 2645 80-2404. Te dejo el enlace para llamar o escribir por WhatsApp.':'Tenemos sucursales en Progreso y Ruta y en Calle 5 y España. Te dejo cómo llegar.');
       const links=document.createElement('div');links.className='cp-ia-message';links.innerHTML=(intent.kind==='contacto'?'<a href="tel:+542645802404">Llamar</a>':'<a href="https://maps.app.goo.gl/eUEW5iukCSKCtRgL9" target="_blank" rel="noopener">Cómo llegar</a>')+' · <a href="https://wa.me/542645802404" target="_blank" rel="noopener">Consultar por WhatsApp</a>';appendChat(links);return;
     }
     if(intent.kind==='fuera'&&intent.query){
       const candidates=await findProducts(intent,message,progress);
       if(candidates.length)intent={...intent,kind:'productos',matched:candidates};
     }
     if(intent.kind==='fuera'){say('Puedo ayudarte con productos, cerámicos, sucursales y consultas del Corralón Progreso. ¿Qué material necesitás?');return;}
     if(intent.kind==='ceramicos'){
       let list=(ceramicCandidates||await window.CorralonIaCatalog.ceramics()).map(a=>quote(a,area)).filter(Boolean);
       if(requestedModel){
         const words=requestedModel.split(' ').filter(Boolean);
         const indexed=list.map(item=>({item,tokens:new Set(norm([item.article.nombre,...(Array.isArray(item.article.tagsOcultos)?item.article.tagsOcultos:[])].join(' ')).match(/[a-z0-9]+/g)||[])}));
         const known=words.filter(word=>indexed.some(entry=>entry.tokens.has(word)));
         if(known.length)list=indexed.filter(entry=>known.every(word=>entry.tokens.has(word))).map(entry=>entry.item);
         else{
           const matched=await window.CorralonIaCatalog.search(requestedModel),codes=new Set(matched.map(article=>String(article.codigo)));
           list=list.filter(item=>codes.has(String(item.article.codigo)));
         }
       }
       if(intent.quality)list=list.filter(i=>new RegExp(intent.quality==='primera'?'\\b(1ra|primera|1a|1c)\\b':'\\b(2da|segunda|2a|2c)\\b').test(norm(i.article.nombre)));
       if(intent.size){const parts=intent.size.split('x');list=list.filter(i=>new RegExp(parts[0]+'\\s*[x×]\\s*'+parts[1],'i').test(i.article.nombre));}
       if(/porcelanat/.test(text))list=list.filter(i=>/porcelanat/.test(norm(i.article.nombre)));
       if(!list.length){say('No encontré cerámicos con esos datos y metros por caja confirmados. Probá otra medida o consultanos por WhatsApp.');return;}
       if(window.CorralonIaCatalog.rank){
         const ranked=await window.CorralonIaCatalog.rank(list.map(item=>item.article));
         const quotes=new Map(list.map(item=>[String(item.article.codigo),item]));
         list=ranked.map(article=>quotes.get(String(article.codigo))).filter(Boolean);
       }
       lastCeramicArea=area;
       let options=list.slice(0,2),budgetGlue=null,budgetGrout=null;
       if(material&&area){
         let glues=wantsGlue?await window.CorralonIaCatalog.accessories('pegamento'):[];
         glues=glues.filter(article=>/25\s*k(?:g|ilos?)?\b/i.test(article.nombre));
         const brand=text.match(/\b(optimo|perfecto|mapei|fullmix|klaukol|weber)\b/)?.[1];
         if(brand)glues=glues.filter(article=>norm(article.nombre).includes(brand));
         if(window.CorralonIaCatalog.rank&&glues.length)glues=await window.CorralonIaCatalog.rank(glues);
         const grouts=wantsGrout?await window.CorralonIaCatalog.accessories('pastina'):[];
         if((wantsGlue&&!glues.length)||(wantsGrout&&!grouts.length)){say('Encontré el cerámico, pero no pude completar los adicionales pedidos. Consultanos para confirmar el presupuesto completo.');return;}
         budgetGlue=glues[0]||null;budgetGrout=grouts[0]||null;
         if(!window.CorralonIaCatalog.budget)options=options.flatMap(item=>(wantsGlue?glues.slice(0,2):[null]).map(glue=>{
           const quantity=window.CorralonIaCatalog.materialQuantity(item.coverage),items=[glue,wantsGrout?grouts[0]:null].filter(Boolean).map(article=>({article,quantity,total:Math.round(quantity*Number(article.precioVigente??article.precio)*100)/100}));
           return {...item,extras:{items,total:items.reduce((sum,entry)=>sum+entry.total,0)}};
         })).slice(0,2);
       }
       if(area&&window.CorralonIaCatalog.budget){showBudget({articles:list.map(item=>item.article),area,glue:budgetGlue,grout:budgetGrout});return;}
       say(area?`Presupuesto para ${decimal(area)} m², comprando cajas completas${material?' e incluyendo los adicionales pedidos':''}:`:'Estas son algunas opciones. Decime cuántos metros cuadrados necesitás y calculo cajas y total.');renderOptions(options,list,area,requestedModel||[/porcelanat/.test(text)?'porcelanato':'ceramico',intent.quality,intent.size].filter(Boolean).join(' '));
       if(material&&area)say('Pegamento y pastina estimados según la calculadora, sobre los metros que cubren las cajas completas. Confirmá el consumo y la compatibilidad; la pastina depende de la pieza y la junta.');
     }else{
       const found=intent.matched||await findProducts(intent,message,progress);
       const list=window.CorralonIaCatalog.rank?await window.CorralonIaCatalog.rank(found):found;
       const reply=await groundedReply(message,previousTurns,list,!!intent.related);
       if(!list.length){say(reply||'No pude ubicarlo en esta búsqueda. ¿Tenés una marca, un código o una foto para identificarlo mejor?');return;}
       say(reply||(intent.related?'Te muestro algunas opciones relacionadas. Revisá en la ficha cuál corresponde a lo que necesitás.':'Estas son algunas opciones del catálogo:'));
       for(const a of list.slice(0,2))renderProduct(a);
       addSimilarButton(list,intent.searchTerm||intent.query||message);
     }
   }catch(error){progress.textContent=error.message||'No se pudo completar la consulta. Intentá nuevamente.';if(!progress.isConnected)appendChat(progress);}
   finally{if(['Buscando opciones…','Buscando con otros nombres…'].includes(progress.textContent))progress.remove();busy=false;$('cpIaSend').disabled=false;if(!panel.hidden)input.focus({preventScroll:true});}
 }
 $('cpIaForm').onsubmit=event=>{event.preventDefault();run(input.value);};
 $('cpIaHints').onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.action==='product'){input.placeholder='¿Qué producto estás buscando?';input.focus({preventScroll:true});return;}run(button.dataset.prompt);};
 $('cpIaExample').onclick=()=>run('50 m² de cerámico con pegamento y pastina');
})();
