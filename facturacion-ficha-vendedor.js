(()=>{
  let busy=false;
  const style=document.createElement('style');style.textContent=`
    .seller-article-dialog{width:min(540px,calc(100vw - 28px));max-height:92dvh;padding:0;border:1px solid #d3d7de;border-radius:16px;background:#fff;color:#252b34;box-shadow:0 24px 80px #14203940;font:14px Barlow,Arial,sans-serif;overflow:auto}
    .seller-article-dialog::backdrop{background:#16203070;backdrop-filter:blur(2px)}
    .seller-article-dialog h2{margin:0!important;padding:20px 24px 16px;border-bottom:1px solid #e7e9ed;font-size:22px;font-weight:800}
    .seller-article-dialog form{padding:20px 24px 22px;gap:16px!important}
    .seller-article-dialog label{font-size:13px;font-weight:700;color:#535d6c}
    .seller-article-dialog input:not([type=checkbox]){height:42px;padding:10px 12px!important;border:1px solid #cdd3dc!important;border-radius:8px!important;font:500 15px Barlow,Arial,sans-serif!important;color:#222b36;background:#fff;outline:none}
    .seller-article-dialog input:focus{border-color:#65758b!important;box-shadow:0 0 0 3px #73849c20}
    .seller-article-dialog input[readonly]{background:#f1f3f6;color:#667184}
    .seller-article-dialog label:has([type=checkbox]){padding:12px;border:1px solid #e1e5eb;border-radius:8px;background:#f6f7f9;color:#333c49}
    .seller-article-dialog input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:#64748b}
    .seller-article-dialog button{min-height:40px;padding:9px 18px;border:1px solid #cdd3dc;border-radius:8px;background:#fff;color:#455062;font:700 14px Barlow,Arial,sans-serif;cursor:pointer;box-shadow:0 1px 2px #00000008}
    .seller-article-dialog button[type=submit]{background:#e90916;color:#fff;border-color:#e90916;box-shadow:0 4px 12px #e9091625}
    .seller-article-dialog button:hover{filter:brightness(.96)}.seller-article-dialog button:disabled{opacity:.55;cursor:wait}
    .seller-article-dialog form>div{padding-top:14px;border-top:1px solid #e7e9ed}
    .seller-article-dialog>p{padding:12px 24px}.seller-article-dialog>button{margin:0 24px 20px}
    @media(max-width:480px){.seller-article-dialog h2{padding:18px}.seller-article-dialog form{padding:18px}.seller-article-dialog form>div{flex-wrap:wrap}.seller-article-dialog button{flex:1}}
  `;document.head.append(style);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(id,body){
    const user=window.CorralonFunciones?.menuSessionUser?.()||{};
    const response=await fetch('/api/facturacion/articulos-sql?'+new URLSearchParams({modo:'vendedor',id,usuarioId:user.id||''}),{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,accion:'ficha-vendedor',usuarioId:user.id})}:{})});
    const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'No se pudo consultar el artículo.');return data;
  }
  window.FacturacionFichaVendedor={async open(id,origin){
    if(busy)return;busy=true;
    const dialog=document.createElement('dialog');dialog.className='seller-article-dialog';
    dialog.innerHTML='<h2 style="margin-top:0">Editar artículo SQL</h2><p role="status">Cargando artículo…</p><button type="button" data-close>Cerrar</button>';
    document.body.append(dialog);dialog.showModal();let saving=false,article;
    function close(){if(saving)return;dialog.close();}
    dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault()});dialog.addEventListener('close',()=>{dialog.remove();busy=false;if(origin?.isConnected)origin.focus()});dialog.querySelector('[data-close]').onclick=close;
    try{
      const data=await api(id);if(!dialog.open)return;article=data.articulo;
      dialog.innerHTML=`<h2 style="margin-top:0">Editar artículo SQL</h2><form style="display:grid;gap:12px"><label>IDArt<input name="id" readonly value="${esc(article.id)}"></label><label>Código de proveedor<input name="codigoProveedor" maxlength="30" value="${esc(article.codigoProveedor)}"></label><label style="display:flex;gap:8px;align-items:center"><input name="suspendido" type="checkbox" ${article.suspendido===true||Number(article.suspendido)!==0?'checked':''}>Suspendido</label><label>Descripción<input name="descripcion" required maxlength="100" value="${esc(article.descripcion)}"></label><p role="status" style="margin:0"></p><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-close>Cancelar</button><button type="submit">Guardar cambios</button></div></form>`;
      dialog.querySelectorAll('label:not(:has([type=checkbox]))').forEach(label=>{label.style.cssText='display:grid;gap:4px';label.querySelector('input').style.cssText='padding:8px;font:inherit;border:1px solid #bbb;border-radius:5px;width:100%;box-sizing:border-box'});
      dialog.querySelector('[data-close]').onclick=close;
      dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(saving)return;const form=e.target;saving=true;form.querySelectorAll('button,input').forEach(el=>el.disabled=true);const message=form.querySelector('[role=status]');message.textContent='Guardando…';
        try{await api(id,{version:article.version,articulo:{id:article.id,codigoProveedor:form.elements.codigoProveedor.value,descripcion:form.elements.descripcion.value.trim().toUpperCase(),suspendido:form.elements.suspendido.checked}});saving=false;dialog.close();}
        catch(error){message.textContent=error.message;message.style.color='#b00020';}
        finally{saving=false;if(dialog.open)form.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
      };dialog.querySelector('[name=descripcion]').focus();
    }catch(error){if(dialog.open)dialog.querySelector('[role=status]').textContent=error.message;}
  }};
})();
