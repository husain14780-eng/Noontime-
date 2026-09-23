/* NOOR & TIME - standalone Supabase REST client
   This version does NOT depend on @supabase/supabase-js.
   It is designed for Cloudflare Workers static hosting.
*/

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_ANON_KEY;
const API = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;

const state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("cod_store_cart") || "[]"),
  currentFilter: "all",
  owner: null,
  accessToken: localStorage.getItem("noor_owner_token") || "",
  editingProduct: null,
  newOrderCount: 0,
  orderPoll: null,
  lastOrderIds: new Set()
};

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);

function show(id){ const el=$(id); if(el) el.classList.remove("hidden"); }
function hide(id){ const el=$(id); if(el) el.classList.add("hidden"); }
function toast(message){ const el=$("toast"); if(!el)return; el.textContent=message; show("toast"); clearTimeout(window.__toast); window.__toast=setTimeout(()=>hide("toast"),4000); }
function escapeHtml(value=""){ return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
function persistCart(){ localStorage.setItem("cod_store_cart", JSON.stringify(state.cart)); renderCartCount(); }
function setButtonBusy(id,busy,label){ const b=$(id); if(!b)return; b.disabled=busy; if(label!==undefined){ if(!b.dataset.originalLabel)b.dataset.originalLabel=b.textContent; b.textContent=busy?label:b.dataset.originalLabel; } }

function headers(token=state.accessToken, extra={}){
  return { apikey: SUPABASE_KEY, ...(token ? {Authorization:`Bearer ${token}`} : {}), ...extra };
}

async function request(url, options={}){
  const res = await fetch(url, { ...options, headers: headers(options.token, options.headers || {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if(!res.ok){
    const msg = data?.message || data?.error_description || data?.hint || data?.details || data?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function normalizeCartAgainstProducts(){
  const live = new Map(state.products.map(p=>[p.id,p]));
  state.cart = state.cart.map(item=>{
    const p=live.get(item.product_id);
    if(!p || Number(p.stock)<=0 || !p.is_active) return null;
    return {...item,name:p.name,price:Number(p.price),image_url:p.image_url,quantity:Math.min(Number(item.quantity)||1,Number(p.stock))};
  }).filter(Boolean);
  persistCart();
}
function cartCount(){ return state.cart.reduce((sum,item)=>sum+Number(item.quantity||0),0); }
function renderCartCount(){ if($("cartCount")) $("cartCount").textContent=cartCount(); }

function productImage(product){
  if(product.image_url) return `<img class="product-image" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">`;
  return `<div class="product-placeholder">NO IMAGE</div>`;
}

async function loadProducts(){
  try {
    const data = await request(`${API}/products?select=*&is_active=eq.true&order=created_at.desc`);
    state.products=data || [];
    normalizeCartAgainstProducts();
    renderProducts();
  } catch(error) {
    console.error(error);
    $("productGrid").innerHTML=`<div class="empty-state">Could not load products.<br><small>${escapeHtml(error.message)}</small></div>`;
  }
}

function renderProducts(){
  const products = state.products.filter(p => state.currentFilter === "all" || p.category === state.currentFilter);
  if(!products.length){ $("productGrid").innerHTML=`<div class="empty-state">No products in this category yet.</div>`; return; }
  $("productGrid").innerHTML = products.map(p => {
    const soldOut = Number(p.stock) <= 0;
    return `<article class="product-card">
      ${productImage(p)}
      <div class="product-body">
        <div class="product-cat">${escapeHtml(p.category)}</div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-desc">${escapeHtml(p.description || "")}</div>
        <div class="product-bottom">
          <div><div class="price">${money(p.price)}</div><div class="cart-meta">${soldOut ? "Out of stock" : `${p.stock} in stock`}</div></div>
          <button class="add-btn" data-add="${escapeHtml(p.id)}" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold out" : "Add to cart"}</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

function addToCart(productId){
  const product=state.products.find(p=>p.id===productId);
  if(!product || Number(product.stock)<=0) return;
  const existing=state.cart.find(i=>i.product_id===productId);
  if(existing) existing.quantity=Math.min(existing.quantity+1,Number(product.stock));
  else state.cart.push({product_id:productId,name:product.name,price:Number(product.price),image_url:product.image_url,quantity:1});
  persistCart(); toast(`${product.name} added to cart`);
}

function renderCart(){
  const items=state.cart;
  if(!items.length){ $("cartItems").innerHTML='<div class="empty-state">Your cart is empty.</div>'; $("cartTotal").textContent=money(0); $("checkoutBtn").disabled=true; return; }
  $("checkoutBtn").disabled=false;
  let total=0;
  $("cartItems").innerHTML=items.map(item=>{
    const line=Number(item.price)*item.quantity; total+=line;
    return `<div class="cart-row">
      ${item.image_url?`<img class="cart-thumb" src="${escapeHtml(item.image_url)}" alt="" loading="lazy">`:`<div class="cart-thumb"></div>`}
      <div><div class="cart-name">${escapeHtml(item.name)}</div><div class="cart-meta">${money(item.price)} each</div>
      <div class="qty-controls"><button class="qty-btn" data-qty="${escapeHtml(item.product_id)}" data-delta="-1">−</button><strong>${item.quantity}</strong><button class="qty-btn" data-qty="${escapeHtml(item.product_id)}" data-delta="1">+</button><button class="qty-btn" data-remove="${escapeHtml(item.product_id)}" title="Remove">×</button></div></div>
      <strong>${money(line)}</strong>
    </div>`;
  }).join("");
  $("cartTotal").textContent=money(total);
}

function changeQty(productId,delta){
  const item=state.cart.find(i=>i.product_id===productId); if(!item)return;
  const product=state.products.find(p=>p.id===productId); const max=product?Number(product.stock):99;
  item.quantity=Math.max(0,Math.min(max,item.quantity+delta));
  state.cart=state.cart.filter(i=>i.quantity>0); persistCart(); renderCart();
}

async function placeOrder(form){
  if(!state.cart.length)return;
  setButtonBusy("placeOrderBtn",true,"Placing order…"); hide("checkoutError");
  try {
    const fd=new FormData(form);
    const items=state.cart.map(i=>({product_id:i.product_id,quantity:i.quantity}));
    const data=await request(`${API}/rpc/place_order`,{method:"POST",headers:{"Content-Type":"application/json"},token:"",body:JSON.stringify({
      p_customer_name:fd.get("customer_name"),p_phone:fd.get("phone"),p_address:fd.get("address"),p_city:fd.get("city"),p_state:fd.get("state"),p_pincode:fd.get("pincode"),p_notes:fd.get("notes")||null,p_items:items
    })});
    const orderId=Array.isArray(data)?data[0]:data;
    state.cart=[]; persistCart(); form.reset(); hide("checkoutModal"); hide("cartModal");
    toast(`Order #${String(orderId).slice(0,8).toUpperCase()} received — Cash on Delivery.`);
    await loadProducts();
  } catch(error){
    $("checkoutError").textContent=error.message||"Could not place order."; show("checkoutError");
  } finally { setButtonBusy("placeOrderBtn",false); }
}

async function ownerLogin(email,password){
  setButtonBusy("loginSubmitBtn",true,"Signing in…");
  try {
    const data=await request(`${AUTH}/token?grant_type=password`,{method:"POST",headers:{"Content-Type":"application/json"},token:"",body:JSON.stringify({email,password})});
    if(!data?.access_token) throw new Error("Login did not return an access token.");
    state.accessToken=data.access_token; localStorage.setItem("noor_owner_token",state.accessToken);
    state.owner=data.user||null;
    const profile=await request(`${API}/profiles?select=role&id=eq.${encodeURIComponent(data.user.id)}&limit=1`);
    if(!profile?.[0] || profile[0].role!=="owner") throw new Error("This account is not an owner account.");
    return data.user;
  } catch(error){
    state.accessToken=""; state.owner=null; localStorage.removeItem("noor_owner_token"); throw error;
  } finally { setButtonBusy("loginSubmitBtn",false); }
}

async function checkOwner(){
  if(!state.accessToken)return false;
  try {
    const user=await request(`${AUTH}/user`);
    const profile=await request(`${API}/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if(!profile?.[0] || profile[0].role!=="owner") throw new Error("Not owner");
    state.owner=user; return true;
  } catch(error){
    state.accessToken=""; state.owner=null; localStorage.removeItem("noor_owner_token"); return false;
  }
}

async function openOwner(){
  const ok=await checkOwner();
  if(!ok){ show("loginModal"); return; }
  state.newOrderCount=0; updateNewBadge(); hide("loginModal"); show("ownerModal"); await loadOwnerData(); startOrderPolling();
}

async function loadOwnerData(){ await Promise.all([loadOrders(),loadAdminProducts()]); }

async function loadOrders(){
  try {
    const data=await request(`${API}/orders?select=*,order_items(*)&order=created_at.desc`);
    const orders=data||[];
    if(!orders.length){ $("ordersList").innerHTML='<div class="empty-state">No orders yet.</div>'; return; }
    if(state.lastOrderIds.size){ const fresh=orders.filter(o=>!state.lastOrderIds.has(o.id)); if(fresh.length){ state.newOrderCount+=fresh.length; updateNewBadge(); } }
    state.lastOrderIds=new Set(orders.map(o=>o.id));
    $("ordersList").innerHTML=orders.map(order=>{
      const items=(order.order_items||[]).map(i=>`${escapeHtml(i.product_name)} × ${i.quantity} — ${money(Number(i.unit_price)*Number(i.quantity))}`).join("<br>");
      return `<article class="order-card"><div class="order-head"><div><div class="product-cat">ORDER ${escapeHtml(order.id.slice(0,8))}</div><strong>${escapeHtml(order.customer_name)}</strong><div class="cart-meta">${escapeHtml(order.phone)} • ${new Date(order.created_at).toLocaleString("en-IN")}</div></div><select class="status-select" data-order-status="${escapeHtml(order.id)}">${["new","confirmed","packed","shipped","delivered","cancelled"].map(s=>`<option value="${s}" ${order.status===s?"selected":""}>${s.toUpperCase()}</option>`).join("")}</select></div><div class="order-items">${items}</div><div class="order-address"><strong>${money(order.total_amount)} • ${escapeHtml(order.payment_method)}</strong><br>${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.pincode)}${order.notes?`<br>Note: ${escapeHtml(order.notes)}`:""}</div></article>`;
    }).join("");
  } catch(error){
    $("ordersList").innerHTML=`<div class="empty-state">${escapeHtml(error.message)}<br><button class="ghost-btn" id="refreshOrdersInline">Try again</button></div>`;
  }
}

async function updateOrderStatus(orderId,status){
  try { await request(`${API}/orders?id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",headers:{"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify({status,updated_at:new Date().toISOString()})}); toast("Order status updated."); }
  catch(error){ toast(error.message); }
}

async function loadAdminProducts(){
  try {
    const data=await request(`${API}/products?select=*&order=created_at.desc`);
    $("adminProductList").innerHTML=(data||[]).map(p=>`<article class="admin-product"><div class="admin-product-main">${p.image_url?`<img src="${escapeHtml(p.image_url)}" alt="" loading="lazy">`:`<div class="admin-thumb"></div>`}<div><strong>${escapeHtml(p.name)}</strong><div class="cart-meta">${escapeHtml(p.category)} • ${money(p.price)} • stock ${p.stock} • ${p.is_active?"visible":"hidden"}</div></div></div><div class="admin-actions"><button class="ghost-btn" data-edit-product="${escapeHtml(p.id)}">Edit</button><button class="danger-btn" data-delete-product="${escapeHtml(p.id)}">Delete</button></div></article>`).join("")||'<div class="empty-state">No products yet.</div>';
  } catch(error){ $("adminProductList").innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

function openProductForm(product=null){
  state.editingProduct=product; $("productForm").reset();
  $("productForm").elements.id.value=product?.id||""; $("productForm").elements.name.value=product?.name||""; $("productForm").elements.category.value=product?.category||"attar"; $("productForm").elements.description.value=product?.description||""; $("productForm").elements.price.value=product?.price??""; $("productForm").elements.stock.value=product?.stock??0; $("productForm").elements.is_active.value=String(product?.is_active??true);
  $("productModalTitle").textContent=product?"Edit product":"Add product"; $("productModalEyebrow").textContent=product?"EDIT PRODUCT":"NEW PRODUCT"; $("productError").textContent=""; hide("productError");
  if(product?.image_url){ $("existingImageWrap").innerHTML=`<div class="muted">Current image</div><img src="${escapeHtml(product.image_url)}" alt="">`; show("existingImageWrap"); } else hide("existingImageWrap");
  show("productModal");
}

async function saveProduct(form){
  const fd=new FormData(form), file=fd.get("image");
  if(file&&file.size){ if(file.size>5*1024*1024)throw new Error("Image must be 5 MB or smaller."); if(!file.type.startsWith("image/"))throw new Error("Please choose an image file."); }
  let image_url=state.editingProduct?.image_url||null;
  if(file&&file.size){
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
    const path=`${crypto.randomUUID()}.${ext}`;
    await request(`${STORAGE}/object/product-images/${encodeURIComponent(path)}`,{method:"POST",headers:{"Content-Type":file.type,"x-upsert":"false"},body:file});
    image_url=`${STORAGE}/object/public/product-images/${path}`;
  }
  const payload={name:fd.get("name"),category:fd.get("category"),description:fd.get("description"),price:Number(fd.get("price")),stock:Number(fd.get("stock")),is_active:fd.get("is_active")==="true",image_url};
  if(state.editingProduct) await request(`${API}/products?id=eq.${encodeURIComponent(state.editingProduct.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify(payload)});
  else await request(`${API}/products`,{method:"POST",headers:{"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify(payload)});
  hide("productModal"); state.editingProduct=null; await loadProducts(); await loadAdminProducts(); toast("Product saved.");
}

async function deleteProduct(id){
  if(!confirm("Delete this product? Past orders keep their saved item name and price."))return;
  try { await request(`${API}/products?id=eq.${encodeURIComponent(id)}`,{method:"DELETE"}); await loadProducts(); await loadAdminProducts(); toast("Product deleted."); }
  catch(error){ toast(error.message); }
}

function updateNewBadge(){ const b=$("newOrderBadge"); if(state.newOrderCount>0){b.textContent=state.newOrderCount;show("newOrderBadge");}else hide("newOrderBadge"); }
function startOrderPolling(){
  if(state.orderPoll)clearInterval(state.orderPoll);
  state.orderPoll=setInterval(async()=>{ if(state.owner&&$("ownerModal")&&!$("ownerModal").classList.contains("hidden")){ await loadOrders(); } },10000);
}
function stopOrderPolling(){ if(state.orderPoll){clearInterval(state.orderPoll);state.orderPoll=null;} }
function closeModalOnBackdrop(e){ if(e.target.classList.contains("modal-backdrop"))e.target.classList.add("hidden"); }

function bindEvents(){
  document.addEventListener("click", async (e)=>{
    const add=e.target.closest("[data-add]"); if(add){addToCart(add.dataset.add);return;}
    const qty=e.target.closest("[data-qty]"); if(qty){changeQty(qty.dataset.qty,Number(qty.dataset.delta));return;}
    const remove=e.target.closest("[data-remove]"); if(remove){state.cart=state.cart.filter(i=>i.product_id!==remove.dataset.remove);persistCart();renderCart();return;}
    const close=e.target.closest("[data-close]"); if(close){hide(close.dataset.close);return;}
    const filter=e.target.closest("[data-category]"); if(filter){document.querySelectorAll(".filter-btn").forEach(b=>b.classList.remove("active"));filter.classList.add("active");state.currentFilter=filter.dataset.category;renderProducts();return;}
    const edit=e.target.closest("[data-edit-product]"); if(edit){try{const data=await request(`${API}/products?select=*&id=eq.${encodeURIComponent(edit.dataset.editProduct)}&limit=1`);if(data?.[0])openProductForm(data[0]);}catch(err){toast(err.message);}return;}
    const del=e.target.closest("[data-delete-product]"); if(del){await deleteProduct(del.dataset.deleteProduct);return;}
    const status=e.target.closest("[data-order-status]"); if(status){await updateOrderStatus(status.dataset.orderStatus,status.value);return;}
    const inlineRefresh=e.target.closest("#refreshOrdersInline"); if(inlineRefresh){await loadOrders();return;}
    const tab=e.target.closest("[data-tab]"); if(tab){document.querySelectorAll(".owner-tab").forEach(x=>x.classList.remove("active"));tab.classList.add("active");document.querySelectorAll(".owner-panel").forEach(x=>x.classList.add("hidden"));show(tab.dataset.tab);return;}
  });

  $("cartBtn").addEventListener("click",()=>{renderCart();show("cartModal");});
  $("checkoutBtn").addEventListener("click",()=>{if(state.cart.length){hide("cartModal");hide("checkoutError");show("checkoutModal");}});
  $("checkoutForm").addEventListener("submit",e=>{e.preventDefault();placeOrder(e.target);});
  $("ownerBtn").addEventListener("click",openOwner);
  $("loginForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const fd=new FormData(form);hide("loginError");try{await ownerLogin(fd.get("email"),fd.get("password"));form.reset();hide("loginModal");await openOwner();}catch(err){$("loginError").textContent=err.message||"Login failed";show("loginError");}});
  $("logoutBtn").addEventListener("click",async()=>{state.accessToken="";state.owner=null;localStorage.removeItem("noor_owner_token");stopOrderPolling();hide("ownerModal");toast("Signed out.");});
  $("addProductBtn").addEventListener("click",()=>openProductForm());
  $("refreshOrdersBtn").addEventListener("click",loadOrders);
  $("shopBtn").addEventListener("click",()=>$("shopSection").scrollIntoView({behavior:"smooth"}));
  $("heroShopBtn").addEventListener("click",()=>$("shopSection").scrollIntoView({behavior:"smooth"}));
  $("heroCartBtn").addEventListener("click",()=>{renderCart();show("cartModal");});
  $("footerCartBtn").addEventListener("click",()=>{renderCart();show("cartModal");});
  document.querySelectorAll("[data-category-jump]").forEach(btn=>btn.addEventListener("click",()=>{const cat=btn.dataset.categoryJump;const filter=document.querySelector(`[data-category="${cat}"]`);if(filter)filter.click();$("shopSection").scrollIntoView({behavior:"smooth"});}));
  $("brandLink").addEventListener("click",e=>{e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});});
  document.querySelectorAll(".modal-backdrop").forEach(x=>x.addEventListener("click",closeModalOnBackdrop));
  $("productForm").addEventListener("submit",async e=>{e.preventDefault();hide("productError");try{await saveProduct(e.target);}catch(err){$("productError").textContent=err.message||"Could not save product.";show("productError");}});
}

function boot(){
  if(!SUPABASE_URL||!SUPABASE_KEY){ console.error("Supabase configuration missing."); toast("Store configuration is missing."); return; }
  $("year").textContent=new Date().getFullYear();
  renderCartCount();
  bindEvents();
  loadProducts();
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded",boot,{once:true}) : boot();
