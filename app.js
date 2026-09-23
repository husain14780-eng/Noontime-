/* =========================================================
   NOOR & TIME — app.js
   Supabase REST/Auth version
   ========================================================= */

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_ANON_KEY;

const API = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;

const state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("cod_store_cart") || "[]"),
  currentFilter: "all",
  accessToken: localStorage.getItem("noor_owner_token") || "",
  owner: null,
  editingProduct: null,
  orderPoll: null,
  knownOrderIds: new Set(),
  newOrderCount: 0
};


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

function show(id) {
  const el = $(id);
  if (el) el.classList.remove("hidden");
}

function hide(id) {
  const el = $(id);
  if (el) el.classList.add("hidden");
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  show("toast");

  clearTimeout(window.__noorToast);

  window.__noorToast = setTimeout(() => {
    hide("toast");
  }, 4000);
}

function saveCart() {
  localStorage.setItem(
    "cod_store_cart",
    JSON.stringify(state.cart)
  );

  renderCartCount();
}

function renderCartCount() {
  const count = state.cart.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

  const el = $("cartCount");

  if (el) {
    el.textContent = count;
  }
}

function setBusy(id, busy, text) {
  const button = $(id);

  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }

  button.disabled = busy;

  if (busy && text) {
    button.textContent = text;
  } else if (!busy) {
    button.textContent = button.dataset.originalText;
  }
}


/* =========================================================
   SUPABASE REQUEST
   ========================================================= */

async function request(url, options = {}) {

  const requestHeaders = {
    apikey: SUPABASE_KEY,
    ...(options.headers || {})
  };

  /*
   * For authenticated database requests use the current
   * owner access token.
   */
  if (state.accessToken) {
    requestHeaders.Authorization =
      `Bearer ${state.accessToken}`;
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: requestHeaders,
    body: options.body
  });

  const raw = await response.text();

  let data;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {

    console.error("Supabase request failed:", {
      url,
      status: response.status,
      data
    });

    const message =
      data?.error_description ||
      data?.msg ||
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      (typeof data === "string" ? data : null) ||
      `Request failed (${response.status})`;

    const error = new Error(message);

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}


/* =========================================================
   PRODUCTS — STORE
   ========================================================= */

async function loadProducts() {

  const grid = $("productGrid");

  try {

    const products = await request(
      `${API}/products?select=*&is_active=eq.true&order=created_at.desc`
    );

    state.products = products || [];

    reconcileCart();

    renderProducts();

  } catch (error) {

    console.error("Product loading error:", error);

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <strong>Products could not be loaded.</strong>
          <br>
          <small>${escapeHtml(error.message)}</small>
        </div>
      `;
    }
  }
}

function reconcileCart() {

  const products = new Map(
    state.products.map(product => [
      product.id,
      product
    ])
  );

  state.cart = state.cart
    .map(item => {

      const product = products.get(item.product_id);

      if (
        !product ||
        !product.is_active ||
        Number(product.stock) <= 0
      ) {
        return null;
      }

      return {
        product_id: product.id,
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

  saveCart();
}

function renderProducts() {

  const grid = $("productGrid");

  if (!grid) return;

  const products = state.products.filter(product => {

    if (state.currentFilter === "all") {
      return true;
    }

    return product.category === state.currentFilter;
  });

  if (!products.length) {

    grid.innerHTML = `
      <div class="empty-state">
        No products available in this category yet.
      </div>
    `;

    return;
  }

  grid.innerHTML = products.map(product => {

    const soldOut =
      Number(product.stock) <= 0;

    return `
      <article class="product-card">

        ${
          product.image_url
            ? `
              <img
                class="product-image"
                src="${escapeHtml(product.image_url)}"
                alt="${escapeHtml(product.name)}"
                loading="lazy"
              >
            `
            : `
              <div class="product-placeholder">
                NO IMAGE
              </div>
            `
        }

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


/* =========================================================
   CART
   ========================================================= */

function addToCart(productId) {

  const product = state.products.find(
    item => item.id === productId
  );

  if (!product) return;

  if (Number(product.stock) <= 0) {
    toast("This product is out of stock.");
    return;
  }

  const existing = state.cart.find(
    item => item.product_id === productId
  );

  if (existing) {

    if (
      existing.quantity >=
      Number(product.stock)
    ) {
      toast("You cannot add more than the available stock.");
      return;
    }

    existing.quantity += 1;

  } else {

    state.cart.push({
      product_id: product.id,
      name: product.name,
      price: Number(product.price),
      image_url: product.image_url,
      quantity: 1
    });
  }

  saveCart();
  renderCart();

  toast(`${product.name} added to cart.`);
}

function changeQuantity(productId, amount) {

  const item = state.cart.find(
    product => product.product_id === productId
  );

  if (!item) return;

  const product = state.products.find(
    product => product.id === productId
  );

  const max = product
    ? Number(product.stock)
    : 99;

  item.quantity = Math.max(
    0,
    Math.min(
      max,
      Number(item.quantity) + amount
    )
  );

  state.cart = state.cart.filter(
    item => item.quantity > 0
  );

  saveCart();
  renderCart();
}

function removeFromCart(productId) {

  state.cart = state.cart.filter(
    item => item.product_id !== productId
  );

  saveCart();
  renderCart();
}

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

    const lineTotal =
      Number(item.price) *
      Number(item.quantity);

    total += lineTotal;

    return `
      <div class="cart-row">

        ${
          item.image_url
            ? `
              <img
                class="cart-thumb"
                src="${escapeHtml(item.image_url)}"
                alt=""
              >
            `
            : `
              <div class="cart-thumb"></div>
            `
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

            <strong>
              ${item.quantity}
            </strong>

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
            >
              ×
            </button>

          </div>

        </div>

        <strong>
          ${money(lineTotal)}
        </strong>

      </div>
    `;

  }).join("");

  if (totalElement) {
    totalElement.textContent = money(total);
  }
}


/* =========================================================
   COD CHECKOUT
   ========================================================= */

async function placeOrder(form) {

  if (!state.cart.length) {
    toast("Your cart is empty.");
    return;
  }

  setBusy(
    "placeOrderBtn",
    true,
    "Placing order..."
  );

  hide("checkoutError");

  try {

    const formData = new FormData(form);

    const items = state.cart.map(item => ({
      product_id: item.product_id,
      quantity: Number(item.quantity)
    }));

    const result = await request(
      `${API}/rpc/place_order`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_customer_name:
            String(formData.get("customer_name") || "").trim(),

          p_phone:
            String(formData.get("phone") || "").trim(),

          p_address:
            String(formData.get("address") || "").trim(),

          p_city:
            String(formData.get("city") || "").trim(),

          p_state:
            String(formData.get("state") || "").trim(),

          p_pincode:
            String(formData.get("pincode") || "").trim(),

          p_notes:
            String(formData.get("notes") || "").trim() || null,

          p_items: items
        })
      }
    );

    const orderId =
      Array.isArray(result)
        ? result[0]
        : result;

    state.cart = [];

    saveCart();

    form.reset();

    hide("checkoutModal");
    hide("cartModal");

    toast(
      `Order received successfully. Order ID: ${String(orderId).slice(0, 8).toUpperCase()}`
    );

    await loadProducts();

  } catch (error) {

    console.error("Checkout error:", error);

    const errorBox = $("checkoutError");

    if (errorBox) {
      errorBox.textContent =
        error.message ||
        "Could not place the order.";

      show("checkoutError");
    }

  } finally {

    setBusy(
      "placeOrderBtn",
      false
    );
  }
}


/* =========================================================
   OWNER LOGIN — FIXED
   ========================================================= */

async function ownerLogin(email, password) {

  setBusy(
    "loginSubmitBtn",
    true,
    "Signing in..."
  );

  try {

    const cleanEmail =
      String(email || "").trim();

    const cleanPassword =
      String(password || "");

    if (!cleanEmail) {
      throw new Error(
        "Please enter your email."
      );
    }

    if (!cleanPassword) {
      throw new Error(
        "Please enter your password."
      );
    }

    /*
     * Supabase password authentication.
     */
    const response = await fetch(
      `${AUTH}/token?grant_type=password`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY
        },

        body: JSON.stringify({
          email: cleanEmail,
          password: cleanPassword
        })
      }
    );

    const data =
      await response.json().catch(() => ({}));

    console.log(
      "Supabase login response:",
      response.status,
      data
    );

    if (!response.ok) {

      let message =
        data?.error_description ||
        data?.msg ||
        data?.message ||
        data?.error;

      if (response.status === 400) {

        message =
          message ||
          "Invalid login credentials. Check the email and password.";
      }

      throw new Error(
        message ||
        `Login failed (${response.status})`
      );
    }

    if (!data.access_token) {
      throw new Error(
        "Supabase did not return an access token."
      );
    }

    /*
     * Save authenticated session.
     */
    state.accessToken =
      data.access_token;

    state.owner =
      data.user || null;

    localStorage.setItem(
      "noor_owner_token",
      state.accessToken
    );

    /*
     * Verify owner role.
     */
    const profile =
      await request(
        `${API}/profiles?select=role&id=eq.${encodeURIComponent(data.user.id)}&limit=1`
      );

    if (
      !profile ||
      !profile.length ||
      profile[0].role !== "owner"
    ) {

      state.accessToken = "";
      state.owner = null;

      localStorage.removeItem(
        "noor_owner_token"
      );

      throw new Error(
        "Login succeeded, but this account is not an owner account."
      );
    }

    return data.user;

  } catch (error) {

    console.error(
      "OWNER LOGIN ERROR:",
      error
    );

    state.accessToken = "";
    state.owner = null;

    localStorage.removeItem(
      "noor_owner_token"
    );

    throw error;

  } finally {

    setBusy(
      "loginSubmitBtn",
      false
    );
  }
}


/* =========================================================
   CHECK EXISTING OWNER SESSION
   ========================================================= */

async function checkOwner() {

  if (!state.accessToken) {
    return false;
  }

  try {

    const user =
      await request(
        `${AUTH}/user`
      );

    if (!user?.id) {
      throw new Error(
        "No authenticated user."
      );
    }

    const profile =
      await request(
        `${API}/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`
      );

    if (
      !profile ||
      !profile.length ||
      profile[0].role !== "owner"
    ) {
      throw new Error(
        "Account is not an owner."
      );
    }

    state.owner = user;

    return true;

  } catch (error) {

    console.warn(
      "Owner session invalid:",
      error
    );

    state.accessToken = "";
    state.owner = null;

    localStorage.removeItem(
      "noor_owner_token"
    );

    return false;
  }
}


/* =========================================================
   OPEN OWNER DASHBOARD
   ========================================================= */

async function openOwner() {

  const authenticated =
    await checkOwner();

  if (!authenticated) {

    show("loginModal");

    return;
  }

  hide("loginModal");

  show("ownerModal");

  state.newOrderCount = 0;

  updateOrderBadge();

  await loadOwnerData();

  startOrderPolling();
}


/* =========================================================
   OWNER ORDERS
   ========================================================= */

async function loadOwnerData() {

  await Promise.all([
    loadOrders(),
    loadAdminProducts()
  ]);
}

async function loadOrders() {

  const container =
    $("ordersList");

  if (!container) return;

  try {

    const orders =
      await request(
        `${API}/orders?select=*,order_items(*)&order=created_at.desc`
      ) || [];

    /*
     * Detect new orders.
     */
    if (state.knownOrderIds.size) {

      const newOrders =
        orders.filter(
          order =>
            !state.knownOrderIds.has(order.id)
        );

      if (newOrders.length) {

        state.newOrderCount +=
          newOrders.length;

        updateOrderBadge();

        toast(
          `${newOrders.length} new order${
            newOrders.length === 1
              ? ""
              : "s"
          } received.`
        );
      }
    }

    state.knownOrderIds =
      new Set(
        orders.map(order => order.id)
      );

    if (!orders.length) {

      container.innerHTML = `
        <div class="empty-state">
          No orders yet.
        </div>
      `;

      return;
    }

    container.innerHTML =
      orders.map(order => {

        const items =
          order.order_items || [];

        const itemText =
          items.map(item => `
            <div>
              ${escapeHtml(item.product_name)}
              × ${item.quantity}
              — ${money(
                Number(item.unit_price) *
                Number(item.quantity)
              )}
            </div>
          `).join("");

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

                ${[
                  "new",
                  "confirmed",
                  "packed",
                  "shipped",
                  "delivered",
                  "cancelled"
                ].map(status => `
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
                `).join("")}

              </select>

            </div>

            <div class="order-items">
              ${itemText}
            </div>

            <div class="order-address">

              <strong>
                ${money(order.total_amount)}
                • COD
              </strong>

              <br>

              ${escapeHtml(order.address)},
              ${escapeHtml(order.city)},
              ${escapeHtml(order.state)}
              -
              ${escapeHtml(order.pincode)}

              ${
                order.notes
                  ? `
                    <br>
                    Note:
                    ${escapeHtml(order.notes)}
                  `
                  : ""
              }

            </div>

          </article>
        `;

      }).join("");

  } catch (error) {

    console.error(
      "Orders error:",
      error
    );

    container.innerHTML = `
      <div class="empty-state">
        Could not load orders.
        <br>
        <small>
          ${escapeHtml(error.message)}
        </small>
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

    toast(
      error.message ||
      "Could not update order."
    );
  }
}


/* =========================================================
   ORDER BADGE / POLLING
   ========================================================= */

function updateOrderBadge() {

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

  stopOrderPolling();

  state.orderPoll =
    setInterval(async () => {

      const ownerModal =
        $("ownerModal");

      if (
        state.owner &&
        ownerModal &&
        !ownerModal.classList.contains("hidden")
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


/* =========================================================
   ADMIN PRODUCTS
   ========================================================= */

async function loadAdminProducts() {

  const container =
    $("adminProductList");

  if (!container) return;

  try {

    const products =
      await request(
        `${API}/products?select=*&order=created_at.desc`
      ) || [];

    if (!products.length) {

      container.innerHTML = `
        <div class="empty-state">
          No products yet.
        </div>
      `;

      return;
    }

    container.innerHTML =
      products.map(product => `

        <article class="admin-product">

          <div class="admin-product-main">

            ${
              product.image_url
                ? `
                  <img
                    src="${escapeHtml(product.image_url)}"
                    alt=""
                    loading="lazy"
                  >
                `
                : `
                  <div class="admin-thumb"></div>
                `
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

                • stock:
                ${product.stock}

                •
                ${
                  product.is_active
                    ? "Visible"
                    : "Hidden"
                }

              </div>

            </div>

          </div>

          <div class="admin-actions">

            <button
              class="ghost-btn"
              data-edit-product="${escapeHtml(product.id)}"
            >
              Edit
            </button>

            <button
              class="danger-btn"
              data-delete-product="${escapeHtml(product.id)}"
            >
              Delete
            </button>

          </div>

        </article>

      `).join("");

  } catch (error) {

    container.innerHTML = `
      <div class="empty-state">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}


/* =========================================================
   PRODUCT FORM
   ========================================================= */

function openProductForm(product = null) {

  state.editingProduct =
    product;

  const form =
    $("productForm");

  if (!form) return;

  form.reset();

  if (form.elements.id) {
    form.elements.id.value =
      product?.id || "";
  }

  if (form.elements.name) {
    form.elements.name.value =
      product?.name || "";
  }

  if (form.elements.category) {
    form.elements.category.value =
      product?.category || "attar";
  }

  if (form.elements.description) {
    form.elements.description.value =
      product?.description || "";
  }

  if (form.elements.price) {
    form.elements.price.value =
      product?.price ?? "";
  }

  if (form.elements.stock) {
    form.elements.stock.value =
      product?.stock ?? 0;
  }

  if (form.elements.is_active) {
    form.elements.is_active.value =
      String(
        product?.is_active ?? true
      );
  }

  const title =
    $("productModalTitle");

  if (title) {
    title.textContent =
      product
        ? "Edit product"
        : "Add product";
  }

  const eyebrow =
    $("productModalEyebrow");

  if (eyebrow) {
    eyebrow.textContent =
      product
        ? "EDIT PRODUCT"
        : "NEW PRODUCT";
  }

  const errorBox =
    $("productError");

  if (errorBox) {
    errorBox.textContent = "";
    hide("productError");
  }

  const existing =
    $("existingImageWrap");

  if (product?.image_url && existing) {

    existing.innerHTML = `
      <div class="muted">
        Current image
      </div>

      <img
        src="${escapeHtml(product.image_url)}"
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
        "Please select an image file."
      );
    }
  }

  let imageUrl =
    state.editingProduct?.image_url ||
    null;

  /*
   * Upload image.
   */
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
      String(formData.get("name") || "").trim(),

    category:
      String(formData.get("category") || "attar"),

    description:
      String(formData.get("description") || "").trim(),

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

  state.editingProduct =
    null;

  hide("productModal");

  await loadProducts();
  await loadAdminProducts();

  toast("Product saved successfully.");
}

async function editProduct(productId) {

  try {

    const products =
      await request(
        `${API}/products?select=*&id=eq.${encodeURIComponent(productId)}&limit=1`
      );

    if (products?.[0]) {
      openProductForm(
        products[0]
      );
    }

  } catch (error) {

    toast(error.message);
  }
}

async function deleteProduct(productId) {

  if (
    !confirm(
      "Delete this product?"
    )
  ) {
    return;
  }

  try {

    await request(
      `${API}/products?id=eq.${encodeURIComponent(productId)}`,
      {
        method: "DELETE"
      }
    );

    await loadProducts();
    await loadAdminProducts();

    toast("Product deleted.");

  } catch (error) {

    toast(
      error.message ||
      "Could not delete product."
    );
  }
}


/* =========================================================
   LOGOUT
   ========================================================= */

function logoutOwner() {

  state.accessToken = "";
  state.owner = null;

  localStorage.removeItem(
    "noor_owner_token"
  );

  stopOrderPolling();

  hide("ownerModal");

  toast("Signed out.");
}


/* =========================================================
   MODALS
   ========================================================= */

function closeModal(id) {
  if (id) hide(id);
}

function backdropClose(event) {

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


/* =========================================================
   EVENT LISTENERS
   ========================================================= */

function bindEvents() {

  /*
   * Product/cart/order delegated clicks.
   */
  document.addEventListener(
    "click",
    async event => {

      const addButton =
        event.target.closest(
          "[data-add]"
        );

      if (addButton) {

        addToCart(
          addButton.dataset.add
        );

        return;
      }

      const qtyButton =
        event.target.closest(
          "[data-qty]"
        );

      if (qtyButton) {

        changeQuantity(
          qtyButton.dataset.qty,
          Number(
            qtyButton.dataset.delta
          )
        );

        return;
      }

      const removeButton =
        event.target.closest(
          "[data-remove]"
        );

      if (removeButton) {

        removeFromCart(
          removeButton.dataset.remove
        );

        return;
      }

      const closeButton =
        event.target.closest(
          "[data-close]"
        );

      if (closeButton) {

        closeModal(
          closeButton.dataset.close
        );

        return;
      }

      const filterButton =
        event.target.closest(
          "[data-category]"
        );

      if (filterButton) {

        document
          .querySelectorAll(
            ".filter-btn"
          )
          .forEach(button =>
            button.classList.remove(
              "active"
            )
          );

        filterButton.classList.add(
          "active"
        );

        state.currentFilter =
          filterButton.dataset.category;

        renderProducts();

        return;
      }

      const editButton =
        event.target.closest(
          "[data-edit-product]"
        );

      if (editButton) {

        await editProduct(
          editButton.dataset.editProduct
        );

        return;
      }

      const deleteButton =
        event.target.closest(
          "[data-delete-product]"
        );

      if (deleteButton) {

        await deleteProduct(
          deleteButton.dataset.deleteProduct
        );

        return;
      }

      const statusSelect =
        event.target.closest(
          "[data-order-status]"
        );

      if (
        statusSelect &&
        statusSelect.tagName === "SELECT"
      ) {

        await updateOrderStatus(
          statusSelect.dataset.orderStatus,
          statusSelect.value
        );

        return;
      }

      const tabButton =
        event.target.closest(
          "[data-tab]"
        );

      if (tabButton) {

        document
          .querySelectorAll(
            ".owner-tab"
          )
          .forEach(button =>
            button.classList.remove(
              "active"
            )
          );

        tabButton.classList.add(
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

        show(
          tabButton.dataset.tab
        );

        return;
      }
    }
  );


  /* Cart */
  const cartButton =
    $("cartBtn");

  if (cartButton) {

    cartButton.addEventListener(
      "click",
      () => {

        renderCart();
        show("cartModal");
      }
    );
  }


  /* Checkout */
  const checkoutButton =
    $("checkoutBtn");

  if (checkoutButton) {

    checkoutButton.addEventListener(
      "click",
      () => {

        if (!state.cart.length) {
          toast("Your cart is empty.");
          return;
        }

        hide("cartModal");
        hide("checkoutError");

        show("checkoutModal");
      }
    );
  }


  /* Checkout form */
  const checkoutForm =
    $("checkoutForm");

  if (checkoutForm) {

    checkoutForm.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        placeOrder(
          event.target
        );
      }
    );
  }


  /* Owner button */
  const ownerButton =
    $("ownerBtn");

  if (ownerButton) {

    ownerButton.addEventListener(
      "click",
      async () => {

        try {
          await openOwner();
        } catch (error) {
          console.error(error);
          toast(error.message);
        }
      }
    );
  }


  /* Login form */
  const loginForm =
    $("loginForm");

  if (loginForm) {

    loginForm.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        hide("loginError");

        const formData =
          new FormData(
            event.target
          );

        try {

          await ownerLogin(
            formData.get("email"),
            formData.get("password")
          );

          event.target.reset();

          hide("loginModal");

          await openOwner();

        } catch (error) {

          console.error(
            "Login:",
            error
          );

          const errorBox =
            $("loginError");

          if (errorBox) {

            errorBox.textContent =
              error.message ||
              "Login failed.";

            show("loginError");
          }
        }
      }
    );
  }


  /* Logout */
  const logoutButton =
    $("logoutBtn");

  if (logoutButton) {

    logoutButton.addEventListener(
      "click",
      logoutOwner
    );
  }


  /* Add product */
  const addProductButton =
    $("addProductBtn");

  if (addProductButton) {

    addProductButton.addEventListener(
      "click",
      () => openProductForm()
    );
  }


  /* Refresh orders */
  const refreshButton =
    $("refreshOrdersBtn");

  if (refreshButton) {

    refreshButton.addEventListener(
      "click",
      loadOrders
    );
  }


  /* Shop buttons */
  [
    "shopBtn",
    "heroShopBtn"
  ].forEach(id => {

    const button = $(id);

    if (button) {

      button.addEventListener(
        "click",
        () => {

          $("shopSection")
            ?.scrollIntoView({
              behavior: "smooth"
            });
        }
      );
    }
  });


  /* Hero cart */
  const heroCart =
    $("heroCartBtn");

  if (heroCart) {

    heroCart.addEventListener(
      "click",
      () => {

        renderCart();
        show("cartModal");
      }
    );
  }


  /* Footer cart */
  const footerCart =
    $("footerCartBtn");

  if (footerCart) {

    footerCart.addEventListener(
      "click",
      () => {

        renderCart();
        show("cartModal");
      }
    );
  }


  /* Category jump buttons */
  document
    .querySelectorAll(
      "[data-category-jump]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const category =
            button.dataset.categoryJump;

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


  /* Brand */
  const brand =
    $("brandLink");

  if (brand) {

    brand.addEventListener(
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


  /* Modal backdrops */
  document
    .querySelectorAll(
      ".modal-backdrop"
    )
    .forEach(modal =>
      modal.addEventListener(
        "click",
        backdropClose
      )
    );


  /* Product form */
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

          console.error(
            "Product save:",
            error
          );

          const errorBox =
            $("productError");

          if (errorBox) {

            errorBox.textContent =
              error.message ||
              "Could not save product.";

            show("productError");
          }
        }
      }
    );
  }
}


/* =========================================================
   START APPLICATION
   ========================================================= */

async function boot() {

  console.log(
    "NOOR & TIME starting..."
  );

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

  await loadProducts();

  /*
   * If an owner was previously logged in,
   * restore the session.
   */
  if (state.accessToken) {

    const valid =
      await checkOwner();

    if (valid) {

      console.log(
        "Owner session restored."
      );
    }
  }

  console.log(
    "NOOR & TIME ready."
  );
}


/* =========================================================
   DOM READY
   ========================================================= */

if (
  document.readyState === "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    boot,
    { once: true }
  );

} else {

  boot();
    }
