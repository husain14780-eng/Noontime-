/* =========================================================
   NOOR & TIME — app.js
   Complete frontend
   Supabase REST/Auth/Storage version
   ========================================================= */

"use strict";


/* =========================================================
   SUPABASE CONFIG
   ========================================================= */

const SUPABASE_URL =
  String(window.SUPABASE_URL || "").replace(/\/+$/, "");

const SUPABASE_KEY =
  String(window.SUPABASE_ANON_KEY || "");

const SUPABASE_LEGACY_KEY =
  String(window.SUPABASE_LEGACY_ANON_KEY || "");

const API =
  `${SUPABASE_URL}/rest/v1`;

const AUTH =
  `${SUPABASE_URL}/auth/v1`;

const STORAGE =
  `${SUPABASE_URL}/storage/v1`;


/* =========================================================
   APP STATE
   ========================================================= */

const state = {
  products: [],
  cart: [],
  currentFilter: "all",

  accessToken:
    localStorage.getItem("noor_owner_token") || "",

  refreshToken:
    localStorage.getItem("noor_owner_refresh") || "",

  owner: null,

  editingProduct: null,

  orderPoll: null,

  knownOrderIds:
    new Set(),

  newOrderCount: 0,

  refreshingSession: false,

  loginInProgress: false
};


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}

function show(id) {
  const el = $(id);
  if (el) {
    el.classList.remove("hidden");
  }
}

function hide(id) {
  const el = $(id);
  if (el) {
    el.classList.add("hidden");
  }
}

function money(value) {
  return new Intl.NumberFormat(
    "en-IN",
    {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }
  ).format(Number(value) || 0);
}

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );
}

function safeId(value) {
  return encodeURIComponent(
    String(value)
  );
}

function toast(message) {
  const el = $("toast");

  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = String(message);

  show("toast");

  clearTimeout(
    window.__noorToastTimer
  );

  window.__noorToastTimer =
    setTimeout(() => {
      hide("toast");
    }, 4500);
}

function setBusy(
  id,
  busy,
  busyText = "Please wait..."
) {
  const button = $(id);

  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText =
      button.textContent;
  }

  button.disabled = !!busy;

  if (busy) {
    button.textContent = busyText;
  } else {
    button.textContent =
      button.dataset.originalText;
  }
}

function parseJsonSafely(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}


/* =========================================================
   CART
   ========================================================= */

function loadCartFromStorage() {
  try {
    const saved =
      localStorage.getItem(
        "cod_store_cart"
      );

    state.cart =
      saved
        ? JSON.parse(saved)
        : [];

    if (!Array.isArray(state.cart)) {
      state.cart = [];
    }

  } catch {
    state.cart = [];
  }
}

function saveCart() {
  localStorage.setItem(
    "cod_store_cart",
    JSON.stringify(
      state.cart
    )
  );

  renderCartCount();
}

function renderCartCount() {
  const count =
    state.cart.reduce(
      (total, item) =>
        total +
        Number(item.quantity || 0),
      0
    );

  const el =
    $("cartCount");

  if (el) {
    el.textContent =
      String(count);
  }
}


/* =========================================================
   AUTH STORAGE
   ========================================================= */

function saveAuthSession(
  session
) {
  state.accessToken =
    session?.access_token || "";

  state.refreshToken =
    session?.refresh_token || "";

  state.owner =
    session?.user || state.owner || null;

  if (state.accessToken) {
    localStorage.setItem(
      "noor_owner_token",
      state.accessToken
    );
  } else {
    localStorage.removeItem(
      "noor_owner_token"
    );
  }

  if (state.refreshToken) {
    localStorage.setItem(
      "noor_owner_refresh",
      state.refreshToken
    );
  } else {
    localStorage.removeItem(
      "noor_owner_refresh"
    );
  }
}

function clearAuthSession() {
  state.accessToken = "";
  state.refreshToken = "";
  state.owner = null;

  localStorage.removeItem(
    "noor_owner_token"
  );

  localStorage.removeItem(
    "noor_owner_refresh"
  );
}


/* =========================================================
   SUPABASE REST REQUEST
   ========================================================= */

async function request(
  url,
  options = {},
  allowRefresh = true
) {
  if (!SUPABASE_URL) {
    throw new Error(
      "Supabase URL is missing."
    );
  }

  if (!SUPABASE_KEY) {
    throw new Error(
      "Supabase publishable key is missing."
    );
  }

  const headers = {
    apikey: SUPABASE_KEY,
    ...(options.headers || {})
  };

  if (state.accessToken) {
    headers.Authorization =
      `Bearer ${state.accessToken}`;
  }

  let response;

  try {
    response =
      await fetch(
        url,
        {
          method:
            options.method || "GET",

          headers,

          body:
            options.body
        }
      );
  } catch (networkError) {
    throw new Error(
      "Network error. Please check your internet connection."
    );
  }

  const raw =
    await response.text();

  const data =
    parseJsonSafely(raw);

  /*
   * Access token expired.
   * Try refreshing once and retry the original request.
   */
  if (
    response.status === 401 &&
    allowRefresh &&
    state.refreshToken &&
    !state.refreshingSession
  ) {
    try {

      await refreshOwnerSession();

      return await request(
        url,
        options,
        false
      );

    } catch {
      clearAuthSession();

      throw new Error(
        "Your owner session expired. Please sign in again."
      );
    }
  }

  if (!response.ok) {

    console.error(
      "Supabase request error:",
      {
        url,
        status:
          response.status,
        data
      }
    );

    let message =
      data?.error_description ||
      data?.msg ||
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error;

    if (!message) {

      if (
        response.status === 401
      ) {
        message =
          "Authentication failed.";
      } else if (
        response.status === 403
      ) {
        message =
          "You do not have permission to perform this action.";
      } else if (
        response.status === 404
      ) {
        message =
          "Requested resource was not found.";
      } else if (
        response.status === 429
      ) {
        message =
          "Too many requests. Please wait a moment and try again.";
      } else {
        message =
          `Request failed (${response.status}).`;
      }
    }

    const error =
      new Error(
        String(message)
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


/* =========================================================
   AUTH — REFRESH SESSION
   ========================================================= */

async function refreshOwnerSession() {

  if (
    state.refreshingSession
  ) {
    return false;
  }

  if (
    !state.refreshToken
  ) {
    return false;
  }

  state.refreshingSession =
    true;

  try {

    const response =
      await fetch(
        `${AUTH}/token?grant_type=refresh_token`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "apikey":
              SUPABASE_KEY
          },

          body:
            JSON.stringify({
              refresh_token:
                state.refreshToken
            })
        }
      );

    const raw =
      await response.text();

    const data =
      parseJsonSafely(raw);

    if (!response.ok) {
      throw new Error(
        data?.error_description ||
        data?.msg ||
        data?.message ||
        "Session refresh failed."
      );
    }

    if (
      !data?.access_token
    ) {
      throw new Error(
        "No access token returned during refresh."
      );
    }

    saveAuthSession({
      access_token:
        data.access_token,

      refresh_token:
        data.refresh_token ||
        state.refreshToken,

      user:
        data.user ||
        state.owner
    });

    return true;

  } finally {

    state.refreshingSession =
      false;
  }
}


/* =========================================================
   AUTH — OWNER LOGIN
   ========================================================= */

async function ownerLogin(
  email,
  password
) {
  if (state.loginInProgress) {
    throw new Error(
      "A login request is already running."
    );
  }

  state.loginInProgress = true;

  setBusy(
    "loginSubmitBtn",
    true,
    "Signing in..."
  );

  try {

    /*
     * Normalize ONLY the email.
     * NEVER trim the password because spaces can
     * legitimately be part of a password.
     */
    const cleanEmail =
      String(email || "")
        .trim()
        .toLowerCase();

    const cleanPassword =
      String(password || "");

    if (!cleanEmail) {
      throw new Error(
        "Enter your email address."
      );
    }

    if (!cleanPassword) {
      throw new Error(
        "Enter your password."
      );
    }

    console.log(
      "NOOR & TIME: sending password login request..."
    );

    /*
     * Supabase Auth password grant.
     */
    let response;

    try {

      response =
        await fetch(
          `${AUTH}/token?grant_type=password`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              "apikey":
                SUPABASE_KEY
            },

            body:
              JSON.stringify({
                email:
                  cleanEmail,

                password:
                  cleanPassword
              })
          }
        );

    } catch (networkError) {

      throw new Error(
        "Could not reach Supabase. Check your internet connection."
      );
    }

    const raw =
      await response.text();

    const data =
      parseJsonSafely(raw);

    console.log(
      "NOOR & TIME: Supabase Auth response",
      {
        status:
          response.status,

        code:
          data?.code,

        error:
          data?.error,

        message:
          data?.msg ||
          data?.message,

        description:
          data?.error_description
      }
    );

    if (!response.ok) {

      const authMessage =
        data?.error_description ||
        data?.msg ||
        data?.message ||
        data?.error;

      /*
       * Do not hide the actual Auth error.
       */
      if (
        response.status === 400
      ) {

        throw new Error(
          authMessage ||
          "Supabase rejected the email/password login."
        );
      }

      if (
        response.status === 429
      ) {

        throw new Error(
          "Too many login attempts. Please wait a few minutes before trying again."
        );
      }

      throw new Error(
        authMessage ||
        `Supabase login failed (${response.status}).`
      );
    }

    if (
      !data ||
      !data.access_token
    ) {
      throw new Error(
        "Supabase accepted the login request but did not return a session."
      );
    }

    /*
     * Store both access and refresh tokens.
     */
    saveAuthSession({
      access_token:
        data.access_token,

      refresh_token:
        data.refresh_token ||
        "",

      user:
        data.user ||
        null
    });

    /*
     * Verify the authenticated user directly.
     */
    let user;

    try {

      user =
        await request(
          `${AUTH}/user`
        );

    } catch (error) {

      clearAuthSession();

      throw new Error(
        `Login succeeded but the user session could not be verified: ${error.message}`
      );
    }

    if (!user?.id) {

      clearAuthSession();

      throw new Error(
        "Supabase returned an invalid owner session."
      );
    }

    state.owner =
      user;

    /*
     * Verify profile role.
     */
    const profiles =
      await request(
        `${API}/profiles?select=id,role&id=eq.${safeId(user.id)}&limit=1`
      );

    if (
      !Array.isArray(profiles) ||
      !profiles.length
    ) {

      clearAuthSession();

      throw new Error(
        "This Supabase account is authenticated but has no owner profile."
      );
    }

    if (
      profiles[0].role !== "owner"
    ) {

      clearAuthSession();

      throw new Error(
        "This account is not marked as an owner."
      );
    }

    return user;

  } catch (error) {

    console.error(
      "NOOR & TIME OWNER LOGIN ERROR:",
      error
    );

    clearAuthSession();

    throw error;

  } finally {

    setBusy(
      "loginSubmitBtn",
      false
    );

    state.loginInProgress =
      false;
  }
}


/* =========================================================
   AUTH — RESTORE SESSION
   ========================================================= */

async function checkOwner() {

  if (
    state.accessToken
  ) {

    try {

      const user =
        await request(
          `${AUTH}/user`,
          {},
          true
        );

      if (!user?.id) {
        throw new Error(
          "No authenticated user."
        );
      }

      const profiles =
        await request(
          `${API}/profiles?select=id,role&id=eq.${safeId(user.id)}&limit=1`
        );

      if (
        !profiles?.length ||
        profiles[0].role !== "owner"
      ) {
        throw new Error(
          "User is not an owner."
        );
      }

      state.owner =
        user;

      return true;

    } catch (error) {

      console.warn(
        "Existing session unavailable:",
        error
      );

      /*
       * Try refresh once.
       */
      if (
        state.refreshToken
      ) {

        try {

          await refreshOwnerSession();

          return await checkOwner();

        } catch {
          clearAuthSession();
        }
      }
    }
  }

  return false;
}


/* =========================================================
   PRODUCTS — PUBLIC
   ========================================================= */

async function loadProducts() {

  const grid =
    $("productGrid");

  try {

    const products =
      await request(
        `${API}/products?select=*&is_active=eq.true&order=created_at.desc`
      );

    state.products =
      Array.isArray(products)
        ? products
        : [];

    reconcileCart();

    renderProducts();

  } catch (error) {

    console.error(
      "Product load error:",
      error
    );

    if (grid) {

      grid.innerHTML = `
        <div class="empty-state">
          <strong>Products could not be loaded.</strong>
          <br>
          <small>
            ${escapeHtml(
              error.message
            )}
          </small>
        </div>
      `;
    }
  }
}

function reconcileCart() {

  const productMap =
    new Map(
      state.products.map(
        product => [
          product.id,
          product
        ]
      )
    );

  state.cart =
    state.cart
      .map(item => {

        const product =
          productMap.get(
            item.product_id
          );

        if (
          !product ||
          !product.is_active ||
          Number(product.stock) <= 0
        ) {
          return null;
        }

        const quantity =
          Math.min(
            Math.max(
              1,
              Number(
                item.quantity
              ) || 1
            ),
            Number(
              product.stock
            )
          );

        return {
          product_id:
            product.id,

          name:
            product.name,

          price:
            Number(
              product.price
            ),

          image_url:
            product.image_url,

          quantity
        };

      })
      .filter(Boolean);

  saveCart();
}

function renderProducts() {

  const grid =
    $("productGrid");

  if (!grid) return;

  const filtered =
    state.products.filter(
      product => {

        if (
          state.currentFilter ===
          "all"
        ) {
          return true;
        }

        return (
          product.category ===
          state.currentFilter
        );
      }
    );

  if (!filtered.length) {

    grid.innerHTML = `
      <div class="empty-state">
        No products available in this category yet.
      </div>
    `;

    return;
  }

  grid.innerHTML =
    filtered.map(
      product => {

        const soldOut =
          Number(product.stock) <= 0;

        return `
          <article class="product-card">

            ${
              product.image_url
                ? `
                  <img
                    class="product-image"
                    src="${escapeHtml(
                      product.image_url
                    )}"
                    alt="${escapeHtml(
                      product.name
                    )}"
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
                ${escapeHtml(
                  product.category
                )}
              </div>

              <div class="product-name">
                ${escapeHtml(
                  product.name
                )}
              </div>

              <div class="product-desc">
                ${escapeHtml(
                  product.description || ""
                )}
              </div>

              <div class="product-bottom">

                <div>

                  <div class="price">
                    ${money(
                      product.price
                    )}
                  </div>

                  <div class="cart-meta">
                    ${
                      soldOut
                        ? "Out of stock"
                        : `${escapeHtml(
                            product.stock
                          )} in stock`
                    }
                  </div>

                </div>

                <button
                  type="button"
                  class="add-btn"
                  data-add="${escapeHtml(
                    product.id
                  )}"
                  ${
                    soldOut
                      ? "disabled"
                      : ""
                  }
                >
                  ${
                    soldOut
                      ? "Sold out"
                      : "Add to cart"
                  }
                </button>

              </div>

            </div>

          </article>
        `;
      }
    ).join("");
}


/* =========================================================
   CART ACTIONS
   ========================================================= */

function addToCart(productId) {

  const product =
    state.products.find(
      item =>
        item.id ===
        productId
    );

  if (!product) {
    toast(
      "Product not found."
    );
    return;
  }

  if (
    Number(product.stock) <= 0
  ) {
    toast(
      "This product is out of stock."
    );
    return;
  }

  const existing =
    state.cart.find(
      item =>
        item.product_id ===
        productId
    );

  if (existing) {

    if (
      Number(
        existing.quantity
      ) >=
      Number(
        product.stock
      )
    ) {
      toast(
        "You cannot add more than the available stock."
      );
      return;
    }

    existing.quantity += 1;

  } else {

    state.cart.push({
      product_id:
        product.id,

      name:
        product.name,

      price:
        Number(
          product.price
        ),

      image_url:
        product.image_url,

      quantity: 1
    });
  }

  saveCart();
  renderCart();

  toast(
    `${product.name} added to cart.`
  );
}

function changeQuantity(
  productId,
  amount
) {

  const item =
    state.cart.find(
      cartItem =>
        cartItem.product_id ===
        productId
    );

  if (!item) return;

  const product =
    state.products.find(
      p =>
        p.id ===
        productId
    );

  const max =
    product
      ? Number(
          product.stock
        )
      : 99;

  item.quantity =
    Math.max(
      0,
      Math.min(
        max,
        Number(
          item.quantity
        ) + Number(amount)
      )
    );

  state.cart =
    state.cart.filter(
      cartItem =>
        cartItem.quantity > 0
    );

  saveCart();
  renderCart();
}

function removeFromCart(
  productId
) {

  state.cart =
    state.cart.filter(
      item =>
        item.product_id !==
        productId
    );

  saveCart();
  renderCart();
}

function renderCart() {

  const container =
    $("cartItems");

  const totalEl =
    $("cartTotal");

  const checkoutButton =
    $("checkoutBtn");

  if (!container) {
    return;
  }

  if (!state.cart.length) {

    container.innerHTML = `
      <div class="empty-state">
        Your cart is empty.
      </div>
    `;

    if (totalEl) {
      totalEl.textContent =
        money(0);
    }

    if (checkoutButton) {
      checkoutButton.disabled =
        true;
    }

    return;
  }

  if (checkoutButton) {
    checkoutButton.disabled =
      false;
  }

  let total = 0;

  container.innerHTML =
    state.cart.map(
      item => {

        const lineTotal =
          Number(item.price) *
          Number(item.quantity);

        total +=
          lineTotal;

        return `
          <div class="cart-row">

            ${
              item.image_url
                ? `
                  <img
                    class="cart-thumb"
                    src="${escapeHtml(
                      item.image_url
                    )}"
                    alt=""
                  >
                `
                : `
                  <div class="cart-thumb"></div>
                `
            }

            <div>

              <div class="cart-name">
                ${escapeHtml(
                  item.name
                )}
              </div>

              <div class="cart-meta">
                ${money(
                  item.price
                )} each
              </div>

              <div class="qty-controls">

                <button
                  type="button"
                  class="qty-btn"
                  data-qty="${escapeHtml(
                    item.product_id
                  )}"
                  data-delta="-1"
                >
                  −
                </button>

                <strong>
                  ${item.quantity}
                </strong>

                <button
                  type="button"
                  class="qty-btn"
                  data-qty="${escapeHtml(
                    item.product_id
                  )}"
                  data-delta="1"
                >
                  +
                </button>

                <button
                  type="button"
                  class="qty-btn"
                  data-remove="${escapeHtml(
                    item.product_id
                  )}"
                >
                  ×
                </button>

              </div>

            </div>

            <strong>
              ${money(
                lineTotal
              )}
            </strong>

          </div>
        `;
      }
    ).join("");

  if (totalEl) {
    totalEl.textContent =
      money(total);
  }
}


/* =========================================================
   CHECKOUT
   ========================================================= */

async function placeOrder(
  form
) {

  if (!state.cart.length) {
    toast(
      "Your cart is empty."
    );
    return;
  }

  setBusy(
    "placeOrderBtn",
    true,
    "Placing order..."
  );

  hide(
    "checkoutError"
  );

  try {

    const formData =
      new FormData(form);

    const items =
      state.cart.map(
        item => ({
          product_id:
            item.product_id,

          quantity:
            Number(
              item.quantity
            )
        })
      );

    const payload = {

      p_customer_name:
        String(
          formData.get(
            "customer_name"
          ) || ""
        ).trim(),

      p_phone:
        String(
          formData.get(
            "phone"
          ) || ""
        ).trim(),

      p_address:
        String(
          formData.get(
            "address"
          ) || ""
        ).trim(),

      p_city:
        String(
          formData.get(
            "city"
          ) || ""
        ).trim(),

      p_state:
        String(
          formData.get(
            "state"
          ) || ""
        ).trim(),

      p_pincode:
        String(
          formData.get(
            "pincode"
          ) || ""
        ).trim(),

      p_notes:
        String(
          formData.get(
            "notes"
          ) || ""
        ).trim() || null,

      p_items:
        items
    };

    const result =
      await request(
        `${API}/rpc/place_order`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              payload
            )
        }
      );

    const orderId =
      Array.isArray(result)
        ? result[0]
        : result;

    state.cart = [];

    saveCart();

    form.reset();

    hide(
      "checkoutModal"
    );

    hide(
      "cartModal"
    );

    await loadProducts();

    toast(
      `Order received successfully. Order ID: ${String(
        orderId || ""
      )
        .slice(0, 8)
        .toUpperCase()}`
    );

  } catch (error) {

    console.error(
      "Checkout error:",
      error
    );

    const box =
      $("checkoutError");

    if (box) {

      box.textContent =
        error.message ||
        "Could not place the order.";

      show(
        "checkoutError"
      );

    } else {

      toast(
        error.message ||
        "Could not place the order."
      );
    }

  } finally {

    setBusy(
      "placeOrderBtn",
      false
    );
  }
}


/* =========================================================
   OWNER DASHBOARD
   ========================================================= */

async function openOwner() {

  const valid =
    await checkOwner();

  if (!valid) {
    show(
      "loginModal"
    );
    return;
  }

  hide(
    "loginModal"
  );

  show(
    "ownerModal"
  );

  state.newOrderCount = 0;

  updateOrderBadge();

  await loadOwnerData();

  startOrderPolling();
}

async function loadOwnerData() {

  await Promise.all([
    loadOrders(),
    loadAdminProducts()
  ]);
}


/* =========================================================
   ORDERS
   ========================================================= */

async function loadOrders() {

  const container =
    $("ordersList");

  if (!container) {
    return;
  }

  try {

    const orders =
      await request(
        `${API}/orders?select=*,order_items(*)&order=created_at.desc`
      );

    const safeOrders =
      Array.isArray(orders)
        ? orders
        : [];

    /*
     * Detect new orders only after
     * the initial list has already been loaded.
     */
    if (
      state.knownOrderIds.size > 0
    ) {

      const newOrders =
        safeOrders.filter(
          order =>
            !state.knownOrderIds.has(
              order.id
            )
        );

      if (
        newOrders.length
      ) {

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
        safeOrders.map(
          order =>
            order.id
        )
      );

    if (!safeOrders.length) {

      container.innerHTML = `
        <div class="empty-state">
          No orders yet.
        </div>
      `;

      return;
    }

    container.innerHTML =
      safeOrders.map(
        order => {

          const items =
            Array.isArray(
              order.order_items
            )
              ? order.order_items
              : [];

          const itemHtml =
            items.map(
              item => `
                <div>
                  ${escapeHtml(
                    item.product_name
                  )}
                  × ${escapeHtml(
                    item.quantity
                  )}
                  —
                  ${money(
                    Number(
                      item.unit_price
                    ) *
                    Number(
                      item.quantity
                    )
                  )}
                </div>
              `
            ).join("");

          const created =
            order.created_at
              ? new Date(
                  order.created_at
                ).toLocaleString(
                  "en-IN"
                )
              : "";

          return `
            <article class="order-card">

              <div class="order-head">

                <div>

                  <div class="product-cat">
                    ORDER
                    ${escapeHtml(
                      String(
                        order.id
                      ).slice(
                        0,
                        8
                      )
                    )}
                  </div>

                  <strong>
                    ${escapeHtml(
                      order.customer_name
                    )}
                  </strong>

                  <div class="cart-meta">
                    ${escapeHtml(
                      order.phone
                    )}
                    •
                    ${escapeHtml(
                      created
                    )}
                  </div>

                </div>

                <select
                  class="status-select"
                  data-order-status="${escapeHtml(
                    order.id
                  )}"
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
                      .map(
                        status => `
                          <option
                            value="${status}"
                            ${
                              order.status ===
                              status
                                ? "selected"
                                : ""
                            }
                          >
                            ${status.toUpperCase()}
                          </option>
                        `
                      )
                      .join("")
                  }

                </select>

              </div>

              <div class="order-items">
                ${itemHtml}
              </div>

              <div class="order-address">

                <strong>
                  ${money(
                    order.total_amount
                  )}
                  • COD
                </strong>

                <br>

                ${escapeHtml(
                  order.address
                )},
                ${escapeHtml(
                  order.city
                )},
                ${escapeHtml(
                  order.state
                )}
                -
                ${escapeHtml(
                  order.pincode
                )}

                ${
                  order.notes
                    ? `
                      <br>
                      Note:
                      ${escapeHtml(
                        order.notes
                      )}
                    `
                    : ""
                }

              </div>

            </article>
          `;
        }
      ).join("");

  } catch (error) {

    console.error(
      "Orders load error:",
      error
    );

    container.innerHTML = `
      <div class="empty-state">

        Could not load orders.

        <br>

        <small>
          ${escapeHtml(
            error.message
          )}
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
      `${API}/orders?id=eq.${safeId(
        orderId
      )}`,
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify({
            status:
              String(
                status
              ),

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );

    toast(
      "Order status updated."
    );

  } catch (error) {

    toast(
      error.message ||
      "Could not update order."
    );

    /*
     * Reload to restore the actual status.
     */
    await loadOrders();
  }
}


/* =========================================================
   ORDER POLLING
   ========================================================= */

function startOrderPolling() {

  stopOrderPolling();

  state.orderPoll =
    setInterval(
      async () => {

        const modal =
          $("ownerModal");

        if (
          state.owner &&
          modal &&
          !modal.classList.contains(
            "hidden"
          )
        ) {
          await loadOrders();
        }

      },
      10000
    );
}

function stopOrderPolling() {

  if (
    state.orderPoll
  ) {

    clearInterval(
      state.orderPoll
    );

    state.orderPoll =
      null;
  }
}

function updateOrderBadge() {

  const badge =
    $("newOrderBadge");

  if (!badge) {
    return;
  }

  if (
    state.newOrderCount >
    0
  ) {

    badge.textContent =
      String(
        state.newOrderCount
      );

    show(
      "newOrderBadge"
    );

  } else {

    hide(
      "newOrderBadge"
    );
  }
}


/* =========================================================
   ADMIN PRODUCTS
   ========================================================= */

async function loadAdminProducts() {

  const container =
    $("adminProductList");

  if (!container) {
    return;
  }

  try {

    const products =
      await request(
        `${API}/products?select=*&order=created_at.desc`
      );

    const list =
      Array.isArray(products)
        ? products
        : [];

    if (!list.length) {

      container.innerHTML = `
        <div class="empty-state">
          No products yet.
        </div>
      `;

      return;
    }

    container.innerHTML =
      list.map(
        product => `

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
                  : `
                    <div class="admin-thumb"></div>
                  `
              }

              <div>

                <strong>
                  ${escapeHtml(
                    product.name
                  )}
                </strong>

                <div class="cart-meta">

                  ${escapeHtml(
                    product.category
                  )}

                  •
                  ${money(
                    product.price
                  )}

                  • stock:
                  ${escapeHtml(
                    product.stock
                  )}

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
                type="button"
                class="ghost-btn"
                data-edit-product="${escapeHtml(
                  product.id
                )}"
              >
                Edit
              </button>

              <button
                type="button"
                class="danger-btn"
                data-delete-product="${escapeHtml(
                  product.id
                )}"
              >
                Delete
              </button>

            </div>

          </article>

        `
      ).join("");

  } catch (error) {

    container.innerHTML = `
      <div class="empty-state">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


/* =========================================================
   PRODUCT EDITOR
   ========================================================= */

function openProductForm(
  product = null
) {

  state.editingProduct =
    product;

  const form =
    $("productForm");

  if (!form) {
    return;
  }

  form.reset();

  if (
    form.elements.id
  ) {
    form.elements.id.value =
      product?.id || "";
  }

  if (
    form.elements.name
  ) {
    form.elements.name.value =
      product?.name || "";
  }

  if (
    form.elements.category
  ) {
    form.elements.category.value =
      product?.category ||
      "attar";
  }

  if (
    form.elements.description
  ) {
    form.elements.description.value =
      product?.description ||
      "";
  }

  if (
    form.elements.price
  ) {
    form.elements.price.value =
      product?.price ??
      "";
  }

  if (
    form.elements.stock
  ) {
    form.elements.stock.value =
      product?.stock ??
      0;
  }

  if (
    form.elements.is_active
  ) {
    form.elements.is_active.value =
      String(
        product?.is_active ??
        true
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

    errorBox.textContent =
      "";

    hide(
      "productError"
    );
  }

  const existing =
    $("existingImageWrap");

  if (
    product?.image_url &&
    existing
  ) {

    existing.innerHTML = `
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

    show(
      "existingImageWrap"
    );

  } else {

    hide(
      "existingImageWrap"
    );
  }

  show(
    "productModal"
  );
}

async function saveProduct(
  form
) {

  const formData =
    new FormData(form);

  const name =
    String(
      formData.get(
        "name"
      ) || ""
    ).trim();

  if (!name) {
    throw new Error(
      "Enter a product name."
    );
  }

  const price =
    Number(
      formData.get(
        "price"
      )
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price < 0
  ) {
    throw new Error(
      "Enter a valid price."
    );
  }

  const stock =
    Number(
      formData.get(
        "stock"
      )
    );

  if (
    !Number.isInteger(
      stock
    ) ||
    stock < 0
  ) {
    throw new Error(
      "Enter a valid stock quantity."
    );
  }

  const file =
    formData.get(
      "image"
    );

  if (
    file &&
    file.size
  ) {

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      throw new Error(
        "Image must be 5 MB or smaller."
      );
    }

    if (
      !String(
        file.type
      ).startsWith(
        "image/"
      )
    ) {
      throw new Error(
        "Please select an image file."
      );
    }
  }

  let imageUrl =
    state.editingProduct
      ?.image_url ||
    null;

  /*
   * Upload a new image if provided.
   */
  if (
    file &&
    file.size
  ) {

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
        ) ||
      "jpg";

    const filename =
      `${crypto.randomUUID()}.${extension}`;

    await request(
      `${STORAGE}/object/product-images/${encodeURIComponent(
        filename
      )}`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            file.type,

          "x-upsert":
            "false"
        },

        body:
          file
      }
    );

    imageUrl =
      `${STORAGE}/object/public/product-images/${filename}`;
  }

  const payload = {

    name,

    category:
      String(
        formData.get(
          "category"
        ) ||
        "attar"
      ),

    description:
      String(
        formData.get(
          "description"
        ) ||
        ""
      ).trim(),

    price,

    stock,

    is_active:
      formData.get(
        "is_active"
      ) === "true",

    image_url:
      imageUrl
  };

  if (
    state.editingProduct
  ) {

    await request(
      `${API}/products?id=eq.${safeId(
        state.editingProduct.id
      )}`,
      {
        method:
          "PATCH",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  } else {

    await request(
      `${API}/products`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );
  }

  state.editingProduct =
    null;

  hide(
    "productModal"
  );

  await loadProducts();
  await loadAdminProducts();

  toast(
    "Product saved successfully."
  );
}

async function editProduct(
  productId
) {

  try {

    const products =
      await request(
        `${API}/products?select=*&id=eq.${safeId(
          productId
        )}&limit=1`
      );

    if (
      products?.[0]
    ) {
      openProductForm(
        products[0]
      );
    }

  } catch (error) {

    toast(
      error.message
    );
  }
}

async function deleteProduct(
  productId
) {

  if (
    !window.confirm(
      "Delete this product?"
    )
  ) {
    return;
  }

  try {

    await request(
      `${API}/products?id=eq.${safeId(
        productId
      )}`,
      {
        method:
          "DELETE"
      }
    );

    await loadProducts();
    await loadAdminProducts();

    toast(
      "Product deleted."
    );

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

async function logoutOwner() {

  try {

    if (
      state.accessToken
    ) {

      await fetch(
        `${AUTH}/logout`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "apikey":
              SUPABASE_KEY,

            "Authorization":
              `Bearer ${state.accessToken}`
          }
        }
      );
    }

  } catch (error) {

    console.warn(
      "Logout request failed:",
      error
    );

  } finally {

    clearAuthSession();

    stopOrderPolling();

    hide(
      "ownerModal"
    );

    hide(
      "loginModal"
    );

    toast(
      "Signed out."
    );
  }
}


/* =========================================================
   MODALS
   ========================================================= */

function closeModal(id) {

  if (!id) {
    return;
  }

  hide(id);
}

function backdropClose(event) {

  if (
    event.target &&
    event.target.classList &&
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
   EVENT BINDING
   ========================================================= */

function bindEvents() {

  /*
   * Delegated clicks.
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
            "[data-category]"
          )
          .forEach(
            button =>
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

      const tabButton =
        event.target.closest(
          "[data-tab]"
        );

      if (tabButton) {

        document
          .querySelectorAll(
            "[data-tab]"
          )
          .forEach(
            button =>
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
          .forEach(
            panel =>
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


  /*
   * Cart.
   */
  const cartButton =
    $("cartBtn");

  if (cartButton) {

    cartButton.addEventListener(
      "click",
      () => {

        renderCart();

        show(
          "cartModal"
        );
      }
    );
  }


  /*
   * Checkout.
   */
  const checkoutButton =
    $("checkoutBtn");

  if (checkoutButton) {

    checkoutButton.addEventListener(
      "click",
      () => {

        if (!state.cart.length) {

          toast(
            "Your cart is empty."
          );

          return;
        }

        hide(
          "cartModal"
        );

        hide(
          "checkoutError"
        );

        show(
          "checkoutModal"
        );
      }
    );
  }


  /*
   * Checkout submit.
   */
  const checkoutForm =
    $("checkoutForm");

  if (checkoutForm) {

    checkoutForm.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        placeOrder(
          event.currentTarget
        );
      }
    );
  }


  /*
   * Owner login button.
   */
  const ownerButton =
    $("ownerBtn");

  if (ownerButton) {

    ownerButton.addEventListener(
      "click",
      async () => {

        try {

          const valid =
            await checkOwner();

          if (valid) {

            hide(
              "loginModal"
            );

            await openOwner();

          } else {

            show(
              "loginModal"
            );
          }

        } catch (error) {

          console.error(
            error
          );

          show(
            "loginModal"
          );
        }
      }
    );
  }


  /*
   * Login form.
   */
  const loginForm =
    $("loginForm");

  if (loginForm) {

    loginForm.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        hide(
          "loginError"
        );

        const formData =
          new FormData(
            event.currentTarget
          );

        try {

          await ownerLogin(
            formData.get(
              "email"
            ),

            formData.get(
              "password"
            )
          );

          event.currentTarget.reset();

          hide(
            "loginModal"
          );

          await openOwner();

        } catch (error) {

          console.error(
            "Login form error:",
            error
          );

          const box =
            $("loginError");

          if (box) {

            box.textContent =
              error.message ||
              "Login failed.";

            show(
              "loginError"
            );

          } else {

            toast(
              error.message ||
              "Login failed."
            );
          }
        }
      }
    );
  }


  /*
   * Logout.
   */
  const logoutButton =
    $("logoutBtn");

  if (logoutButton) {

    logoutButton.addEventListener(
      "click",
      logoutOwner
    );
  }


  /*
   * Add product.
   */
  const addProductButton =
    $("addProductBtn");

  if (addProductButton) {

    addProductButton.addEventListener(
      "click",
      () =>
        openProductForm()
    );
  }


  /*
   * Refresh orders.
   */
  const refreshOrdersButton =
    $("refreshOrdersBtn");

  if (refreshOrdersButton) {

    refreshOrdersButton.addEventListener(
      "click",
      async () => {

        try {

          await loadOrders();

          toast(
            "Orders refreshed."
          );

        } catch (error) {

          toast(
            error.message
          );
        }
      }
    );
  }


  /*
   * Product form.
   */
  const productForm =
    $("productForm");

  if (productForm) {

    productForm.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        hide(
          "productError"
        );

        try {

          await saveProduct(
            event.currentTarget
          );

        } catch (error) {

          console.error(
            "Product save error:",
            error
          );

          const box =
            $("productError");

          if (box) {

            box.textContent =
              error.message ||
              "Could not save product.";

            show(
              "productError"
            );

          } else {

            toast(
              error.message ||
              "Could not save product."
            );
          }
        }
      }
    );
  }


  /*
   * Modal backdrop.
   */
  document
    .querySelectorAll(
      ".modal-backdrop"
    )
    .forEach(
      modal =>
        modal.addEventListener(
          "click",
          backdropClose
        )
    );


  /*
   * Shop buttons.
   */
  [
    "shopBtn",
    "heroShopBtn"
  ].forEach(
    id => {

      const button =
        $(id);

      if (button) {

        button.addEventListener(
          "click",
          () => {

            const shop =
              $("shopSection");

            if (shop) {

              shop.scrollIntoView({
                behavior:
                  "smooth"
              });
            }
          }
        );
      }
    }
  );


  /*
   * Hero cart.
   */
  const heroCart =
    $("heroCartBtn");

  if (heroCart) {

    heroCart.addEventListener(
      "click",
      () => {

        renderCart();

        show(
          "cartModal"
        );
      }
    );
  }


  /*
   * Footer cart.
   */
  const footerCart =
    $("footerCartBtn");

  if (footerCart) {

    footerCart.addEventListener(
      "click",
      () => {

        renderCart();

        show(
          "cartModal"
        );
      }
    );
  }


  /*
   * Category jump.
   */
  document
    .querySelectorAll(
      "[data-category-jump]"
    )
    .forEach(
      button => {

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

            const shop =
              $("shopSection");

            if (shop) {

              shop.scrollIntoView({
                behavior:
                  "smooth"
              });
            }
          }
        );
      }
    );


  /*
   * Brand link.
   */
  const brand =
    $("brandLink");

  if (brand) {

    brand.addEventListener(
      "click",
      event => {

        event.preventDefault();

        window.scrollTo({
          top: 0,
          behavior:
            "smooth"
        });
      }
    );
  }
}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  console.log(
    "NOOR & TIME starting..."
  );

  if (!SUPABASE_URL) {

    console.error(
      "SUPABASE_URL is missing."
    );

    toast(
      "Store configuration is missing."
    );

    return;
  }

  if (!SUPABASE_KEY) {

    console.error(
      "SUPABASE_ANON_KEY is missing."
    );

    toast(
      "Store authentication configuration is missing."
    );

    return;
  }

  /*
   * Load local cart.
   */
  loadCartFromStorage();

  renderCartCount();

  /*
   * Set footer year.
   */
  const year =
    $("year");

  if (year) {
    year.textContent =
      String(
        new Date().getFullYear()
      );
  }

  /*
   * Wire UI.
   */
  bindEvents();

  /*
   * Load storefront.
   */
  await loadProducts();

  /*
   * Restore owner session.
   */
  if (
    state.accessToken ||
    state.refreshToken
  ) {

    const valid =
      await checkOwner();

    if (valid) {

      console.log(
        "NOOR & TIME: owner session restored."
      );
    }
  }

  console.log(
    "NOOR & TIME ready."
  );
}


/* =========================================================
   START
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    boot,
    {
      once: true
    }
  );

} else {

  boot();
         }
