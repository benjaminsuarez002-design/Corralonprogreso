/* Conexión de la copia: conserva las consultas y respuestas que usa el Index original. */
(() => {
  'use strict';
  const nativeFetch=window.fetch.bind(window);
  const hosts=new Set(['tizyjenayrcdkcodsjnc.supabase.co','corralon-index-sql-prueba.benjaminsuarez002.workers.dev']);
  const api=window.IndexSqlApi,catalog=window.IndexSqlPrueba;
  const fromDatabase=window.CorralonSystem.catalog.fromSupabase;
  window.CorralonSystem.catalog.fromSupabase=row=>({...fromDatabase(row),sqlEditRevision:Number(row.sqlEditRevision??row.revision??0)});
  const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function databaseRow(row){
    return {...row,codigo_proveedor:row.idartprov??row.codprov??'',id_rubro:row.idRubro??row.id_rubro,
      precio_venta:row.PrecioVta3??row.precio,precio_compra_con_impuestos:row.PrecioCpraCI,
      precio_compra_sin_descuento:row.PrecioCpraSISDto,porcentaje_ganancia_min:row.PorcGanMin,
      stock_progreso:row.stockSucursalProgresoRuta,stock_calle5:row.stockSucursalCalle5Espana,
      tags_ocultos:row.tagsOcultos??[],foto_url:row.fotoUrl??'',oferta_pct:row.ofertaPct??0,oferta_hasta:row.ofertaHasta??'',
      mas_vendido:row.masVendido??false,acceso_rapido:row.accesoRapido??false,
      ceramico_m2:row.ceramicoM2??0,ceramico_placas:row.ceramicoPlacas??0,edicion_updated_at:row.edicionUpdatedAt??''};
  }
  function parts(text){
    const result=[];let depth=0,quoted=false,start=0;
    for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'&&text[i-1]!=='\\')quoted=!quoted;if(quoted)continue;if(char==='(')depth++;else if(char===')')depth--;else if(char===','&&depth===0){result.push(text.slice(start,i));start=i+1;}}
    result.push(text.slice(start));return result;
  }
  function match(row,field,expression){
    const dot=expression.indexOf('.'),operator=expression.slice(0,dot),value=expression.slice(dot+1),actual=row[field];
    if(operator==='not')return !match(row,field,value);
    if(operator==='is')return value==='null'?actual==null:String(actual)===value;
    if(operator==='in')return parts(value.slice(1,-1)).some(item=>String(actual)===item.replace(/^"|"$/g,''));
    if(operator==='ilike')return new RegExp('^'+normalize(value).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/[*%]/g,'.*')+'$').test(normalize(actual));
    if(operator==='eq')return String(actual)===value;
    if(operator==='gt'||operator==='gte'||operator==='lt'||operator==='lte'){const comparison=typeof actual==='number'?actual-Number(value):String(actual??'').localeCompare(value,'es');return operator==='gt'?comparison>0:operator==='gte'?comparison>=0:operator==='lt'?comparison<0:comparison<=0;}
    throw Error('Filtro de conexión no reconocido: '+operator);
  }
  function condition(row,clause){
    if(clause.startsWith('or(')||clause.startsWith('and(')){const all=clause.startsWith('and('),children=parts(clause.slice(all?4:3,-1));return all?children.every(child=>condition(row,child)):children.some(child=>condition(row,child));}
    const dot=clause.indexOf('.');return match(row,clause.slice(0,dot),clause.slice(dot+1));
  }
  function selectRows(rows,params,headers){
    let result=rows;
    for(const[field,value]of params){if(['select','order','limit','offset','on_conflict'].includes(field))continue;result=result.filter(row=>field==='or'||field==='and'?condition(row,field+value):match(row,field,value));}
    const order=(params.get('order')||'').split(',').filter(Boolean).map(item=>item.split('.'));
    if(order.length)result=[...result].sort((a,b)=>{for(const[field,direction]of order){const left=a[field],right=b[field],difference=typeof left==='number'&&typeof right==='number'?left-right:String(left??'').localeCompare(String(right??''),'es');if(difference)return direction==='desc'?-difference:difference;}return 0;});
    const range=headers.get('range')?.match(/^(\d+)-(\d+)$/),offset=Number(params.get('offset')||range?.[1]||0),limit=params.has('limit')?Number(params.get('limit')):range?Number(range[2])-offset+1:result.length;
    result=result.slice(offset,offset+limit);
    const columns=params.get('select');return columns&&columns!=='*'?result.map(row=>({...Object.fromEntries(columns.split(',').map(key=>[key,row[key]])),...(columns.split(',').includes('codigo')?{sqlEditRevision:row.sqlEditRevision??0}: {})})):result;
  }
  async function connection(input,options={}){
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
    if(!hosts.has(url.hostname)||!/^\/(rest|functions)\/v1\//.test(url.pathname))return nativeFetch(input,options);
    const method=String(options.method||input.method||'GET').toUpperCase();
    try{
      const data=options.body?JSON.parse(options.body):input instanceof Request&&method!=='GET'?await input.clone().json():{};
      const route=url.pathname.replace(/^\/rest\/v1\//,''),headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
      if(route==='rpc/buscar_catalogo_publico_reducido')return reply((await catalog.query({termino:data.p_termino,codigos:data.p_codigos,portada:data.p_portada,limite:data.p_limite})).slice(0,Number(data.p_limite||400)).map(databaseRow));
      if(route==='rpc/get_next_presupuesto_numero')return reply(await api.reserve());
      if(route==='rpc/buscar_presupuestos_web')return reply(await api.searchBudgets(data.p_consulta,data.p_desde,data.p_hasta));
      if(route==='presupuestos_web'&&method==='POST'){for(const record of Array.isArray(data)?data:[data])await api.saveBudget(record);return new Response(null,{status:204});}
      if(route==='catalogo_articulos_meta'&&method==='GET')return reply([{id:'principal',...(await catalog.meta()),change_mode:'full',last_full_version:(await catalog.meta()).version}]);
      if(['catalogo_articulos_publico','catalogo_articulos','catalogo_articulos_edicion'].includes(route)&&method==='GET')return reply(selectRows((await catalog.rows()).map(databaseRow),url.searchParams,headers));
      if(route==='proveedores'&&method==='GET')return reply(selectRows(await window.CorralonSystem.getProvidersCache(),url.searchParams,headers));
      // Nunca enviar una operación no adaptada al servicio oficial desde esta copia.
      return reply({error:'Esta operación no está disponible en la conexión de Cloudflare de la copia.'},501);
    }catch(error){return reply({error:error.message},error.status||503);}
  }
  window.fetch=connection;
  window.IndexCloudflare={fetch:connection};
  // El editor compartido oculta el popup y administra la animación de guardado.

})();
