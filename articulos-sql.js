(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const FX = window.CorralonFunciones;
  const els = Object.fromEntries(['search','provider','category','state','status','articles','page','reload','detail','articleDialog','articlePosition','prevArticle','nextArticle','closeArticle','dialogStatus'].map(id => [id,$(id)]));
  const size = 120;
  const embedded=new URLSearchParams(location.search).get('embed')==='stock';
  const requestedArticle=new URLSearchParams(location.search).get('articulo');
  const notifyParent=(type)=>{if(embedded&&parent!==window)parent.postMessage({type,id:selected},location.origin);};
  if(embedded){
    const style=document.createElement('style');style.textContent='body>header,body>main{display:none}body{background:white}.article-dialog{width:calc(100vw - 8px)!important;max-width:none!important;max-height:calc(100dvh - 8px)!important;margin:4px!important}.article-dialog::backdrop{background:transparent}';document.head.append(style);
  }
  const editWeb=document.createElement('button');editWeb.type='button';editWeb.id='editArticleWeb';editWeb.textContent='✎';editWeb.title='Editar artículo web';editWeb.setAttribute('aria-label','Editar artículo web');
  els.articlePosition.after(editWeb);
  let articleRows=null;
  let articles = [], filtered = [], selected = null, generation = 0, stockGeneration = 0, catalogs = {}, draft = null, stockDraft = [], dirty = false, saving = false, loadingDetail = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => value == null ? '—' : Number(value).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const money = value => value == null ? '—' : Number(value).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const percent = value => value == null ? '—' : `${money(Number(value)*100)} %`;
  const flag = value => value === true || Number(value) !== 0 && value != null;
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function status(text,error=false) { for(const element of [els.status,els.dialogStatus]){element.textContent=text;element.classList.toggle('error',error);} }
  async function api(params = {}, body = null) {
    const response = await fetch(`/api/facturacion/articulos-sql?${new URLSearchParams(params)}`,{
      cache:'no-store',signal:AbortSignal.timeout(30000),
      ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})
    });
    const data = await response.json().catch(()=>null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'No se pudieron consultar los artículos. Revisá que Facturación esté iniciada y actualizada.');
    return data;
  }
  function mayDiscard() {return !saving && !loadingDetail && (!dirty || confirm('Tenés cambios sin guardar. ¿Querés descartarlos?'));}
  function markDirty(value) {dirty=value;const message=$('editStatus');if(message)message.textContent=value?'Cambios sin guardar.':'';const save=$('saveArticle');if(save)save.disabled=!value || saving;}
  const filterChoices={state:[{id:'active',nombre:'Activos'},{id:'all',nombre:'Todos'},{id:'suspended',nombre:'Suspendidos'}]};
  function options(element,field) {
    const previous=element.dataset.filterValue;
    const values=[...new Set(articles.map(a=>a[field]).filter(v=>v!=null&&v!==''))].sort((a,b)=>String(a).localeCompare(String(b),'es'));
    filterChoices[element.id]=[{id:'',nombre:'Todos'},...values.map(v=>({id:v,nombre:v}))];
    element.dataset.filterValue=values.includes(previous)?previous:'';
    element.value=element.dataset.filterValue||'Todos';
  }
  let tableSelection=null,tableSortKey='',tableSortDir='';
  function filter() {
    const terms=normalize(els.search.value).trim().split(/\s+/).filter(Boolean);
    filtered=articles.filter(a=> (els.provider.dataset.filterValue===''||a.proveedor===els.provider.dataset.filterValue)
      && (els.category.dataset.filterValue===''||a.rubro===els.category.dataset.filterValue)
      && (els.state.dataset.filterValue==='all'||flag(a.suspendido)===(els.state.dataset.filterValue==='suspended'))
      && terms.every(term=>a.search.includes(term)));
    if(tableSortKey)filtered.sort((a,b)=>{const key=tableSortKey,comparison=key==='costoLista'?Number(a[key]||0)-Number(b[key]||0):key==='suspendido'?Number(flag(a[key]))-Number(flag(b[key])):String(a[key]??'').localeCompare(String(b[key]??''),'es',{numeric:true});return tableSortDir==='desc'?-comparison:comparison;});
    render(true);
  }
  function renderRows(start,end,replace){
    const html=filtered.slice(start,end).map((a,index)=>{let col=0;return `<tr class="${String(a.id)===selected?'selected':''}"><td>${esc(a.id)}</td><td>${esc(a.codigoProveedor)}</td><td><button tabindex="-1" data-id="${esc(a.id)}">${esc(a.descripcion)}</button></td><td class="numeric">${money(a.costoLista)}</td><td>${flag(a.suspendido)?'Sí':'No'}</td><td>${esc(a.proveedor)}</td><td>${esc(a.rubro)}</td><td>${esc(a.ultimaActualizacion || '—')}</td></tr>`.replace(/<td(?=[ >])/g,()=>`<td tabindex="-1" data-row="${start+index}" data-col="${col++}"`);}).join('')||'<tr><td colspan="8" class="empty">No se encontraron artículos.</td></tr>';
    if(replace){tableSelection?.clearSelection();els.articles.innerHTML=html;}else els.articles.insertAdjacentHTML('beforeend',html);
  }
  function render(reset=false) {
    if(reset)articleRows?.reset();
    else {
      const index=filtered.findIndex(a=>String(a.id)===selected);articleRows?.ensure(Math.max(size,index+1));
      els.articles.querySelectorAll('tr').forEach(row=>row.classList.toggle('selected',row.querySelector('[data-id]')?.dataset.id===selected));
    }
    articleNavigation();
  }
  function articleNavigation() {
    const index=filtered.findIndex(a=>String(a.id)===selected);
    els.articlePosition.textContent=index<0?'Fuera del filtro actual':`${index+1} / ${filtered.length}`;
    els.prevArticle.disabled=saving||loadingDetail||index<=0;
    els.nextArticle.disabled=saving||loadingDetail||index<0||index>=filtered.length-1;
    els.closeArticle.disabled=saving||loadingDetail;
    editWeb.disabled=saving||loadingDetail||!selected;
  }
  function moveArticle(direction) {
    if(!els.articleDialog.open||saving||loadingDetail)return;
    const index=filtered.findIndex(a=>String(a.id)===selected),target=index+direction;
    if(index>=0&&target>=0&&target<filtered.length)select(filtered[target].id);
  }
  function closeArticle() {
    if(!mayDiscard())return;
    markDirty(false);els.articleDialog.close();
    notifyParent('corralon:article-editor-close');
  }
  const numericKeys=['unidadesBulto','costoLista','descuentos','costoSinIva','costoConIva','minorista','intermedio','mayorista','gananciaMinorista','gananciaIntermedio','gananciaMayorista','margenMinorista','margenIntermedio','margenMayorista'];
  const lookupFields={idProveedor:'proveedores',idRubro:'rubros',idSeccion:'secciones',idMoneda:'monedas',idIva:'tasasIva'};
  const round = value => Math.round((value+Number.EPSILON)*100)/100;
  function currencyPrefix() {
    const name=String((catalogs.monedas||[]).find(v=>String(v.id)===String(draft?.idMoneda))?.nombre||'');
    return /d[oó]lar|usd/i.test(name)?'US$ ':/euro|eur/i.test(name)?'€ ':'$ ';
  }
  function numericText(value,format,raw=false) {
    if(value==null)return '';
    if(raw)return Number(value).toFixed(2).replace('.',',');
    return (format==='money'?currencyPrefix():'')+num(value)+(format==='percent'?' %':'');
  }
  function readNumber(input) {
    if(input.dataset.numberFormat==='money'&&(/[+xX×*/%]/.test(input.value)||/\d\s*-/.test(input.value))){
      const original=fieldOriginals.get(input)?.draft?.[input.dataset.field]??draft?.[input.dataset.field];
      const adjusted=FX.evaluatePriceAdjustment(input.value,original);
      if(!Number.isFinite(adjusted)||(input.dataset.nonnegative==='1'&&adjusted<0)){
        input.setCustomValidity('Usá +3%, x 1.03 o una cuenta como 1362,82*1.03.');return undefined;
      }
      input.setCustomValidity('');return adjusted;
    }
    const text=input.value.replace(/US\$|\$|€|%/g,'').trim();
    if(!text){input.setCustomValidity('');return null;}
    if(!/^-?[\d.,\s]+$/.test(text)||!/[0-9]/.test(text)) {input.setCustomValidity('Ingresá un número válido.');return undefined;}
    const value=round(FX.parseLocaleNumber(text));
    if(!Number.isFinite(value)||(input.dataset.nonnegative==='1'&&value<0)) {input.setCustomValidity('Ingresá un número válido mayor o igual a cero.');return undefined;}
    input.setCustomValidity('');return value;
  }
  function numberInput(key,value,nonnegative=false,label=key) {
    const format=key.startsWith('ganancia')?'percent':key==='unidadesBulto'?'quantity':'money';
    return `<input data-field="${key}" data-number-format="${format}" data-nonnegative="${nonnegative?'1':'0'}" type="text" inputmode="decimal" ${['unidadesBulto','descuentos'].includes(key)?'required':''} value="${esc(numericText(value,format))}" aria-label="${esc(label)}">`;
  }
  function field(label,key,wide=false,max=100) {
    let control;
    if(lookupFields[key]) {
      const list=(catalogs[lookupFields[key]]||[]).filter(v=>key!=='idIva'||([0.105,0.21].some(rate=>Math.abs(Number(v.iva)-rate)<0.000001)&&!Number(v.iva2)));
      if(key==='idRubro'||key==='idProveedor'){
        const name=list.find(v=>String(v.id)===String(draft[key]))?.nombre||'';
        control=`<span class="article-combo"><input data-field="${key}" data-article-combo autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="article-options-${key}" value="${esc(name)}" aria-label="${esc(label)}"><button type="button" data-combo-toggle="${key}" tabindex="-1" aria-label="Desplegar ${esc(label)}">▾</button><span id="article-options-${key}" class="article-combo-options" role="listbox" hidden></span></span>`;
      }else control=`<select data-field="${key}" ${key==='idIva'?'required':''} aria-label="${esc(label)}">${key==='idIva'?'':'<option value="">Sin asignar</option>'}${list.map(v=>`<option value="${esc(v.id)}" ${String(v.id)===String(draft[key])?'selected':''}>${esc(key==='idIva'?`${percent(v.iva)}${Number(v.iva2)?' + '+percent(v.iva2):''}`:v.nombre)}</option>`).join('')}</select>`;
    } else if(numericKeys.includes(key))control=numberInput(key,draft[key],!key.startsWith('ganancia')&&!key.startsWith('margen'),label);
    else control=`<input data-field="${key}" maxlength="${max}" value="${esc(draft[key])}" aria-label="${esc(label)}" ${key==='id'?'readonly aria-readonly="true"':''}>`;
    return `<label class="${wide?'wide':''}">${esc(label)}${control}</label>`;
  }
  function recalculate(d,key,oldValue) {
    const costKeys=['costoLista','descuentos','costoSinIva','costoConIva','idIva'];
    if(costKeys.includes(key)) {
      const discountFactor=(1-Number(d.descuento1||0))*(1-Number(d.descuento2||0));
      if(key==='costoLista')d.costoSinIva=round(Number(d.costoLista||0)*(1-Number(d.descuento1||0))*(1-Number(d.descuento2||0)));
      if(key==='descuentos')d.costoSinIva=round(Number(d.costoSinIva||0)-(Number(d.descuentos||0)-Number(oldValue||0)));
      if(key==='costoConIva')d.costoSinIva=round((Number(d.costoConIva||0)-Number(d.flete||0))/(1+Number(d.iva||0)));
      else d.costoConIva=round(Number(d.costoSinIva||0)*(1+Number(d.iva||0))+Number(d.flete||0));
      if((key==='costoConIva'||key==='costoSinIva')&&discountFactor>0)d.costoLista=round(Number(d.costoSinIva||0)/discountFactor);
      d.descuentos=round(Number(d.costoLista||0)-Number(d.costoSinIva||0));
      for(const type of ['Minorista','Intermedio','Mayorista'])d[type.toLowerCase()]=round(Number(d.costoConIva||0)*(1+Number(d['ganancia'+type]||0)/100)+Number(d.impuestoInterno||0));
    }
    for(const type of ['Minorista','Intermedio','Mayorista']) {
      const price=type.toLowerCase(),gain='ganancia'+type,margin='margen'+type;
      const cost=Number(d.costoConIva||0),tax=Number(d.impuestoInterno||0);
      if(key===gain)d[price]=round(cost*(1+Number(d[gain]||0)/100)+tax);
      if(key===margin)d[price]=round(cost+tax+Number(d[margin]||0));
      if(key===price || key===margin)d[gain]=cost?round(((Number(d[price]||0)-cost-tax)/cost)*100):0;
      d[margin]=d[price]==null || d.costoConIva==null ? null : round(Number(d[price])-cost-tax);
    }
  }
  function syncNumbers(except) {
    els.detail.querySelectorAll('[data-field]').forEach(input=>{if(input.dataset.field!==except&&numericKeys.includes(input.dataset.field))input.value=numericText(draft[input.dataset.field],input.dataset.numberFormat,document.activeElement===input);});
  }
  function drawForm(a,stock) {
    draft={...a};for(const type of ['Minorista','Intermedio','Mayorista'])draft['ganancia'+type]=a['ganancia'+type]==null?null:Number(a['ganancia'+type])*100;
    for(const key of ['descripcion','descripcionWeb'])draft[key]=String(draft[key]??'').toUpperCase();
    stockDraft=stock.map(s=>({...s,stockAnterior:s.stock,ubicacionAnterior:s.ubicacion}));
    els.detail.innerHTML=`<form id="articleForm"><fieldset id="articleFields"><div class="fields article-identity">
      ${field('ID artículo','id',false,20)}${field('Código de proveedor','codigoProveedor',false,30)}
      <label class="check"><input type="checkbox" data-field="suspendido" ${flag(draft.suspendido)?'checked':''}>Suspendido</label></div><div class="fields article-main-fields">
      ${field('Descripción','descripcion',true)}
      ${field('Descripción para web','descripcionWeb',true)}${field('Rubro','idRubro')}${field('Proveedor','idProveedor')}${field('Moneda','idMoneda')}${field('Cantidad por bulto','unidadesBulto')}</div>
      <h3>Precios de compra</h3><div class="fields money">${field('Costo de lista','costoLista')}${field('IVA','idIva')}${field('Con IVA','costoConIva')}</div>
      <h3>Precios de venta (IVA incluido)</h3><div class="sales"><table><thead><tr><th>Tipo</th><th>Precio</th><th>Ganancia %</th></tr></thead><tbody>${['Minorista','Intermedio','Mayorista'].map(type=>`<tr><td>${type}</td><td>${numberInput(type.toLowerCase(),draft[type.toLowerCase()],true,'Precio '+type)}</td><td>${numberInput('ganancia'+type,draft['ganancia'+type],false,'Ganancia '+type)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Stock por sucursal</h3><div class="sales"><table><thead><tr><th>Nº suc.</th><th>Sucursal</th><th>Stock</th><th>Ubicación</th></tr></thead><tbody>${stockDraft.map((s,index)=>`<tr><td>${esc(s.id)}</td><td>${esc(s.sucursal)}</td><td><input type="text" inputmode="decimal" data-number-format="quantity" readonly aria-readonly="true" data-stock="${index}" data-key="stock" value="${esc(numericText(s.stock,'quantity'))}" aria-label="Stock ${esc(s.sucursal)}"></td><td><input maxlength="10" readonly aria-readonly="true" data-stock="${index}" data-key="ubicacion" value="${esc(s.ubicacion)}" aria-label="Ubicación ${esc(s.sucursal)}"></td></tr>`).join('')}</tbody></table></div><div id="stockTotal" class="stock-total">Total: ${num(stockDraft.reduce((sum,s)=>sum+Number(s.stock||0),0))}</div></fieldset>
      <div class="edit-actions"><button type="submit" id="saveArticle" disabled>Guardar cambios</button><button type="button" id="cancelArticle">Descartar cambios</button><span id="editStatus" role="status"></span></div><p class="note">Importes expresados en la moneda del artículo. El total de stock y los márgenes se calculan a partir de la ficha.</p></form>`;
    els.detail.querySelector('[data-field="idIva"]').value=String(draft.idIva??'');
    markDirty(false);
  }
  async function select(id,force=false) {
    if(!force && !mayDiscard())return;
    const token=++stockGeneration;loadingDetail=true;articleNavigation();const fields=$('articleFields');if(fields)fields.disabled=true;status('Cargando ficha…');
    try {
      const data=await api({id});if(token!==stockGeneration)return;
      selected=String(data.articulo.id);drawForm(data.articulo,data.stock||[]);render();if(!els.articleDialog.open)els.articleDialog.showModal();els.articleDialog.scrollTop=0;els.detail.querySelector('[data-field="descripcion"]')?.focus({preventScroll:true});status('Ficha lista para editar.');
    }catch(error){if(token===stockGeneration)status(error.message,true);}
    finally{if(token===stockGeneration){loadingDetail=false;articleNavigation();const fields=$('articleFields');if(fields)fields.disabled=false;}}
  }
  function edit(event) {
    if(saving || loadingDetail || !draft)return;
    const input=event.target;
    if(input.matches('[data-stock]')) return;
    const key=input.dataset.field;if(!key||key==='id')return;
    if(key==='descripcion'||key==='descripcionWeb'){
      const start=input.selectionStart,end=input.selectionEnd;
      input.value=input.value.toUpperCase();
      if(start!=null&&end!=null)input.setSelectionRange(start,end);
      if(key==='descripcion'){
        draft.descripcionWeb=input.value;
        const web=els.detail.querySelector('[data-field="descripcionWeb"]');
        if(web)web.value=input.value;
      }
    }
    if(input.hasAttribute('data-article-combo')){
      const text=input.value.trim(),list=catalogs[lookupFields[key]]||[];
      const match=list.find(v=>normalize(v.nombre)===normalize(text)||String(v.id)===text);
      input.setCustomValidity(text&&!match?'Elegí una opción de la lista.':'');
      if(text&&!match){markDirty(true);return;}
      draft[key]=match?Number(match.id):null;markDirty(true);return;
    }
    const value=numericKeys.includes(key)?readNumber(input):input.value;
    if(value===undefined)return;
    const previous=draft[key];
    draft[key]=input.type==='checkbox'?input.checked:lookupFields[key]?(input.value===''?null:Number(input.value)):numericKeys.includes(key)?value:input.value;
    if(key==='idIva')draft.iva=(catalogs.tasasIva||[]).find(v=>String(v.id)===String(draft.idIva))?.iva||0;
    if(numericKeys.includes(key)||key==='idIva'){recalculate(draft,key,previous);syncNumbers(key);}
    if(key==='idMoneda')syncNumbers();
    markDirty(true);
  }
  async function save(event) {
    event.preventDefault();if(saving||loadingDetail||!dirty||!draft)return;
    const form=$('articleForm');if(!form.reportValidity())return;
    if(draft.idIva==null){status('Elegí un IVA antes de guardar.',true);return;}
    const stock=[];
    const body={idOriginal:selected,version:draft.version,articulo:{...draft},stock};
    saving=true;articleNavigation();$('articleFields').disabled=true;$('saveArticle').disabled=true;$('cancelArticle').disabled=true;els.reload.disabled=true;status('Guardando cambios…');
    try {
      const data=await api({},body);
      const index=articles.findIndex(a=>String(a.id)===selected),a=data.articulo;
      a.search=normalize([a.id,a.codigoProveedor,a.codigoBarras,a.descripcion,a.descripcionWeb].join(' '));
      if(index>=0)articles[index]=a;else articles.push(a);
      selected=String(a.id);drawForm(a,data.stock||[]);options(els.provider,'proveedor');options(els.category,'rubro');filter();status('Artículo guardado.');
      notifyParent('corralon:article-editor-saved');
    }catch(error){status(error.message,true);}
    finally{saving=false;articleNavigation();const fields=$('articleFields');if(fields)fields.disabled=false;const cancel=$('cancelArticle');if(cancel)cancel.disabled=false;els.reload.disabled=false;markDirty(dirty);}
  }
  async function load() {
    if(!mayDiscard())return;
    const token=++generation;++stockGeneration;els.reload.disabled=true;status('Consultando artículos…');
    try {
      const data=await api();if(token!==generation)return;
      catalogs=data;
      articles=(data.articulos||[]).map(a=>({...a,search:normalize([a.id,a.codigoProveedor,a.codigoBarras,a.descripcion,a.descripcionWeb].join(' '))}));
      options(els.provider,'proveedor');options(els.category,'rubro');filter();status('Artículos actualizados.');
      if(selected&&articles.some(a=>String(a.id)===selected))select(selected,true);
      else {selected=null;markDirty(false);els.articleDialog.close();els.detail.innerHTML='';}
    } catch(error) {if(token===generation){status(error.message,true);const branch=$('branchStock');if(branch)branch.textContent='No se pudo actualizar el stock.';}}
    finally {if(token===generation)els.reload.disabled=false;}
  }
  let articleCombo=null;
  const fieldOriginals=new WeakMap();
  document.addEventListener('focusin',event=>{
    const input=event.target;if(!input.matches('input, select, textarea'))return;
    fieldOriginals.set(input,{value:input.value,filterValue:input.dataset.filterValue,checked:input.checked,draft: draft?{...draft}:null,dirty});
  },true);
  function closeCombo(){
    if(!articleCombo)return;
    articleCombo.menu.hidden=true;articleCombo.input.setAttribute('aria-expanded','false');articleCombo.input.removeAttribute('aria-activedescendant');articleCombo=null;
  }
  function openCombo(input,all=false){
    closeCombo();
    const menu=input.parentElement.querySelector('.article-combo-options'),terms=normalize(all?'':input.value).split(/\s+/).filter(Boolean);
    const options=(filterChoices[input.id]||catalogs[lookupFields[input.dataset.field]]||[]).filter(v=>terms.every(t=>normalize(v.nombre+' '+v.id).includes(t)));
    articleCombo={input,menu,options,index:-1};
    menu.innerHTML=options.map((v,i)=>`<span role="option" id="article-option-${input.dataset.field||input.id}-${i}" data-combo-option="${i}">${esc(v.nombre)}</span>`).join('')||'<span>Sin coincidencias</span>';
    menu.hidden=false;input.setAttribute('aria-expanded','true');
  }
  function pickCombo(index){
    const c=articleCombo,v=c?.options[index];if(!v)return;
    c.input.value=v.nombre;c.input.setCustomValidity('');if(filterChoices[c.input.id]){c.input.dataset.filterValue=String(v.id);filter();}else edit({target:c.input});closeCombo();c.input.focus();c.input.select();
  }
  document.addEventListener('input',event=>{if(event.target.hasAttribute('data-article-combo'))openCombo(event.target);});
  document.addEventListener('pointerdown',event=>{
    const option=event.target.closest('[data-combo-option]'),toggle=event.target.closest('[data-combo-toggle]');
    if(option){event.preventDefault();pickCombo(Number(option.dataset.comboOption));}
    else if(toggle){event.preventDefault();const input=toggle.parentElement.querySelector('input');input.focus();input.select();if(articleCombo?.input===input)closeCombo();else openCombo(input,true);}
  });
  document.addEventListener('focusout',event=>{
    if(!event.target.hasAttribute('data-article-combo'))return;
    closeCombo();const input=event.target,key=input.dataset.field;
    const match=(filterChoices[input.id]||catalogs[lookupFields[key]]||[]).find(v=>normalize(v.nombre)===normalize(input.value.trim())||String(v.id)===input.value.trim());
    if(match){input.value=match.nombre;if(filterChoices[input.id]){input.dataset.filterValue=String(match.id);filter();}}else if(filterChoices[input.id]){input.value=filterChoices[input.id].find(v=>String(v.id)===input.dataset.filterValue)?.nombre||'Todos';}
  });
  document.addEventListener('keydown',event=>{
    if(!els.articleDialog.contains(event.target)&&!event.target.closest('.filters'))return;
    if(event.key==='Escape'&&event.target.matches('input, select, textarea')){
      event.preventDefault();event.stopImmediatePropagation();closeCombo();
      const input=event.target,original=fieldOriginals.get(input);if(!original)return;
      if(event.target.closest('.filters')){input.value=original.value;input.dataset.filterValue=original.filterValue;filter();input.select?.();return;}
      draft=original.draft?{...original.draft}:draft;
      input.value=original.value;if(input.type==='checkbox')input.checked=original.checked;
      input.setCustomValidity('');syncNumbers();markDirty(original.dirty);
      input.select?.();return;
    }
    if(event.ctrlKey&&event.key==='Enter'&&els.articleDialog.contains(event.target)){
      event.preventDefault();event.stopImmediatePropagation();
      if(event.repeat||saving||loadingDetail)return;
      if(articleCombo?.options.length)pickCombo(Math.max(0,articleCombo.index));
      $('articleForm')?.requestSubmit();return;
    }
    const input=event.target;if(!input.hasAttribute('data-article-combo'))return;
    if(event.key==='F4'){event.preventDefault();event.stopImmediatePropagation();if(articleCombo?.input===input)closeCombo();else openCombo(input,true);return;}
    if(event.key==='Escape'&&articleCombo){event.preventDefault();event.stopImmediatePropagation();closeCombo();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();event.stopImmediatePropagation();if(articleCombo?.input!==input)openCombo(input,true);
      const c=articleCombo;c.index=Math.max(0,Math.min(c.options.length-1,c.index+(event.key==='ArrowDown'?1:-1)));
      c.menu.querySelectorAll('[role="option"]').forEach((option,i)=>{option.classList.toggle('active',i===c.index);option.setAttribute('aria-selected',String(i===c.index));if(i===c.index){input.setAttribute('aria-activedescendant',option.id);option.scrollIntoView?.({block:'nearest'});}});return;
    }
    if(event.key==='Enter'&&articleCombo?.input===input&&articleCombo.options.length){event.preventDefault();event.stopImmediatePropagation();pickCombo(Math.max(0,articleCombo.index));}
  },true);
  FX.bindLinearNavigation({root:els.articleDialog,selector:'input, select, textarea, button:not([data-combo-toggle])',selectOnAnyFocus:true,selectOnFirstPointerFocus:true,navigateLeftRight:true,smartCaret:true});
  els.articleDialog.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('button')){event.preventDefault();event.target.click();}
  },true);
  els.detail.addEventListener('focusin',event=>{
    const input=event.target;if(!input.dataset.numberFormat)return;
    const value=input.dataset.field?draft?.[input.dataset.field]:stockDraft[Number(input.dataset.stock)]?.stock;
    input.value=numericText(value,input.dataset.numberFormat,true);input.select();
  });
  els.detail.addEventListener('focusout',event=>{
    const input=event.target;if(!input.dataset.numberFormat||readNumber(input)===undefined)return;
    const value=input.dataset.field?draft?.[input.dataset.field]:stockDraft[Number(input.dataset.stock)]?.stock;
    input.value=numericText(value,input.dataset.numberFormat);
  });
  const articleTable=els.articles.closest('table');
  articleTable.addEventListener('mousedown',event=>{const cell=event.target.closest('td[data-row]');if(cell)cell.focus();});
  articleTable.addEventListener('keydown',event=>{
    const cell=event.target.closest('td[data-row]');if(!cell)return;
    if(event.key==='Enter'){event.preventDefault();select(filtered[Number(cell.dataset.row)]?.id);}
  });
  FX.bindGridNavigation({root:articleTable,cellSelector:'td[data-row]',navigateLeftRight:true,findCell:(row,col)=>{
    if(col<0){row--;col=7;}else if(col>7){row++;col=0;}
    if(row<0||row>=filtered.length)return null;
    articleRows.ensure(row+1);
    return els.articles.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  }});
  tableSelection=FX.bindTableSelectPaste({root:articleTable,cellSelector:'td[data-row]',columnSelector:'th[data-col]',clearOnDelete:false,setCellValue:()=>{},pasteText:()=>true,getCellValue:cell=>cell.textContent.trim()});
  FX.bindTableSort({root:articleTable,sort:(key,dir)=>{tableSortKey=key;tableSortDir=dir;filter();}});
  els.search.addEventListener('input',filter);
  FX.bindLinearNavigation({root:document.querySelector('.filters'),selector:'input',selectOnAnyFocus:true,selectOnFirstPointerFocus:true,navigateLeftRight:true,smartCaret:true});

  els.articles.addEventListener('click',event=>{const button=event.target.closest('button[data-id]');if(button)select(button.dataset.id);});
  els.reload.addEventListener('click',load);
  FX.bindNumericExpressions({root:els.detail,selector:'input[data-number-format="money"]'});
  els.detail.addEventListener('input',edit);
  els.detail.addEventListener('change',event=>{if(event.target.tagName==='SELECT')edit(event);});
  els.detail.addEventListener('submit',save);
  els.detail.addEventListener('click',event=>{if(event.target.id==='cancelArticle'&&mayDiscard()){dirty=false;select(selected,true);}});
  els.prevArticle.addEventListener('click',()=>moveArticle(-1));
  els.nextArticle.addEventListener('click',()=>moveArticle(1));
  els.closeArticle.addEventListener('click',closeArticle);
  els.articleDialog.addEventListener('cancel',event=>{event.preventDefault();closeArticle();});
  document.addEventListener('keydown',event=>{
    if(!els.articleDialog.open)return;
    if(event.key!=='PageDown'&&event.key!=='PageUp')return;
    event.preventDefault();if(event.repeat)return;
    moveArticle(event.key==='PageDown'?1:-1);
  });
  window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
  articleRows=FX.bindIncrementalRendering({root:els.articles.closest('.scroll'),batchSize:size,getTotal:()=>filtered.length,renderRange:renderRows,afterRender:(count,total)=>{els.page.textContent=`${total.toLocaleString('es-AR')} artículos · ${count.toLocaleString('es-AR')} visibles`;}});
  editWeb.addEventListener('click',async()=>{
    if(saving||loadingDetail||!selected)return;
    if(dirty){status('Guardá o descartá los cambios de la ficha antes de abrir el editor web.',true);return;}
    editWeb.disabled=true;
    try{
      const system=window.CorralonSystem;
      const stored=await system.catalog.fetchArticle(selected);
      const article=stored||{codigo:selected,idart:selected,nombre:draft.descripcionWeb||draft.descripcion,descripcion:draft.descripcionWeb||draft.descripcion,precio:draft.minorista,rubro:draft.rubro,codProv:draft.codigoProveedor};
      const operation={articles:[article],onClose:()=>{els.articleDialog.showModal();editWeb.disabled=false;},save:async(_list,updated)=>{
        if(stored){await system.catalog.saveArticleEdits([updated]);return;}
        const response=await fetch('/api/local-articles/catalog',{cache:'no-store'}),catalog=await response.json();
        if(!response.ok||!catalog.token)throw new Error(catalog.error||'No se pudo conectar al editor local.');
        const published=await fetch('/api/local-articles/publish',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Articles-Token':catalog.token},body:JSON.stringify({id:selected,article:updated})});
        const result=await published.json();if(!published.ok)throw new Error(result.error||'No se pudo guardar la ficha web.');
      }};
      els.articleDialog.close();
      if(!system.articleEditor.open(selected,{articles:[article],operation}))els.articleDialog.showModal();
    }catch(error){status(error.message,true);editWeb.disabled=false;}
  });
  render(true);load().then(()=>{if(requestedArticle&&/^\d{6}$/.test(requestedArticle))select(requestedArticle,true);});
})();
