/* NOOR & TIME
   Standalone Supabase REST/Auth/Storage client
   No Supabase CDN dependency
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

const $ = id => document.getElementById(id);

const money = value =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

function show(id) {
  const el = $(id);
  if (el) el.classList.remove("hidden");
}

function hide(id) {
  const el = $(id);
  if (el) el.classList.add("hidden");
}

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  show("toast");

  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => hide("toast"), 4000);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function persistCart() {
  localStorage.setItem(
    "cod_store_cart",
    JSON.stringify(state.cart)
  );
  renderCartCount();
}

function setButtonBusy(id, busy, label) {
  const button = $(id);
  if (!button) return;

  button.disabled = busy;

  if (label !== undefined) {
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent;
    }

    button.textContent =
      busy ? label : button.dataset.originalLabel;
  }
}

function headers(token = state.accessToken, extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    ...(token ? {
      Authorization: `Bearer ${token}`
    } : {}),
    ...extra
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: headers(
      options.token,
      options.headers || {}
    )
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.hint ||
      data?.details ||
      data?.error ||
      `Request failed (${response.status})`;

    const error = new Error(message);
    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/* =========================
   CART
========================= */

function cartCount() {
  return state.cart.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
}

function renderCartCount() {
  const el = $("cartCount");
  if (el) el.textContent = cartCount();
}

function normalizeCartAgainstProducts() {
  const live = new Map(
    state.products.map(product => [product.id, product])
  );

  state.cart = state.cart
    .map(item => {
      const product = live.get(item.product_id);

      if (
        !product ||
        Number(product.stock) <= 0 ||
        !product.is_active
      ) {
        return null;
      }

      return {
        ...item,
        name: product.name,
        price: Number(product.price),
        image_url: product.image_url,
        quantity: Math.min(
          Number(item.quantity) || 1,
          Number(product.stock)
        )
      };
    })
    .filter(Boolean);

  persistCart();
}

/* =========================
   PRODUCTS
========================= */

function productImage(product) {
  if (product.image_url) {
    return `
      <img
        class="product-image"
        src="${escapeHtml(product.image_url)}"
        alt="${escapeHtml(product.name)}"
        loading="lazy"
      >
    `;
  }

  return `<div class="product-placeholder">NO IMAGE</div>`;
}

async function loadProducts() {
  try {
    const data = await request(
      `${API}/products?select=*&is_active=eq.true&order=created_at.desc`
    );

    state.products = data || [];

    normalizeCartAgainstProducts();
    renderProducts();

  } catch (error) {
    console.error("Product loading error:", error);

    const grid = $("productGrid");

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          Could not load products.
          <br>
          <small>${escapeHtml(error.message)}</small>
        </div>
      `;
    }
  }
}

function renderProducts() {
  const grid = $("productGrid");
  if (!grid) return;

  const products = state.products.filter(product =>
    state.currentFilter === "all" ||
    product.category === state.currentFilter
  );

  if (!products.length) {
    grid.innerHTML = `
      <div class="empty-state">
        No products in this category yet.
      </div>
    `;
    return;
  }

  grid.innerHTML = products.map(product => {
    const soldOut = Number(product.stock) <= 0;

    return `
      <article class="product-card">

        ${productImage(product)}

        <div class="product-body">

          <div class="product-cat">
            ${escapeHtml(product.category)}
          </div>

          <div class="product-name">
            ${escapeHtml(product.name)}
          </div>

          <div class="product-desc">
            ${escapeHtml(product.description || "")}
          </div>

          <div class="product-bottom">

            <div>
              <div class="price">
                ${money(product.price)}
              </div>

              <div class="cart-meta">
                ${
                  soldOut
                    ? "Out of stock"
                    : `${product.stock} in stock`
                }
              </div>
            </div>

            <button
              class="add-btn"
              data-add="${escapeHtml(product.id)}"
              ${soldOut ? "disabled" : ""}
            >
              ${soldOut ? "Sold out" : "Add to cart"}
            </button>

          </div>

        </div>

      </article>
    `;
  }).join("");
}

function addToCart(productId) {
  const product = state.products.find(
    p => p.id === productId
  );

  if (!product || Number(product.stock) <= 0) {
    return;
  }

  const existing = state.cart.find(
    item => item.product_id === productId
  );

  if (existing) {
    existing.quantity = Math.min(
      existing.quantity + 1,
      Number(product.stock)
    );
  } else {
    state.cart.push({
      product_id: productId,
      name: product.name,
      price: Number(product.price),
      image_url: product.image_url,
      quantity: 1
    });
  }

  persistCart();
  toast(`${product.name} added to cart`);
}

/* =========================
   CART UI
========================= */

function renderCart() {
  const container = $("cartItems");
  const totalElement = $("cartTotal");
  const checkoutButton = $("checkoutBtn");

  if (!container) return;

  if (!state.cart.length) {
    container.innerHTML = `
      <div class="empty-state">
        Your cart is empty.
      </div>
    `;

    if (totalElement) {
      totalElement.textContent = money(0);
    }

    if (checkoutButton) {
      checkoutButton.disabled = true;
    }

    return;
  }

  if (checkoutButton) {
    checkoutButton.disabled = false;
  }

  let total = 0;

  container.innerHTML = state.cart.map(item => {
    const line =
      Number(item.price) * Number(item.quantity);

    total += line;

    return `
      <div class="cart-row">

        ${
          item.image_url
            ? `
              <img
                class="cart-thumb"
                src="${escapeHtml(item.image_url)}"
                alt=""
                loading="lazy"
              >
            `
            : `<div class="cart-thumb"></div>`
        }

        <div>

          <div class="cart-name">
            ${escapeHtml(item.name)}
          </div>

          <div class="cart-meta">
            ${money(item.price)} each
          </div>

          <div class="qty-controls">

            <button
              class="qty-btn"
              data-qty="${escapeHtml(item.product_id)}"
              data-delta="-1"
            >
              −
            </button>

            <strong>${item.quantity}</strong>

            <button
              class="qty-btn"
              data-qty="${escapeHtml(item.product_id)}"
              data-delta="1"
            >
              +
            </button>

            <button
              class="qty-btn"
              data-remove="${escapeHtml(item.product_id)}"
              title="Remove"
            >
              ×
            </button>

          </div>

        </div>

        <strong>
          ${money(line)}
        </strong>

      </div>
    `;
  }).join("");

  if (totalElement) {
    totalElement.textContent = money(total);
  }
}

function changeQty(productId, delta) {
  const item = state.cart.find(
    i => i.product_id === productId
  );

  if (!item) return;

  const product = state.products.find(
    p => p.id === productId
  );

  const maximum = product
    ? Number(product.stock)
    : 99;

  item.quantity = Math.max(
    0,
    Math.min(
      maximum,
      Number(item.quantity) + delta
    )
  );

  state.cart = state.cart.filter(
    item => item.quantity > 0
  );

  persistCart();
  renderCart();
}

/* =========================
   CUSTOMER CHECKOUT
========================= */

async function placeOrder(form) {
  if (!state.cart.length) return;

  setButtonBusy(
    "placeOrderBtn",
    true,
    "Placing order…"
  );

  hide("checkoutError");

  try {
    const formData = new FormData(form);

    const items = state.cart.map(item => ({
      product_id: item.product_id,
      quantity: item.quantity
    }));

    const result = await request(
      `${API}/rpc/place_order`,
      {
        method: "POST",
        token: "",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_customer_name:
            formData.get("customer_name"),

          p_phone:
            formData.get("phone"),

          p_address:
            formData.get("address"),

          p_city:
            formData.get("city"),

          p_state:
            formData.get("state"),

          p_pincode:
            formData.get("pincode"),

          p_notes:
            formData.get("notes") || null,

          p_items:
            items
        })
      }
    );

    const orderId =
      Array.isArray(result)
        ? result[0]
        : result;

    state.cart = [];

    persistCart();

    form.reset();

    hide("checkoutModal");
    hide("cartModal");

    toast(
      `Order #${String(orderId)
        .slice(0, 8)
        .toUpperCase()} received — Cash on Delivery.`
    );

    await loadProducts();

  } catch (error) {

    console.error("Checkout error:", error);

    const errorElement = $("checkoutError");

    if (errorElement) {
      errorElement.textContent =
        error.message ||
        "Could not place order.";

      show("checkoutError");
    }

  } finally {
    setButtonBusy(
      "placeOrderBtn",
      false
    );
  }
}

/* =========================
   OWNER LOGIN
========================= */

async function ownerLogin(email, password) {
  setButtonBusy(
    "loginSubmitBtn",
    true,
    "Signing in…"
  );

  try {
    const data = await request(
      `${AUTH}/token?grant_type=password`,
      {
        method: "POST",
        token: "",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      }
    );

    if (!data?.access_token) {
      throw new Error(
        "Login did not return an access token."
      );
    }

    state.accessToken =
      data.access_token;

    localStorage.setItem(
      "noor_owner_token",
      state.accessToken
    );

    state.owner =
      data.user || null;

    const profile = await request(
      `${API}/profiles?select=role&id=eq.${encodeURIComponent(data.user.id)}&limit=1`
    );

    if (
      !profile?.[0] ||
      profile[0].role !== "owner"
    ) {
      throw new Error(
        "This account is not an owner account."
      );
    }

    return data.user;

  } catch (error) {

    state.accessToken = "";
    state.owner = null;

    localStorage.removeItem(
      "noor_owner_token"
    );

    throw error;

  } finally {

    setButtonBusy(
      "loginSubmitBtn",
      false
    );
  }
}

async function checkOwner() {
  if (!state.accessToken) {
    return false;
  }

  try {
    const user = await request(
      `${AUTH}/user`
    );

    const profile = await request(
      `${API}/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`
    );

    if (
      !profile?.[0] ||
      profile[0].role !== "owner"
    ) {
      throw new Error("Not owner");
    }

    state.owner = user;

    return true;

  } catch (error) {

    state.accessToken = "";
    state.owner = null;

    localStorage.removeItem(
      "noor_owner_token"
    );

    return false;
  }
}

async function openOwner() {
  const authenticated =
    await checkOwner();

  if (!authenticated) {
    show("loginModal");
    return;
  }

  state.newOrderCount = 0;

  updateNewBadge();

  hide("loginModal");
  show("ownerModal");

  await loadOwnerData();

  startOrderPolling();
}

/* =========================
   OWNER ORDERS
========================= */

async function loadOwnerData() {
  await Promise.all([
    loadOrders(),
    loadAdminProducts()
  ]);
}

async function loadOrders() {
  try {

    const orders = await request(
      `${API}/orders?select=*,order_items(*)&order=created_at.desc`
    ) || [];

    if (!orders.length) {

      $("ordersList").innerHTML = `
        <div class="empty-state">
          No orders yet.
        </div>
      `;

      return;
    }

    if (state.lastOrderIds.size) {

      const freshOrders =
        orders.filter(
          order =>
            !state.lastOrderIds.has(order.id)
        );

      if (freshOrders.length) {

        state.newOrderCount +=
          freshOrders.length;

        updateNewBadge();

        toast(
          `${freshOrders.length} new order${
            freshOrders.length > 1
              ? "s"
              : ""
          } received`
        );
      }
    }

    state.lastOrderIds =
      new Set(
        orders.map(order => order.id)
      );

    $("ordersList").innerHTML =
      orders.map(order => {

        const items =
          (order.order_items || [])
            .map(item =>
              `${escapeHtml(item.product_name)} × ${item.quantity} — ${money(
                Number(item.unit_price) *
                Number(item.quantity)
              )}`
            )
            .join("<br>");

        return `
          <article class="order-card">

            <div class="order-head">

              <div>

                <div class="product-cat">
                  ORDER ${escapeHtml(
                    order.id.slice(0, 8)
                  )}
                </div>

                <strong>
                  ${escapeHtml(
                    order.customer_name
                  )}
                </strong>

                <div class="cart-meta">
                  ${escapeHtml(order.phone)}
                  •
                  ${new Date(
                    order.created_at
                  ).toLocaleString("en-IN")}
                </div>

              </div>

              <select
                class="status-select"
                data-order-status="${escapeHtml(order.id)}"
              >

                ${
                  [
                    "new",
                    "confirmed",
                    "packed",
                    "shipped",
                    "delivered",
                    "cancelled"
                  ]
                    .map(status => `
                      <option
                        value="${status}"
                        ${
                          order.status === status
                            ? "selected"
                            : ""
                        }
                      >
                        ${status.toUpperCase()}
                      </option>
                    `)
                    .join("")
                }

              </select>

            </div>

            <div class="order-items">
              ${items}
            </div>

            <div class="order-address">

              <strong>
                ${money(order.total_amount)}
                •
                ${escapeHtml(
                  order.payment_method
                )}
              </strong>

              <br>

              ${escapeHtml(order.address)},
              ${escapeHtml(order.city)},
              ${escapeHtml(order.state)}
              ${escapeHtml(order.pincode)}

              ${
                order.notes
                  ? `<br>Note: ${escapeHtml(order.notes)}`
                  : ""
              }

            </div>

          </article>
        `;
      })
      .join("");

  } catch (error) {

    console.error(error);

    $("ordersList").innerHTML = `
      <div class="empty-state">

        ${escapeHtml(error.message)}

        <br>

        <button
          class="ghost-btn"
          id="refreshOrdersInline"
        >
          Try again
        </button>

      </div>
    `;
  }
}

async function updateOrderStatus(
  orderId,
  status
) {
  try {

    await request(
      `${API}/orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",

          "Prefer":
            "return=minimal"
        },
        body: JSON.stringify({
          status,
          updated_at:
            new Date().toISOString()
        })
      }
    );

    toast("Order status updated.");

  } catch (error) {

    toast(error.message);
  }
}

/* =========================
   OWNER PRODUCTS
========================= */

async function loadAdminProducts() {
  try {

    const products = await request(
      `${API}/products?select=*&order=created_at.desc`
    ) || [];

    $("adminProductList").innerHTML =
      products.map(product => `

        <article class="admin-product">

          <div class="admin-product-main">

            ${
              product.image_url
                ? `
                  <img
                    src="${escapeHtml(
                      product.image_url
                    )}"
                    alt=""
                    loading="lazy"
                  >
                `
                : `<div class="admin-thumb"></div>`
            }

            <div>

              <strong>
                ${escapeHtml(product.name)}
              </strong>

              <div class="cart-meta">
                ${escapeHtml(
                  product.category
                )}
                •
                ${money(product.price)}
                • stock ${product.stock}
                •
                ${
                  product.is_active
                    ? "visible"
                    : "hidden"
                }
              </div>

            </div>

          </div>

          <div class="admin-actions">

            <button
              class="ghost-btn"
              data-edit-product="${escapeHtml(
                product.id
              )}"
            >
              Edit
            </button>

            <button
              class="danger-btn"
              data-delete-product="${escapeHtml(
                product.id
              )}"
            >
              Delete
            </button>

          </div>

        </article>

      `).join("") ||
      `
        <div class="empty-state">
          No products yet.
        </div>
      `;

  } catch (error) {

    $("adminProductList").innerHTML = `
      <div class="empty-state">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

function openProductForm(product = null) {

  state.editingProduct = product;

  const form = $("productForm");

  if (!form) return;

  form.reset();

  form.elements.id.value =
    product?.id || "";

  form.elements.name.value =
    product?.name || "";

  form.elements.category.value =
    product?.category || "attar";

  form.elements.description.value =
    product?.description || "";

  form.elements.price.value =
    product?.price ?? "";

  form.elements.stock.value =
    product?.stock ?? 0;

  form.elements.is_active.value =
    String(
      product?.is_active ?? true
    );

  $("productModalTitle").textContent =
    product
      ? "Edit product"
      : "Add product";

  $("productModalEyebrow").textContent =
    product
      ? "EDIT PRODUCT"
      : "NEW PRODUCT";

  $("productError").textContent = "";

  hide("productError");

  if (product?.image_url) {

    $("existingImageWrap").innerHTML = `
      <div class="muted">
        Current image
      </div>

      <img
        src="${escapeHtml(
          product.image_url
        )}"
        alt=""
      >
    `;

    show("existingImageWrap");

  } else {

    hide("existingImageWrap");
  }

  show("productModal");
}

async function saveProduct(form) {

  const formData =
    new FormData(form);

  const file =
    formData.get("image");

  if (file && file.size) {

    if (file.size > 5 * 1024 * 1024) {
      throw new Error(
        "Image must be 5 MB or smaller."
      );
    }

    if (!file.type.startsWith("image/")) {
      throw new Error(
        "Please choose an image file."
      );
    }
  }

  let imageUrl =
    state.editingProduct?.image_url ||
    null;

  if (file && file.size) {

    const extension =
      (
        file.name
          .split(".")
          .pop() ||
        "jpg"
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ""
        ) || "jpg";

    const path =
      `${crypto.randomUUID()}.${extension}`;

    await request(
      `${STORAGE}/object/product-images/${encodeURIComponent(path)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "x-upsert": "false"
        },
        body: file
      }
    );

    imageUrl =
      `${STORAGE}/object/public/product-images/${path}`;
  }

  const payload = {
    name:
      formData.get("name"),

    category:
      formData.get("category"),

    description:
      formData.get("description"),

    price:
      Number(formData.get("price")),

    stock:
      Number(formData.get("stock")),

    is_active:
      formData.get("is_active") === "true",

    image_url:
      imageUrl
  };

  if (state.editingProduct) {

    await request(
      `${API}/products?id=eq.${encodeURIComponent(
        state.editingProduct.id
      )}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",

          "Prefer":
            "return=minimal"
        },
        body:
          JSON.stringify(payload)
      }
    );

  } else {

    await request(
      `${API}/products`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",

          "Prefer":
            "return=minimal"
        },
        body:
          JSON.stringify(payload)
      }
    );
  }

  hide("productModal");

  state.editingProduct = null;

  await loadProducts();
  await loadAdminProducts();

  toast("Product saved.");
}

async function deleteProduct(id) {

  if (
    !confirm(
      "Delete this product? Past orders keep their saved item name and price."
    )
  ) {
    return;
  }

  try {

    await request(
      `${API}/products?id=eq.${encodeURIComponent(id)}`,
      {
        method: "DELETE"
      }
    );

    await loadProducts();
    await loadAdminProducts();

    toast("Product deleted.");

  } catch (error) {

    toast(error.message);
  }
}

/* =========================
   OWNER NOTIFICATION
========================= */

function updateNewBadge() {

  const badge =
    $("newOrderBadge");

  if (!badge) return;

  if (state.newOrderCount > 0) {

    badge.textContent =
      state.newOrderCount;

    show("newOrderBadge");

  } else {

    hide("newOrderBadge");
  }
}

function startOrderPolling() {

  if (state.orderPoll) {
    clearInterval(state.orderPoll);
  }

  state.orderPoll =
    setInterval(async () => {

      if (
        state.owner &&
        $("ownerModal") &&
        !$("ownerModal")
          .classList
          .contains("hidden")
      ) {
        await loadOrders();
      }

    }, 10000);
}

function stopOrderPolling() {

  if (state.orderPoll) {

    clearInterval(
      state.orderPoll
    );

    state.orderPoll = null;
  }
}

/* =========================
   MODALS
========================= */

function closeModalOnBackdrop(event) {

  if (
    event.target.classList.contains(
      "modal-backdrop"
    )
  ) {
    event.target.classList.add(
      "hidden"
    );
  }
}

/* =========================
   EVENTS
========================= */

function bindEvents() {

  document.addEventListener(
    "click",
    async event => {

      const add =
        event.target.closest(
          "[data-add]"
        );

      if (add) {
        addToCart(add.dataset.add);
        return;
      }

      const qty =
        event.target.closest(
          "[data-qty]"
        );

      if (qty) {
        changeQty(
          qty.dataset.qty,
          Number(qty.dataset.delta)
        );
        return;
      }

      const remove =
        event.target.closest(
          "[data-remove]"
        );

      if (remove) {

        state.cart =
          state.cart.filter(
            item =>
              item.product_id !==
              remove.dataset.remove
          );

        persistCart();
        renderCart();

        return;
      }

      const close =
        event.target.closest(
          "[data-close]"
        );

      if (close) {
        hide(close.dataset.close);
        return;
      }

      const filter =
        event.target.closest(
          "[data-category]"
        );

      if (filter) {

        document
          .querySelectorAll(
            ".filter-btn"
          )
          .forEach(button =>
            button.classList.remove(
              "active"
            )
          );

        filter.classList.add(
          "active"
        );

        state.currentFilter =
          filter.dataset.category;

        renderProducts();

        return;
      }

      const edit =
        event.target.closest(
          "[data-edit-product]"
        );

      if (edit) {

        try {

          const products =
            await request(
              `${API}/products?select=*&id=eq.${encodeURIComponent(
                edit.dataset.editProduct
              )}&limit=1`
            );

          if (products?.[0]) {
            openProductForm(
              products[0]
            );
          }

        } catch (error) {

          toast(error.message);
        }

        return;
      }

      const del =
        event.target.closest(
          "[data-delete-product]"
        );

      if (del) {

        await deleteProduct(
          del.dataset.deleteProduct
        );

        return;
      }

      const status =
        event.target.closest(
          "[data-order-status]"
        );

      if (status) {

        await updateOrderStatus(
          status.dataset.orderStatus,
          status.value
        );

        return;
      }

      const refresh =
        event.target.closest(
          "#refreshOrdersInline"
        );

      if (refresh) {

        await loadOrders();

        return;
      }

      const tab =
        event.target.closest(
          "[data-tab]"
        );

      if (tab) {

        document
          .querySelectorAll(
            ".owner-tab"
          )
          .forEach(button =>
            button.classList.remove(
              "active"
            )
          );

        tab.classList.add(
          "active"
        );

        document
          .querySelectorAll(
            ".owner-panel"
          )
          .forEach(panel =>
            panel.classList.add(
              "hidden"
            )
          );

        show(tab.dataset.tab);

        return;
      }
    }
  );

  const cartBtn =
    $("cartBtn");

  if (cartBtn) {
    cartBtn.addEventListener(
      "click",
      () => {
        renderCart();
        show("cartModal");
      }
    );
  }

  const checkoutBtn =
    $("checkoutBtn");

  if (checkoutBtn) {
    checkoutBtn.addEventListener(
      "click",
      () => {

        if (!state.cart.length) {
          return;
        }

        hide("cartModal");
        hide("checkoutError");
        show("checkoutModal");
      }
    );
  }

  const checkoutForm =
    $("checkoutForm");

  if (checkoutForm) {
    checkoutForm.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        placeOrder(event.target);
      }
    );
  }

  const ownerBtn =
    $("ownerBtn");

  if (ownerBtn) {
    ownerBtn.addEventListener(
      "click",
      openOwner
    );
  }

  const loginForm =
    $("loginForm");

  if (loginForm) {

    loginForm.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        const formData =
          new FormData(
            event.target
          );

        hide("loginError");

        try {

          await ownerLogin(
            formData.get("email"),
            formData.get("password")
          );

          hide("loginModal");

          await openOwner();

          event.target.reset();

        } catch (error) {

          $("loginError").textContent =
            error.message ||
            "Login failed";

          show("loginError");
        }
      }
    );
  }

  const logoutBtn =
    $("logoutBtn");

  if (logoutBtn) {

    logoutBtn.addEventListener(
      "click",
      () => {

        state.accessToken = "";
        state.owner = null;

        localStorage.removeItem(
          "noor_owner_token"
        );

        stopOrderPolling();

        hide("ownerModal");

        toast("Signed out.");
      }
    );
  }

  const addProductBtn =
    $("addProductBtn");

  if (addProductBtn) {
    addProductBtn.addEventListener(
      "click",
      () => openProductForm()
    );
  }

  const refreshOrdersBtn =
    $("refreshOrdersBtn");

  if (refreshOrdersBtn) {
    refreshOrdersBtn.addEventListener(
      "click",
      loadOrders
    );
  }

  const shopBtn =
    $("shopBtn");

  if (shopBtn) {
    shopBtn.addEventListener(
      "click",
      () => {
        $("shopSection")
          ?.scrollIntoView({
            behavior: "smooth"
          });
      }
    );
  }

  const heroShopBtn =
    $("heroShopBtn");

  if (heroShopBtn) {
    heroShopBtn.addEventListener(
      "click",
      () => {
        $("shopSection")
          ?.scrollIntoView({
            behavior: "smooth"
          });
      }
    );
  }

  const heroCartBtn =
    $("heroCartBtn");

  if (heroCartBtn) {
    heroCartBtn.addEventListener(
      "click",
      () => {
        renderCart();
        show("cartModal");
      }
    );
  }

  const footerCartBtn =
    $("footerCartBtn");

  if (footerCartBtn) {
    footerCartBtn.addEventListener(
      "click",
      () => {
        renderCart();
        show("cartModal");
      }
    );
  }

  document
    .querySelectorAll(
      "[data-category-jump]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const category =
            button.dataset
              .categoryJump;

          const filter =
            document.querySelector(
              `[data-category="${category}"]`
            );

          if (filter) {
            filter.click();
          }

          $("shopSection")
            ?.scrollIntoView({
              behavior: "smooth"
            });
        }
      );
    });

  const brandLink =
    $("brandLink");

  if (brandLink) {

    brandLink.addEventListener(
      "click",
      event => {

        event.preventDefault();

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      }
    );
  }

  document
    .querySelectorAll(
      ".modal-backdrop"
    )
    .forEach(modal =>
      modal.addEventListener(
        "click",
        closeModalOnBackdrop
      )
    );

  const productForm =
    $("productForm");

  if (productForm) {

    productForm.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        hide("productError");

        try {

          await saveProduct(
            event.target
          );

        } catch (error) {

          $("productError").textContent =
            error.message ||
            "Could not save product.";

          show("productError");
        }
      }
    );
  }
}

/* =========================
   START
========================= */

function boot() {

  if (
    !SUPABASE_URL ||
    !SUPABASE_KEY
  ) {

    console.error(
      "Supabase configuration missing."
    );

    toast(
      "Store configuration is missing."
    );

    return;
  }

  const year =
    $("year");

  if (year) {
    year.textContent =
      new Date().getFullYear();
  }

  renderCartCount();

  bindEvents();

  loadProducts();
}

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    boot,
    { once: true }
  );

} else {

  boot();
}
