
/**
 * FÁBRICA APP - LATAS ENLOZADAS
 * Standalone App for Production Entry, Stock Management, and Cage Assembly.
 * Extracted from APP LOZA - Module: Fábrica
 */

const YIQI_CONFIG = {
    entityId: 794,          // Stock View
    smartieId: 2749,        // Stock Factory Smartie
    smartieRevestimientos: 2750, // Stock Jaulas Cerradas Smartie (legacy, unused now)
    smartieJaulasCerradas: 2735, // Jaulas Armadas/Cerradas (Entity 781)
    smartieRemitosActivos: 2737, // Active Remitos Smartie (Entity 781)
    entityRemito: 781,      // Remito Interno Entity
    childRemitoId: 227,     // Remito Interno Items Child ID
    depoFabricaId: 156,
    depoMustangId: 191,     // Mustang (Intermediate)
    depoRevestimientosId: 189,
    schemaId: 1491,
    user: "mercadolibre@tmcrespo.com.ar",
    pass: "AdministracionMessi",
    tokenUrls: [
        "https://api.yiqi.com.ar/token",
        "https://api.yiqi.com.ar/connect/token",
        "https://me.yiqi.com.ar/connect/token"
    ],
    saveUrls: [
        "https://api.yiqi.com.ar/api/instancesApi/Save"
    ],
    getListUrl: "https://api.yiqi.com.ar/api/instancesApi/GetList",
    getChildListUrl: "https://me.yiqi.com.ar/api/childrenApi/GetChildList",
    searchChildUrl: "https://me.yiqi.com.ar/api/childrenApi/GetSearchResult",
    saveChildUrl: "https://api.yiqi.com.ar/api/childrenApi/SaveChildInstances",
    entityArticulos: 782,
    smartieArticulos: 2744,
    entityAlta: 1389,
    smartieAltas: 2705,
    smartieAltasPendientes: 2745,
    entityGrupos: 763,
    smartieGrupos: 2594,
    executeTransitionUrl: "https://api.yiqi.com.ar/api/workflowApi/ExecuteTransition",
    deleteUrl: "https://api.yiqi.com.ar/api/instancesApi/Delete",
    entityRemitoItem: 783,

    // --- OTROS ---
    smartieNroRemitoExterno: 2767  // Smartie ordenada por Nro Remito Externo DESC
};

/**
 * NAVEGACIÓN ENTRE SOLAPAS (Mobile-First)
 */
function switchTab(tabId) {
    console.log("🚀 Cambiando a solapa:", tabId);
    
    // Ocultar todas las solapas
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    // Desactivar todos los botones de nav
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    
    // Mostrar solapa seleccionada
    const targetPane = document.getElementById(`view-${tabId}`);
    if (targetPane) targetPane.classList.add('active');
    
    // Activar botón de nav
    const targetNav = document.getElementById(`nav-${tabId}`);
    if (targetNav) targetNav.classList.add('active');

    // Scroll al inicio de la vista
    window.scrollTo(0, 0);
}

// --- STATE ---
let stock = [];
let remitos = [];
let activeRemito = null;
let activeRemitoItems = [];
let yiqiToken = null;
let articlesMap = {};       // SKU -> ID Lookup
let articlesIdMap = {};     // ID -> SKU Lookup
let enlozadasGroupId = null;
let enlozadasArticles = [];
let recentAltas = [];
let closedCages = [];       // Jaulas cerradas for reprint
let currentStockView = 'FABRICA'; // 'FABRICA' or 'CERRADAS'
let pendientesAltas = [];

// --- SEQUENTIAL REMITO NUMBER ---
let currentRemitoSeq = 0;

function getNextRemitoSeq() {
    currentRemitoSeq++;
    return currentRemitoSeq;
}

function getCurrentRemitoSeq() {
    return currentRemitoSeq;
}

/**
 * Sincroniza el contador con el último Nro Remito Externo de YiQi.
 * La smartie está ordenada DESC, así que el primer registro es el más alto.
 * Si YiQi devuelve un número mayor al local, actualizamos. Así nunca se pisa.
 */
async function initRemitoSeq() {
    let yiqiMax = 0;

    try {
        console.log(`📋 Consultando último Nro Remito Externo en YiQi (Smartie ${YIQI_CONFIG.smartieNroRemitoExterno})...`);
        const data = await YiQi.fetch(YIQI_CONFIG.smartieNroRemitoExterno, YIQI_CONFIG.entityRemito);
        if (data && data.length > 0) {
            // El primero es el más alto (smartie ordenada DESC)
            const firstVal = data[0].REIN_NRO_EXTERNO || data[0]['13096'] || "";
            yiqiMax = parseInt(firstVal) || 0;
            console.log(`📋 Último Nro Remito Externo en YiQi: ${yiqiMax}`);
        }
    } catch (e) {
        console.warn('⚠️ No se pudo consultar smartie de Nro Externo:', e);
    }

    if (yiqiMax > 0) {
        currentRemitoSeq = yiqiMax;
        console.log(`📋 Secuencia inicializada estrictamente desde YiQi: ${currentRemitoSeq}`);
    } else {
        // Fallback manual si no hay datos en la Smartie
        const startStr = await showPrompt(
            "Configurar Numeración",
            "La Smartie de YiQi no devolvió remitos previos.<br>Ingrese el <b>último número de remito utilizado</b>.<br>El próximo será el siguiente.<br><br><small>Ej: si el último fue 1705, ingrese 1705.</small>",
            "0", "number"
        );
        currentRemitoSeq = parseInt(startStr) || 0;
        console.log(`📋 Secuencia inicializada manualmente en: ${currentRemitoSeq}`);
    }
}

// --- SYNC ENGINE ---

async function triggerGlobalRefresh(showSpinners = true) {
    try {
        await Promise.all([
            fetchStock(),
            fetchAltasRecientes(),
            fetchAltasPendientes()
        ]);
    } catch (e) {
        console.error("Sync Error:", e);
    }
}

function startIntelligentSyncPulse() {
    console.log("🚀 Iniciando ráfaga de sincronización (5s pulse)...");
    let count = 0;
    const maxPulses = 6;
    
    triggerGlobalRefresh(true);

    const interval = setInterval(async () => {
        count++;
        if (count >= maxPulses) {
            clearInterval(interval);
            console.log("🏁 Finalizada ráfaga de sincronización.");
        } else {
            await triggerGlobalRefresh(true);
        }
    }, 5000);
}

function startAutoRefreshEngine() {
    setInterval(() => {
        console.log("⌚ Auto-refresco global (120s heartbeat)...");
        triggerGlobalRefresh(false); 
    }, 120000);
}

// --- YIQI API ---

const YiQi = {
    async getToken() {
        if (yiqiToken) return yiqiToken;
        console.log("🔑 Authenticating...");
        updateStatus("Autenticando...");
        for (const url of YIQI_CONFIG.tokenUrls) {
            try {
                const r = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        grant_type: "password",
                        username: YIQI_CONFIG.user,
                        password: YIQI_CONFIG.pass
                    })
                });
                if (r.ok) {
                    const data = await r.json();
                    yiqiToken = data.access_token;
                    return yiqiToken;
                }
            } catch (e) { console.error("Login failed:", e); }
        }
        return null;
    },

    async fetch(smartieId, entityId) {
        updateStatus("Cargando datos...");
        const token = await this.getToken();
        if (!token) return null;

        let url = `${YIQI_CONFIG.getListUrl}?entityId=${entityId}&schemaId=${YIQI_CONFIG.schemaId}`;
        if (smartieId) url += `&smartieId=${smartieId}`;

        let allRows = [];
        let page = 1;
        const pageSize = 50;
        let hasMore = true;

        try {
            while (hasMore) {
                console.log(`📡 Fetching Page ${page}...`);
                const r = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ page: page, pageSize: pageSize })
                });

                if (r.ok) {
                    const res = await r.json();
                    let rows = res.data || res.rows || res.instances || [];

                    if (rows.length > 0 && page === 1) console.log("DEBUG SAMPLE ROW:", rows[0]);
                    if (rows.length < pageSize) hasMore = false;
                    allRows = allRows.concat(rows);
                    page++;
                    if (page > 50) hasMore = false;
                } else {
                    console.error("Fetch Page Error:", r.status);
                    hasMore = false;
                }
            }
            return allRows;
        } catch (e) { console.error("Fetch failed:", e); }
        return null;
    },

    async fetchArticles() {
        updateStatus("Cargando Maestro de Artículos...");
        const rows = await this.fetch(YIQI_CONFIG.smartieArticulos, YIQI_CONFIG.entityArticulos);
        if (rows) {
            rows.forEach(r => {
                const code = r.CODIGO || r.MATE_CODIGO || r.STOC_SKU || "";
                const id = r.ID || r.MATE_ID_MATE;
                if (code) articlesMap[code] = id;
                if (id) articlesIdMap[id] = code;
            });
            console.log(`📚 Articles Master Loaded: ${Object.keys(articlesMap).length} items`);
        }
    },

    async saveHeader(data, originId, destId, nroRemitoExterno = null) {
        updateStatus("Creando cabecera de Remito...");
        const org = originId || YIQI_CONFIG.depoFabricaId;
        const dst = destId || YIQI_CONFIG.depoMustangId;

        const token = await this.getToken();
        if (!token) return false;

        let formStr = `4181=${org}&4182=${dst}&4180=${encodeURIComponent(data.observacion || "-")}`;
        if (nroRemitoExterno !== null) {
            formStr += `&13096=${nroRemitoExterno}`;
        }

        const payload = {
            schemaId: YIQI_CONFIG.schemaId,
            entityId: String(YIQI_CONFIG.entityRemito),
            form: formStr,
            uploads: "",
            parentId: null,
            childId: null
        };

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            for (const url of YIQI_CONFIG.saveUrls) {
                try {
                    const r = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                        body: JSON.stringify(payload)
                    });
                    const res = await r.json();
                    if (res.ok || res.success || res.newId) return res.newId;

                    const errMsg = res.error || '';
                    console.warn(`⚠️ saveHeader intento ${attempt}/${maxRetries} rechazado:`, JSON.stringify(res));

                    if (res.validation === true && errMsg.includes('existe')) {
                        console.error(`❌ saveHeader: Clave duplicada detectada. Abortando.`);
                        return false;
                    }
                } catch (e) { console.error(`saveHeader intento ${attempt} excepción:`, e); }
            }
            if (attempt < maxRetries) {
                console.log(`🔄 saveHeader: Reintentando en 2s... (${attempt}/${maxRetries})`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        return false;
    },

    async saveChildInstances(instanceId, items) {
        updateStatus(`Guardando ${items.length} items...`);
        const token = await this.getToken();
        if (!token) return false;

        const payload = {
            entityId: String(YIQI_CONFIG.entityRemito),
            schemaId: YIQI_CONFIG.schemaId,
            childId: YIQI_CONFIG.childRemitoId,
            instanceId: String(instanceId),
            childInstances: items.map(i => JSON.stringify(i)),
            append: true
        };

        try {
            const r = await fetch(YIQI_CONFIG.saveChildUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            if (r.ok) {
                const res = await r.json();
                console.log("✅ Save Child Success:", res);
                return true;
            } else {
                const errText = await r.text();
                console.error("❌ Save Child Error:", errText);
            }
        } catch (e) { console.error("Save Child Exception:", e); }
        return false;
    },

    async getChildItems(instanceId) {
        updateStatus("Actualizando items del remito...");
        const token = await this.getToken();
        if (!token) return null;

        const url = `${YIQI_CONFIG.getChildListUrl}?entityId=${YIQI_CONFIG.entityRemito}&schemaId=${YIQI_CONFIG.schemaId}&childId=${YIQI_CONFIG.childRemitoId}&instanceId=${instanceId}&take=100&skip=0&page=1&pageSize=100&search=`;

        try {
            const r = await fetch(url, {
                method: "GET",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
            });
            if (r.ok) {
                const res = await r.json();
                return res.data || res.rows || res.instances || [];
            }
        } catch (e) { console.error("Get Child Items Failed:", e); }
        return null;
    },

    async searchArticle(sku) {
        updateStatus(`Buscando ${sku}...`);
        const token = await this.getToken();
        if (!token) return null;

        const url = `${YIQI_CONFIG.searchChildUrl}?entityId=${YIQI_CONFIG.entityRemito}&schemaId=${YIQI_CONFIG.schemaId}&childId=${YIQI_CONFIG.childRemitoId}&query=${encodeURIComponent(sku)}&pageSize=20`;

        try {
            const r = await fetch(url, {
                method: "GET",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (r.ok) {
                const res = await r.json();
                const list = res.data || res.rows || res.instances || res || [];
                if (list.length > 0) {
                    const exactMatch = list.find(i => i.CODIGO === sku);
                    return exactMatch || list[0];
                }
            }
        } catch (e) { console.error("Search Article Failed:", e); }
        return null;
    },

    async getInstance(entityId, instanceId) {
        const token = await this.getToken();
        if (!token) return null;

        const url = `https://api.yiqi.com.ar/api/instancesApi/GetInstance?schemaId=${YIQI_CONFIG.schemaId}&entityId=${entityId}&id=${instanceId}`;
        
        try {
            const r = await fetch(url, {
                method: "GET",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            console.error("Get Instance Failed:", e);
            return null;
        }
    },

    async deleteItem(itemId) {
        updateStatus("Eliminando item...");
        const token = await this.getToken();
        if (!token) return false;

        const url = `${YIQI_CONFIG.deleteUrl}?schemaId=${YIQI_CONFIG.schemaId}&entityId=${YIQI_CONFIG.entityRemitoItem}&ids=${itemId}`;

        try {
            const r = await fetch(url, {
                method: "GET",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (r.ok) return true;
        } catch (e) { console.error("Delete Failed:", e); }
        return false;
    },

    async executeTransition(remitoId) {
        updateStatus(`Cancelando Remito ${remitoId}...`);
        const token = await this.getToken();
        if (!token) return false;

        const payload = {
            schemaId: YIQI_CONFIG.schemaId,
            ids: [String(remitoId)],
            transitionId: 118453,
            form: ""
        };

        try {
            const r = await fetch(YIQI_CONFIG.executeTransitionUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            if (r.ok) return true;
            else {
                const errText = await r.text();
                console.error("Transition Error:", errText);
                showModal("Error YiQi", `Error al cancelar: ${errText}`, "error");
            }
        } catch (e) {
            console.error("Transition Failed:", e);
            showModal("Error", `Excepción al cancelar: ${e.message}`, "error");
        }
    },

    async cloneRemito(originalId, newOrigin, newDest, customObs = null, nroRemitoExterno = null) {
        updateStatus("🔍 Iniciando Clonación de Jaula...");

        let items = [];
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            updateStatus(`Leyendo ítems del remito original... (Intento ${attempts + 1})`);
            items = await this.getChildItems(originalId);
            if (items && items.length > 0) break;
            attempts++;
            if (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!items || items.length === 0) {
            throw new Error("No se pudo leer el contenido de la jaula original.");
        }

        const newItems = items.map(i => {
            const codigo = i.MATE_CODIGO || i.CODIGO || i.codigo || i.mate_codigo || "";
            const nombre = i.DERI_NOMBRE_ARTICULO || i.NOMBRE || i.nombre || i.MATE_NOMBRE || "";
            let articleId = articlesMap[codigo] || i.MATE_ID_MATE || i.mate_id_mate || i.ID_MATE || i.ID_ARTICULO || i.mate_id;

            if (!articleId && codigo) {
                const s = stock.find(x => (x.MATE_CODIGO === codigo) || (x.STOC_SKU === codigo));
                if (s) articleId = s.MATE_ID_MATE || s.ID;
            }

            const qty = Number(i.DERI_CANTIDAD || i.CANTIDAD || i.cantidad || 0);

            return {
                "CANTIDAD": qty,
                "DERI_CANTIDAD": String(qty),
                "DERI_NRO_SERIE": "",
                "CODIGO": codigo,
                "NOMBRE": nombre,
                "MATE_ID_MATE": articleId || null,
                "CODIGO_EN_EL_PROVEED": null,
                "COD_PROV_2": null,
                "ID_UNIVERSAL": null
            };
        });

        const validItems = newItems.filter(i => i.CANTIDAD > 0 && (i.MATE_ID_MATE || i.CODIGO));
        if (validItems.length === 0) {
            throw new Error("La jaula original está vacía o no es compatible.");
        }

        const originalRemito = remitos.find(r => String(r.id) === String(originalId)) || { obs: "Jaula" };
        let newObs = customObs || originalRemito.obs || "Jaula Clonada";
        newObs = newObs.replace(/procesada/gi, "").trim();

        // If no explicit nroRemitoExterno, try to read from original remito data
        if (!nroRemitoExterno && originalRemito.remitoExtNum) {
            nroRemitoExterno = originalRemito.remitoExtNum;
        }
        if (!nroRemitoExterno && originalRemito.yiqiData) {
            nroRemitoExterno = originalRemito.yiqiData.REIN_NRO_EXTERNO || "";
        }

        console.log(`📋 Clonando con Remito Externo N° ${nroRemitoExterno || '(sin dato)'}`);
        const newId = await this.saveHeader({ observacion: newObs }, newOrigin, newDest, nroRemitoExterno || null);
        if (!newId) throw new Error("No se pudo crear la cabecera del nuevo remito.");

        updateStatus(`Copiando contenido a remito #${newId}...`);
        const success = await this.saveChildInstances(newId, validItems);

        if (success) {
            console.log(`✨ Clonación exitosa: ${originalId} -> ${newId}`);
            return newId;
        } else {
            throw new Error(`Se creó el remito #${newId} vacío. Bórralo en YiQi y prueba de nuevo.`);
        }
    },

    async closeCage(remitoId) {
        const token = await this.getToken();
        if (!token) return false;

        const updateLoading = (msg) => {
            const p = document.querySelector('#loading-overlay p');
            if (p) p.innerText = msg;
            console.log(`[CERRAR JAULA] ${msg}`);
        };

        try {
            await processRemitoTransitions([String(remitoId)], updateLoading, true);

            updateLoading("🚀 Paso 3: Generando copia para Logística...");

            // Read Nro Remito Externo from the active remito to propagate it
            let nroExt = null;
            if (activeRemito) {
                nroExt = activeRemito.remitoExtNum
                    || activeRemito.yiqiData?.REIN_NRO_EXTERNO
                    || null;
            }
            if (!nroExt) {
                // Fallback: try to read from YiQi instance directly
                try {
                    const instanceData = await this.getInstance(YIQI_CONFIG.entityRemito, remitoId);
                    if (instanceData) {
                        nroExt = instanceData.REIN_NRO_EXTERNO || instanceData['13096'] || null;
                    }
                } catch (e) { console.warn('Could not read instance for nroExt:', e); }
            }

            try {
                await this.cloneRemito(remitoId, YIQI_CONFIG.depoRevestimientosId, YIQI_CONFIG.depoMustangId, null, nroExt);
                updateLoading("✅ Proceso completo: Jaula cerrada y clonada.");
            } catch (cloneErr) {
                console.error("Auto-Clone Failed:", cloneErr);
                showModal("Advertencia", "La jaula se cerró pero falló la creación del duplicado a Mustang.", "warning");
            }

            return true;
        } catch (e) {
            console.error("Error en closeCage:", e);
            throw e;
        }
    }
};


// --- TRANSITION HELPER (Universal) ---
async function processRemitoTransitions(ids, statusFn, throwOnFirstFail = true) {
    const token = await YiQi.getToken();
    if (!token) throw new Error("Sin token de autenticación");

    const log = (msg) => {
        if (statusFn) statusFn(msg);
        console.log(`[TRANSITION] ${msg}`);
    };

    // PASO 1: Pendiente/Creado → Enviado (118455)
    log("Paso 1: Enviando...");
    const r1 = await fetch(YIQI_CONFIG.executeTransitionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ schemaId: YIQI_CONFIG.schemaId, ids: ids, transitionId: 118455, form: "" })
    });

    let r1Data = null;
    try { r1Data = await r1.json(); } catch { r1Data = { ok: r1.ok }; }

    if (!r1.ok || r1Data.ok === false) {
        const errMsg = `Transición 118455 falló: ${r1Data.error || r1Data.okMessage || 'Error desconocido'}`;
        if (throwOnFirstFail) throw new Error(errMsg);
        console.warn(`⚠️ ${errMsg} (continuando al paso 2)`);
    }

    log("⏳ Sincronizando...");
    await new Promise(r => setTimeout(r, 3000));
    for (const id of ids) {
        try { await YiQi.getInstance(YIQI_CONFIG.entityRemito, id); } catch {}
    }

    // PASO 2: Enviado → Procesado (118456)
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        log(`Paso 2: Procesando... (Intento ${attempt}/${maxAttempts})`);

        const r2 = await fetch(YIQI_CONFIG.executeTransitionUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ schemaId: YIQI_CONFIG.schemaId, ids: ids, transitionId: 118456, form: "" })
        });

        let r2Data = null;
        try { r2Data = await r2.json(); } catch { r2Data = { ok: r2.ok }; }

        if (r2.ok && r2Data.ok !== false) {
            log("✅ Transición Procesado confirmada!");
            return true;
        }

        const errorMsg = r2Data.error || r2Data.okMessage || '';
        const isWaiting = errorMsg.includes('esperar') || r2Data.validation === true;
        const noItems = errorMsg.includes('items recibidos');

        if (attempt < maxAttempts) {
            const wait = (isWaiting || noItems) ? 5000 : 3000;
            log(`⚠️ ${isWaiting ? 'YiQi sigue procesando' : 'Error'}. Reintentando en ${wait/1000}s...`);
            await new Promise(r => setTimeout(r, wait));
            for (const id of ids) {
                try { await YiQi.getInstance(YIQI_CONFIG.entityRemito, id); } catch {}
            }
        }
    }

    throw new Error(`No se pudo procesar tras ${maxAttempts} intentos.`);
}


// --- CUSTOM MODALS ---
const Modal = {
    overlay: () => document.getElementById('custom-modal'),
    icon: () => document.getElementById('modal-icon'),
    title: () => document.getElementById('modal-title'),
    message: () => document.getElementById('modal-message'),
    actions: () => document.getElementById('modal-actions'),

    close() {
        const ov = this.overlay();
        if (!ov) return;
        ov.classList.remove('active');
        ov.onclick = null;
        ov.dataset.closing = "true";
        setTimeout(() => {
            if (ov.dataset.closing === "true") {
                ov.style.visibility = 'hidden';
                if (this.actions()) this.actions().innerHTML = '';
            }
        }, 150);
    },

    open(iconStr, titleStr, msgHtml, buttonsHtml, closeOnClickOutside = false) {
        const ov = this.overlay();
        if (!ov) {
            alert(titleStr + "\n" + msgHtml.replace(/<[^>]*>?/gm, ''));
            return;
        }

        ov.dataset.closing = "false";
        this.icon().innerText = iconStr;
        this.title().innerText = titleStr;
        this.message().innerHTML = msgHtml;
        this.actions().innerHTML = buttonsHtml;

        ov.style.transition = 'none';
        ov.style.visibility = 'visible';
        void ov.offsetWidth;
        ov.style.transition = '';

        requestAnimationFrame(() => ov.classList.add('active'));

        if (closeOnClickOutside) {
            ov.onclick = (e) => {
                if (e.target === ov) this.close();
            };
        } else {
            ov.onclick = null;
        }
    }
};

function showModal(title, msg, type = 'info') {
    return new Promise(resolve => {
        let isResolved = false;
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        const btnClass = type === 'error' ? 'btn-danger-modal' : 'btn-confirm';
        const btns = `<button class="btn-modal ${btnClass}" id="modal-btn-ok">Aceptar</button>`;

        Modal.open(icon, title, msg, btns);

        const closeMod = (res) => {
            if (isResolved) return;
            isResolved = true;
            Modal.close();
            resolve(res);
        };

        const ov = Modal.overlay();
        if (ov) {
            ov.onclick = (e) => {
                if (e.target === ov) closeMod();
            };
        }

        const btn = document.getElementById('modal-btn-ok');
        if (btn) {
            btn.onclick = closeMod;
            if (type !== 'error') {
                setTimeout(() => { if (document.getElementById('modal-btn-ok')) btn.focus() }, 100);
            }
        } else { closeMod(); }
    });
}

function showConfirm(title, msg, confirmText = 'Confirmar', cancelText = 'Cancelar') {
    return new Promise(resolve => {
        const btns = `
            <button class="btn-modal btn-cancel" id="modal-btn-cancel">${cancelText}</button>
            <button class="btn-modal btn-confirm" id="modal-btn-confirm">${confirmText}</button>
        `;
        Modal.open('⚠️', title, msg, btns);

        const btnCancel = document.getElementById('modal-btn-cancel');
        const btnConfirm = document.getElementById('modal-btn-confirm');

        if (btnCancel) btnCancel.onclick = () => { Modal.close(); resolve(false); };
        if (btnConfirm) {
            btnConfirm.onclick = () => { Modal.close(); resolve(true); };
            btnConfirm.focus();
        }
    });
}

function showPrompt(title, msg, defaultValue = '', inputType = 'text') {
    return new Promise(resolve => {
        const inputHtml = `<div style="margin-top:10px;"><input type="${inputType}" id="modal-input" class="form-control" value="${defaultValue}" style="width:100%; text-align:center; font-size:1.2rem;"></div>`;
        const btns = `
            <button class="btn-modal btn-cancel" id="modal-btn-cancel">Cancelar</button>
            <button class="btn-modal btn-confirm" id="modal-btn-ok">Aceptar</button>
        `;

        Modal.open('📝', title, `<div>${msg}</div>${inputHtml}`, btns);

        const input = document.getElementById('modal-input');
        if (input) {
            input.focus();
            input.select();
        }

        let isResolved = false;
        const confirm = () => {
            if (isResolved) return;
            const val = input ? input.value : null;
            if (!val) { if (input) input.style.border = "2px solid red"; return; }
            isResolved = true;
            if (input) input.removeEventListener('keyup', handleKeyup);
            Modal.close();
            resolve(val);
        };

        const cancel = () => {
            if (isResolved) return;
            isResolved = true;
            if (input) input.removeEventListener('keyup', handleKeyup);
            Modal.close();
            resolve(null);
        };

        const btnOk = document.getElementById('modal-btn-ok');
        const btnCancel = document.getElementById('modal-btn-cancel');

        if (btnOk) btnOk.onclick = confirm;
        if (btnCancel) btnCancel.onclick = cancel;

        const handleKeyup = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (btnOk) btnOk.disabled = true;
                if (input) input.disabled = true;
                confirm();
            }
            if (e.key === 'Escape') cancel();
        };

        if (input) {
            input.addEventListener('keyup', handleKeyup);
        }
    });
}


// --- UI LOGIC ---

async function init() {
    showLoading(true);
    updateStatus("Iniciando aplicación...");

    try {
        yiqiToken = await YiQi.getToken();

        if (yiqiToken) {
            console.log('✅ Conectado a YiQi');
            
            // Initialize sequential remito counter (prompts on first use)
            await initRemitoSeq();
            
            console.log("🚀 Starting Fábrica App...");

            try {
                await YiQi.fetchArticles(); 

                const p1 = YiQi.fetch(YIQI_CONFIG.smartieId, YIQI_CONFIG.entityId).then(d => stock = d || []);
                const p3 = fetchGroupsAndArticles();
                const p5 = fetchAltasRecientes();
                const p6 = fetchAltasPendientes();
                await Promise.all([p1, p3, p5, p6]);

                startAutoRefreshEngine();
            } catch (e) {
                console.error("Data Load Failed", e);
            }
            renderStock();

            try {
                await fetchActiveRemitos();
            } catch (e) { console.error("Remitos Load Failed", e); remitos = []; }
            renderRemitos();

        } else {
            const statusEl = document.getElementById('status-indicator');
            if (statusEl) {
                statusEl.className = "status-dot red";
                statusEl.title = "Desconectado";
            }
        }
    } catch (e) {
        console.error("INIT ERROR:", e);
        alert(`Error al iniciar: ${e.message}`);
    } finally {
        showLoading(false);
    }
}

// --- REMITOS / JAULAS ---

async function fetchActiveRemitos() {
    const btnRefresh = document.querySelector('button[title="Actualizar Jaulas"]');
    if (btnRefresh) btnRefresh.classList.add('spin');

    try {
        const data = await YiQi.fetch(YIQI_CONFIG.smartieRemitosActivos, YIQI_CONFIG.entityRemito);
        if (data) {
            remitos = data.map(r => {
                let nro = r.REIN_NRO_REMITO_INTERNO || r.NUMERO_COMPROBANTE || r.REIN_ASIGNAR_NRO_COMPR || "";
                if (!nro && r.REIN_PUNTO_DE_VENTA && r.REIN_NUMERO) {
                    nro = `${r.REIN_PUNTO_DE_VENTA.toString().padStart(4, '0')}-${r.REIN_NUMERO.toString().padStart(8, '0')}`;
                }
                return {
                    id: r.ID || r.id,
                    nroComprobante: nro || "S/N",
                    obs: r.REIN_OBSERVACION || "",
                    nroRemitoExterno: r.REIN_NRO_EXTERNO || r['13096'] || "",
                    status: 'OPEN',
                    yiqiData: r
                };
            });

            if (activeRemito) {
                const updated = remitos.find(r => r.id == activeRemito.id);
                if (updated) {
                    const currentServerItems = activeRemito.serverItems;
                    Object.assign(activeRemito, updated);
                    if (currentServerItems) activeRemito.serverItems = currentServerItems;

                    const displayNum = (activeRemito.nroComprobante && activeRemito.nroComprobante !== "S/N" && activeRemito.nroComprobante !== "undefined")
                        ? activeRemito.nroComprobante : `ID: ${activeRemito.id}`;
                    const idBadge = document.getElementById('active-remito-id');
                    if (idBadge) {
                        idBadge.innerText = displayNum;
                        idBadge.style.display = 'block';
                    }
                }
            }
        }
        renderRemitos();
        return data;
    } finally {
        if (btnRefresh) btnRefresh.classList.remove('spin');
    }
}

async function fetchStock() {
    const btnRefresh = document.querySelector('button[title="Actualizar"]');
    if (btnRefresh) btnRefresh.classList.add('spin');

    const list = document.getElementById('stock-list');
    if (!list) return;

    if (!stock || stock.length === 0) {
        list.innerHTML = `<p class="text-muted text-center" style="padding:1rem;">Actualizando mercadería...</p>`;
    }

    try {
        const data = await YiQi.fetch(YIQI_CONFIG.smartieId, YIQI_CONFIG.entityId);
        if (data) {
            stock = data;
            renderStock();
        } else {
            list.innerHTML = `<p style="text-align:center;color:#666;">Error al cargar stock</p>`;
        }
    } catch (e) {
        console.error("Error al cargar stock:", e);
    } finally {
        if (btnRefresh) btnRefresh.classList.remove('spin');
    }
}

function renderStock() {
    const list = document.getElementById('stock-list');

    if (stock.length === 0) {
        list.innerHTML = `<p class="text-muted text-center" style="padding:1rem;">No hay stock disponible.</p>`;
        return;
    }

    list.innerHTML = stock
        .filter(item => (item.STOC_CANTIDAD || 0) > 0)
        .map(item => {
        const itemSku = item.STOC_SKU || item.MATE_NOMBRE;
        let usedQty = 0;

        if (activeRemitoItems) {
            usedQty += activeRemitoItems
                .filter(i => i.sku === itemSku)
                .reduce((sum, i) => sum + i.qty, 0);
        }

        if (activeRemito && activeRemito.serverItems) {
            usedQty += activeRemito.serverItems
                .filter(i => {
                    const serverSku = i.MATE_CODIGO || i.CODIGO || i.MATE_NOMBRE;
                    return serverSku === itemSku;
                })
                .reduce((sum, i) => sum + (i.DERI_CANTIDAD || 0), 0);
        }

        const remaining = (item.STOC_CANTIDAD || 0) - usedQty;
        const remainingDisplay = `<span style="color: var(--primary); font-weight: bold; margin-left: 5px;" title="Disponible tras remito">(${remaining})</span>`;

        const safeName = (item.MATE_NOMBRE || item.NOMBRE || '').replace(/'/g, "\\'");

        return `
        <div class="list-item" onclick="selectStockItem('${itemSku}', ${item.STOC_CANTIDAD || 0}, ${item.MATE_ID_MATE || 0}, '${safeName}')">
            <div>
                <strong>${itemSku || 'Sin Nombre'}</strong>
                <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 2px;">${item.MATE_NOMBRE || item.NOMBRE || ''}</div>
                <div class="text-sm text-muted">
                    Stock: ${item.STOC_CANTIDAD || 0} ${remainingDisplay}
                </div>
            </div>
            <button class="btn btn-sm btn-primary">+</button>
        </div>
        `;
    }).join('');
}

function filtrarStock() {
    const query = (document.getElementById('search-stock').value || "").toLowerCase().trim();
    const items = document.querySelectorAll('#stock-list .list-item, #stock-list .closed-cage-card');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
    });
}

function toggleStockView(view) {
    const btnFab = document.getElementById('btn-fabrica');
    const btnRev = document.getElementById('btn-revestimientos');
    const title = document.getElementById('col-stock-title');
    const searchInput = document.getElementById('search-stock');

    currentStockView = view;

    if (view === 'FABRICA') {
        if (btnFab) btnFab.classList.add('active', 'btn-primary');
        if (btnRev) btnRev.classList.remove('active', 'btn-primary');
        if (title) title.textContent = '🏭 Stock';
        if (searchInput) searchInput.placeholder = '🔍 Buscar artículo...';
        fetchStock();
    } else {
        if (btnRev) btnRev.classList.add('active', 'btn-primary');
        if (btnFab) btnFab.classList.remove('active', 'btn-primary');
        if (title) title.textContent = '📦 Jaulas Cerradas';
        if (searchInput) searchInput.placeholder = '🔍 Buscar jaula...';
        fetchClosedCages();
    }
}

function refreshCurrentView() {
    if (currentStockView === 'CERRADAS') {
        fetchClosedCages();
    } else {
        fetchStock();
    }
}

// --- JAULAS CERRADAS (Reprint Label) ---

async function fetchClosedCages() {
    const btnRefresh = document.querySelector('button[title="Actualizar"]');
    if (btnRefresh) btnRefresh.classList.add('spin');

    const list = document.getElementById('stock-list');
    if (!list) return;

    list.innerHTML = `<p class="text-muted text-center" style="padding:1rem;">Cargando jaulas cerradas...</p>`;

    try {
        const data = await YiQi.fetch(YIQI_CONFIG.smartieJaulasCerradas, YIQI_CONFIG.entityRemito);
        if (data) {
            closedCages = data.map(r => {
                // Try to extract Nro Remito Externo (field 13096) from response
                const remitoExt = r.REIN_NRO_EXTERNO || r.REIN_NRO_REMITO_EXTERNO || r.NRO_REMITO_EXTERNO || r.REMITO_EXTERNO || r['13096'] || "";
                return {
                    id: r.ID || r.id,
                    obs: r.REIN_OBSERVACION || "Jaula",
                    nroComprobante: r.REIN_NRO_REMITO_INTERNO || r.NUMERO_COMPROBANTE || "S/N",
                    nroRemitoExterno: remitoExt,
                    yiqiData: r
                };
            });
            renderClosedCages();
        } else {
            list.innerHTML = `<p style="text-align:center; color:#666;">Error al cargar jaulas.</p>`;
        }
    } catch (e) {
        console.error("Error cargando jaulas cerradas:", e);
        list.innerHTML = `<p class="text-danger text-center" style="padding:1rem;">Error al cargar jaulas.</p>`;
    } finally {
        if (btnRefresh) btnRefresh.classList.remove('spin');
    }
}

function renderClosedCages() {
    const list = document.getElementById('stock-list');

    if (closedCages.length === 0) {
        list.innerHTML = `<p class="text-muted text-center" style="padding:1rem;">No hay jaulas cerradas.</p>`;
        return;
    }

    list.innerHTML = closedCages.map(cage => {
        let jaulaNum = "?";
        if (cage.obs && cage.obs.includes("Jaula N°")) {
            const match = cage.obs.match(/Jaula N°\s*(\d+)/);
            if (match) jaulaNum = match[1];
        }

        // Show Remito N° if available, fallback to YiQi ID
        const remitoExt = cage.nroRemitoExterno;
        const idDisplay = remitoExt ? `Remito N° ${remitoExt}` : `ID: ${cage.id}`;

        return `
        <div class="closed-cage-card" style="padding: 0.85rem; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 0.5rem; border-left: 4px solid var(--success); display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong style="font-size: 1.05rem;">${cage.obs || 'Jaula'}</strong>
                <div class="text-sm" style="margin-top: 2px; color: ${remitoExt ? '#1d4ed8' : 'var(--text-muted)'}; font-weight: ${remitoExt ? '600' : '400'};">${idDisplay}</div>
            </div>
            <button class="btn btn-sm" onclick="reprintCageLabel(${cage.id})" style="background: #dbeafe; color: #1d4ed8; font-weight: 600; gap: 4px;">
                🖨️ Rótulo
            </button>
        </div>
        `;
    }).join('');
}

async function selectStockItem(sku, maxQty, mateIdFromStock, name = "") {
    if (!activeRemito) {
        await showModal("Atención", "Primero crea o selecciona una Jaula.");
        return;
    }

    if (currentStockView === 'CERRADAS') {
        return; // No permitir desde vista de jaulas cerradas
    }

    const jaulaTitle = activeRemito.obs || `Jaula`;
    const msg = `Agregar <b>${sku}</b> a: <b>${jaulaTitle}</b><br>Disponible: ${maxQty}<br>Ingresa cantidad:`;
    const qtyStr = await showPrompt("Agregar Item", msg, String(maxQty), "number");
    if (!qtyStr) return;

    const qty = parseInt(qtyStr);
    if (isNaN(qty) || qty <= 0) {
        await showModal("Error", "Cantidad inválida.", "error");
        return;
    }

    const currentServerQty = (activeRemito.serverItems || [])
        .filter(i => (i.MATE_CODIGO || i.CODIGO) === sku)
        .reduce((sum, i) => sum + Number(i.DERI_CANTIDAD || 0), 0);

    if (qty + currentServerQty > maxQty) {
        const remaining = maxQty - currentServerQty;
        await showModal("Stock Insuficiente", `⚠️ NO TIENES ESA CANTIDAD EN STOCK.<br><br>Stock Total: ${maxQty}<br>Ya en la jaula: ${currentServerQty}<br>Disponible para agregar: <b>${remaining}</b>`, "error");
        return;
    }

    await guardarUnItemDirecto({
        sku: sku,
        qty: qty,
        mateId: mateIdFromStock || null,
        name: name
    });
}

async function guardarUnItemDirecto(item) {
    showLoading(true);
    updateStatus(`Guardando ${item.sku}...`);

    try {
        let realId = item.mateId;

        if (!realId) {
            const art = await YiQi.searchArticle(item.sku);
            if (art) {
                realId = art.MATE_ID_MATE || art.id || art.ID || art.MATE_ID;
            }
        }

        if (!realId) {
            throw new Error(`No se pudo encontrar el ID para ${item.sku}`);
        }

        const yiQiItem = {
            "CANTIDAD": Number(item.qty),
            "DERI_CANTIDAD": String(item.qty),
            "DERI_NRO_SERIE": "",
            "CODIGO": item.sku,
            "NOMBRE": item.name || item.sku,
            "MATE_ID_MATE": realId,
            "CODIGO_EN_EL_PROVEED": null,
            "COD_PROV_2": null,
            "ID_UNIVERSAL": null
        };

        const success = await YiQi.saveChildInstances(activeRemito.id, [yiQiItem]);
        
        if (success) {
            updateStatus("✅ Ítem guardado.");
            await fetchRemitoItems(activeRemito.id);
        } else {
            throw new Error("Error en la respuesta de YiQi.");
        }
    } catch (e) {
        console.error(e);
        await showModal("Error al Guardar", `No se pudo guardar el ítem:<br>${e.message}`, "error");
    } finally {
        showLoading(false);
    }
}

async function crearNuevoRemito() {
    const rawInput = await showPrompt("Nueva Jaula", "Ingrese el <b>NÚMERO DE JAULA</b>:", "", "number");

    if (rawInput === null) return;

    if (!rawInput || isNaN(rawInput) || !/^\d+$/.test(rawInput.trim())) {
        await showModal("Error", "⚠️ Debe ingresar solo caracteres numéricos para el número de jaula.", "error");
        return;
    }

    const jaulaNum = rawInput.trim();
    const obs = `Jaula N° ${jaulaNum}`;

    // Auto-assign sequential Remito N°
    const remitoSeq = getNextRemitoSeq();
    console.log(`📋 Asignando Remito N° ${remitoSeq} a Jaula ${jaulaNum}`);

    showLoading(true);
    const newId = await YiQi.saveHeader(
        { observacion: obs },
        YIQI_CONFIG.depoFabricaId,
        YIQI_CONFIG.depoRevestimientosId,
        remitoSeq  // Campo 13096: Nro Remito Externo
    );
    showLoading(false);

    if (newId) {
        await fetchActiveRemitos();
        const newRemito = remitos.find(r => r.id == newId) || { id: newId, obs: obs, nroComprobante: "Generando...", status: 'OPEN' };
        newRemito.remitoExtNum = remitoSeq; // Store locally
        await showModal("Éxito", `Jaula <b>${jaulaNum}</b> creada.<br>Remito N° <b>${remitoSeq}</b>`, "success");
        setActiveRemito(newRemito);
        renderRemitos();
    } else {
        // Rollback the sequence if creation failed
        currentRemitoSeq--;
        showModal("Error", "Error al crear la Jaula. El número de remito fue revertido.", "error");
    }
}

function renderRemitos() {
    const list = document.getElementById('remito-list');
    list.innerHTML = remitos.map(r => `
        <div class="remito-card ${activeRemito && activeRemito.id === r.id ? 'active' : ''}" onclick="selectRemito(${r.id})" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="flex: 1; min-width: 0;">
                <strong style="font-size:1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${r.obs || "Jaula"}</strong>
            </div>
            <div style="flex: 1; text-align: center; color: #94a3b8; font-weight: 700; font-size: 0.9rem;">
                ${r.nroRemitoExterno ? 'R: ' + r.nroRemitoExterno : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end; flex: 1;">
                <span class="badge bg-green">ABIERTO</span>
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); cancelarRemito(event, ${r.id})" title="Cancelar Remito" style="padding: 2px 8px; font-size: 0.8rem; z-index: 2;">✕</button>
            </div>
        </div>
    `).join('');
}

function selectRemito(id) {
    const r = remitos.find(x => x.id === id);
    if (r) setActiveRemito(r);
}

function clearActiveRemito() {
    activeRemito = null;
    activeRemitoItems = [];
    
    // Ocultar badges de cabecera
    const idBadge = document.getElementById('active-remito-id');
    if (idBadge) {
        idBadge.innerText = "";
        idBadge.style.display = 'none';
    }
    
    const jaulaBadge = document.getElementById('active-jaula-badge');
    if (jaulaBadge) {
        jaulaBadge.innerText = "";
        jaulaBadge.style.display = 'none';
    }

    // Ocultar globito del header
    const bubble = document.getElementById('active-cage-bubble');
    if (bubble) bubble.style.display = 'none';

    // Ocultar indicador de llenado
    const llenadoIndicator = document.getElementById('llenado-indicator');
    if (llenadoIndicator) llenadoIndicator.classList.remove('visible');
    const llenadoNum = document.getElementById('llenado-jaula-num');
    if (llenadoNum) {
        llenadoNum.innerText = 'Sin jaula';
        llenadoNum.style.color = '';
    }

    // Resetear paneles
    const detailPanel = document.getElementById('detail-panel');
    if (detailPanel) detailPanel.style.display = 'none';
    
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'flex';

    // Limpiar lista de items
    const itemList = document.getElementById('remito-items');
    if (itemList) itemList.innerHTML = '';
    const totalEl = document.getElementById('total-items');
    if (totalEl) totalEl.innerText = '0';

    renderRemitos();
    renderStock();
}

async function setActiveRemito(remito) {
    activeRemito = remito;
    activeRemitoItems = [];
    activeRemito.serverItems = [];

    let obsText = remito.obs || String(remito.id);
    if (!obsText.toLowerCase().includes("jaula")) {
        obsText = `Jaula N° ${obsText}`;
    }

    const extNum = remito.nroRemitoExterno || remito.remitoExtNum || (remito.yiqiData ? (remito.yiqiData.REIN_NRO_EXTERNO || remito.yiqiData['13096']) : null) || "";
    const remitoExtDisplay = extNum ? `R: ${extNum}` : '';

    // Actualizar el "Globito" de jaula activa en el header
    const bubble = document.getElementById('active-cage-bubble');
    if (bubble) {
        bubble.innerText = `📦 ${obsText}`;
        bubble.style.display = 'block';
    }

    // Actualizar indicador de jaula en la solapa Llenado
    const llenadoIndicator = document.getElementById('llenado-indicator');
    if (llenadoIndicator) {
        llenadoIndicator.innerText = `📦 Cargando en: ${obsText}`;
        llenadoIndicator.classList.add('visible');
    }
    const llenadoNum = document.getElementById('llenado-jaula-num');
    if (llenadoNum) {
        llenadoNum.innerText = remitoExtDisplay;
        llenadoNum.style.color = 'var(--text-muted)';
    }

    // SALTO AUTOMÁTICO A LLENADO
    switchTab('llenado');

    const detailPanel = document.getElementById('detail-panel');
    if (detailPanel) detailPanel.style.display = 'block';
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    renderActiveRemitoItems();
    fetchRemitoItems(remito.id);
}

async function fetchRemitoItems(remitoId) {
    const serverItems = await YiQi.getChildItems(remitoId);
    if (serverItems) {
        activeRemito.serverItems = serverItems;
        renderActiveRemitoItems();
        renderStock();
    }
}

function renderActiveRemitoItems() {
    const list = document.getElementById('remito-items');
    let html = '';

    if (activeRemitoItems.length > 0) {
        html += `<div class="text-sm text-muted" style="padding:0.5rem; border-bottom:1px solid #eee;">Pendientes de guardar:</div>`;
        html += activeRemitoItems.map((item, idx) => {
            const displayName = item.name ? `<b>${item.sku}</b> - ${item.name}` : `<b>${item.sku}</b>`;
            return `
            <div class="list-item" style="background: #fff3cd;">
                <span>${displayName}</span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <strong>${item.qty} (Pend.)</strong>
                    <button class="btn btn-sm btn-danger" onclick="deletePendingItem(${idx})" style="padding:0px 8px;" title="Borrar">✕</button>
                </div>
            </div>
            `;
        }).join('');
    }

    if (activeRemito && activeRemito.serverItems && activeRemito.serverItems.length > 0) {
        html += `<div class="text-sm text-muted" style="padding:0.5rem; border-bottom:1px solid #eee; margin-top:0.5rem;">Guardados en YiQi:</div>`;
        html += activeRemito.serverItems.map(item => {
            const sku = item.MATE_CODIGO || item.CODIGO || "";
            const name = item.MATE_NOMBRE || item.DERI_NOMBRE_ARTICULO || item.NOMBRE || "";
            const fallback = item.MATE_NOMBRE || item.MATE_CODIGO || item.CODIGO || 'Item';
            const displayName = (sku && name && sku !== name) ? `<b>${sku}</b> - ${name}` : `<b>${fallback}</b>`;

            return `
            <div class="list-item">
                <span>${displayName}</span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <strong>${item.DERI_CANTIDAD}</strong>
                    <button class="btn btn-sm btn-danger" onclick="deleteSavedItem(${item.ID || item.id})" style="padding:0px 8px;" title="Borrar de YiQi">✕</button>
                </div>
            </div>
            `;
        }).join('');
    }

    if (html === '') html = `<p class="text-muted text-center p-3">Sin items.</p>`;
    list.innerHTML = html;

    const total = (activeRemitoItems.length) + (activeRemito.serverItems ? activeRemito.serverItems.length : 0);
    const totalEl = document.getElementById('total-items');
    if (totalEl) totalEl.innerText = total;

    const footer = document.getElementById('remito-actions');
    if (footer) {
        const hasSavedItems = activeRemito.serverItems && activeRemito.serverItems.length > 0;
        const hasPendingItems = activeRemitoItems.length > 0;

        if (hasSavedItems || hasPendingItems) {
            footer.innerHTML = `
                <div style="display:flex; gap:10px; justify-content: flex-end; flex-wrap: wrap;">
                     ${hasPendingItems ? `<button class="btn btn-primary" onclick="guardarItemsEnYiqi()">💾 Guardar Pendientes</button>` : ''}
                     ${hasSavedItems ? `<button class="btn btn-success" onclick="cerrarJaula()">🖨️ Rotular Jaula</button>` : ''}
                </div>
            `;
        } else {
            footer.innerHTML = `<p class="text-center text-muted" style="font-size:0.8rem; margin:0;">Agregue ítems del stock para comenzar.</p>`;
        }
    }

    renderStock();
}

async function cerrarJaula() {
    if (!activeRemito) return;

    let jaulaNum = "?";
    if (activeRemito.obs && activeRemito.obs.includes("Jaula N°")) {
        const match = activeRemito.obs.match(/Jaula N°\s*(\d+)/);
        if (match) jaulaNum = match[1];
    } else {
        jaulaNum = activeRemito.id;
    }

    let totalUnits = 0;
    let summaryHtml = `
        <div style="text-align:left; margin-top:1rem; border:1px solid #eee; border-radius:4px; overflow:hidden;">
            <table style="width:100%; border-collapse: collapse; font-size:0.85rem;">
                <thead style="background:#f1f5f9; color:#64748b;">
                    <tr>
                        <th style="padding:6px 8px; text-align:left;">Item</th>
                        <th style="padding:6px 8px; text-align:right;">Cant.</th>
                    </tr>
                </thead>
                <tbody>`;

    if (activeRemito.serverItems && activeRemito.serverItems.length > 0) {
        activeRemito.serverItems.forEach(item => {
            const sku = item.MATE_CODIGO || item.CODIGO || "";
            const name = item.MATE_NOMBRE || item.DERI_NOMBRE_ARTICULO || item.NOMBRE || "";
            const fallback = item.CODIGO || item.MATE_NOMBRE || item.MATE_CODIGO || item.NOMBRE || 'Item';
            const displayName = (sku && name && sku !== name) ? `<b>${sku}</b> - ${name}` : `${fallback}`;
            const qty = Number(item.DERI_CANTIDAD || item.CANTIDAD || 0);

            totalUnits += qty;
            summaryHtml += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:6px 8px;">${displayName}</td>
                    <td style="padding:6px 8px; text-align:right; font-weight:bold;">${qty}</td>
                </tr>`;
        });
    } else {
        summaryHtml += '<tr><td colspan="2" style="padding:10px; text-align:center; color:#999;">Sin items.</td></tr>';
    }

    summaryHtml += `
                <tr style="background:#f8fafc; font-weight:bold;">
                    <td style="padding:6px 8px; text-align:right;">TOTAL UNIDADES</td>
                    <td style="padding:6px 8px; text-align:right;">${totalUnits}</td>
                </tr>
            </tbody>
        </table>
    </div>`;

    const confirmMsg = `
        <div style="text-align:center; margin-bottom:10px;">
            ¿Confirmas cerrar la <b>Jaula ${jaulaNum}</b>?
        </div>
        ${summaryHtml}
        <div style="margin-top:12px; font-size:0.8rem; color:#64748b;">
            Se generará un rótulo provisorio que podrás imprimir.
        </div>
    `;

    if (!await showConfirm("Cerrar y Rotular", confirmMsg)) return;

    showLoading(true);
    try {
        // Read the Remito N° before closing (from local state or yiqi data)
        const remitoNum = activeRemito.remitoExtNum
            || activeRemito.yiqiData?.REIN_NRO_EXTERNO
            || activeRemito.yiqiData?.REIN_NRO_REMITO_EXTERNO
            || activeRemito.yiqiData?.NRO_REMITO_EXTERNO
            || activeRemito.yiqiData?.REMITO_EXTERNO
            || "";

        await YiQi.closeCage(activeRemito.id);
        showLoading(false);

        // Ofrecer impresión de rótulo
        const printNow = await showConfirm(
            "Jaula Cerrada",
            `✅ Jaula <b>${jaulaNum}</b> cerrada correctamente.${remitoNum ? `<br>Remito N° <b>${remitoNum}</b>` : ''}<br><br>¿Deseas imprimir el rótulo para pegar en la jaula?`,
            "🖨️ Imprimir Rótulo",
            "Cerrar"
        );

        if (printNow) {
            printThermalLabel(jaulaNum, activeRemito.serverItems || [], remitoNum, activeRemito.id);
        }

        await fetchActiveRemitos();
        clearActiveRemito();
        fetchStock();

    } catch (e) {
        showLoading(false);
        console.error(e);
        showModal("Error Critico", `No se pudo cerrar la jaula:<br>${e.message}`, "error");
    }
}

// --- QR CODE GENERATOR ---
function generateCageQR(yiqiId, jaulaNum, remitoNum) {
    const qrData = `TMC|JAULA|ID:${yiqiId || '0'}|J:${jaulaNum}|R:${remitoNum || 'S/N'}`;
    try {
        const qr = qrcode(0, 'M'); // Type 0 = auto-detect size, Error correction M (15%)
        qr.addData(qrData);
        qr.make();
        return {
            dataUrl: qr.createDataURL(4, 0), // cellSize=4, margin=0
            rawData: qrData
        };
    } catch (e) {
        console.error('Error generando QR:', e);
        return { dataUrl: null, rawData: qrData };
    }
}

// --- RÓTULO DEFINITIVO (Formato TMC Profesional) ---
function printThermalLabel(jaulaNum, items, remitoNum, yiqiId) {
    const now = new Date();
    const fecha = now.toLocaleDateString('es-AR');

    // GENERAR QR CODE
    const qrResult = generateCageQR(yiqiId || 0, jaulaNum, remitoNum);
    const qrImgHtml = qrResult.dataUrl 
        ? `<img src="${qrResult.dataUrl}" style="width: 22mm; height: 22mm; image-rendering: pixelated;" alt="QR Jaula">`
        : `<div style="width: 22mm; height: 22mm; border: 1px dashed #999; display:flex; align-items:center; justify-content:center; font-size: 6pt; color: #999;">QR N/D</div>`;

    let itemsHtml = (items || []).map(i => `
        <tr>
            <td style="padding: 2px 8px; border-bottom: 1px solid #eee; font-weight: 700;">${i.DERI_CANTIDAD || i.CANTIDAD}</td>
            <td style="padding: 2px 8px; border-bottom: 1px solid #eee;">
                <b>${i.MATE_CODIGO || i.CODIGO || ""}</b> - ${i.MATE_NOMBRE || i.DERI_NOMBRE_ARTICULO || i.NOMBRE || ""}
            </td>
        </tr>
    `).join('');

    const labelHtml = `
        <div class="label-container" style="width: 175mm; height: 115mm; border: 2px solid #000; padding: 5mm; margin: 4mm auto; position: relative; font-family: 'Inter', Arial, sans-serif; overflow: hidden; box-sizing: border-box; background: white; display: flex; flex-direction: column;">
            <!-- Main Header -->
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 3mm;">
                <div style="display: flex; align-items: center; gap: 4mm;">
                    <img src="logo_tmc.png" style="height: 12mm;" onerror="this.style.display='none'">
                    <div style="border-left: 2px solid #000; padding-left: 3mm;">
                        <div style="font-weight: 800; font-size: 14pt; line-height:1.1; letter-spacing: -0.5px;">TALLERES METALÚRGICOS</div>
                        <div style="font-weight: 800; font-size: 16pt; line-height:1.1; color: #000;">CRESPO S.R.L.</div>
                    </div>
                </div>
                <div style="text-align: left; line-height: 1.5; border: 2px solid #000; padding: 1.5mm 4mm; border-radius: 2mm; min-width: 45mm;">
                    <div style="display: flex; justify-content: space-between; font-size: 10pt;">
                        <span style="font-weight: 800; margin-right: 3mm;">FECHA:</span>
                        <span>${fecha}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 10pt;">
                        <span style="font-weight: 800; margin-right: 3mm;">REMITO:</span>
                        <span>${remitoNum || 'S/N'}</span>
                    </div>
                </div>
            </div>

            <!-- Info Bar -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: #000; color: #fff; padding: 2mm 5mm; margin-bottom: 3mm; border-radius: 1mm;">
                <div style="font-size: 11pt; font-weight: 700;">DESTINO: LOZAMETAL</div>
                <div style="font-size: 13pt; font-weight: 800; letter-spacing: 1px;">JAULA N° ${jaulaNum}</div>
            </div>

            <!-- Content Table + QR Side-by-Side -->
            <div style="flex-grow: 1; display: flex; gap: 3mm;">
                <!-- Items Table -->
                <div style="flex: 1; border: 2px solid #000; border-radius: 1mm; overflow: hidden; display: flex; flex-direction: column;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 10pt;">
                        <thead>
                            <tr style="background: #e0e0e0; border-bottom: 2px solid #000;">
                                <th style="padding: 3px 8px; text-align: left; font-weight: 800; width: 15%;">Cant.</th>
                                <th style="padding: 3px 8px; text-align: left; font-weight: 800; width: 85%;">Detalle / Artículo</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml || '<tr><td colspan="2" style="text-align:center; padding: 10mm; font-style: italic;">Sin artículos registrados</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <!-- QR Code Panel -->
                <div style="width: 28mm; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 2px solid #000; border-radius: 1mm; padding: 2mm; background: #fff;">
                    ${qrImgHtml}
                </div>
            </div>

            <div style="margin-top: 3mm; display: flex; justify-content: space-between; align-items: center; font-size: 8pt; border-top: 1px dashed #000; padding-top: 2mm;">
                <div><b>TMC</b> - Control de Producción y Despacho</div>
                <div style="font-weight: 600;">INDUSTRIA ARGENTINA</div>
            </div>
        </div>
    `;

    // Create a temporary hidden iframe for printing
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @page { size: A4 portrait; margin: 0; }
                body { margin: 0; padding: 0; background: #fff; }
                .page { 
                    page-break-after: always; 
                    display: flex; 
                    flex-direction: column; 
                    align-items: center; 
                    justify-content: flex-start;
                    height: 297mm; 
                    padding-top: 10mm;
                    box-sizing: border-box;
                }
            </style>
        </head>
        <body>
            <div class="page">
                ${labelHtml}
                <div style="margin-top: 10mm; border-top: 1px dashed #ccc; width: 80%;"></div>
                ${labelHtml}
            </div>
            <div class="page">
                ${labelHtml}
                <div style="margin-top: 10mm; border-top: 1px dashed #ccc; width: 80%;"></div>
                ${labelHtml}
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(() => { window.frameElement.remove(); }, 1000);
                }
            <\/script>
        </body>
        </html>
    `);
    doc.close();
}

// --- REPRINT: Fetch items from closed cage and print ---
async function reprintCageLabel(cageId) {
    const cage = closedCages.find(c => c.id === cageId);
    if (!cage) {
        await showModal("Error", "No se encontró la jaula.", "error");
        return;
    }

    let jaulaNum = "?";
    if (cage.obs && cage.obs.includes("Jaula N°")) {
        const match = cage.obs.match(/Jaula N°\s*(\d+)/);
        if (match) jaulaNum = match[1];
    }

    // Get Remito N° from the cage data
    const remitoNum = cage.nroRemitoExterno || "";

    showLoading(true, `Cargando contenido de ${cage.obs}...`);

    try {
        const items = await YiQi.getChildItems(cageId);
        showLoading(false);

        if (!items || items.length === 0) {
            await showModal("Sin Contenido", `La jaula <b>${cage.obs}</b> no tiene ítems registrados.`, "warning");
            return;
        }

        printThermalLabel(jaulaNum, items, remitoNum, cageId);
    } catch (e) {
        showLoading(false);
        console.error("Error al reimprimir rótulo:", e);
        await showModal("Error", `No se pudo cargar el contenido:<br>${e.message}`, "error");
    }
}


async function guardarItemsEnYiqi() {
    if (!activeRemito || activeRemitoItems.length === 0) {
        await showModal("Atención", "No hay items para guardar.", "warning");
        return;
    }

    showLoading(true);

    const resolvedItems = [];
    const missingIds = [];

    for (const item of activeRemitoItems) {
        let realId = item.mateId;
        if (!realId) {
            const art = await YiQi.searchArticle(item.sku);
            if (art) {
                realId = art.MATE_ID_MATE || art.id || art.ID || art.MATE_ID;
            } else {
                missingIds.push(item.sku);
            }
        }
        if (realId) {
            resolvedItems.push({ qty: item.qty, sku: item.sku, mateId: realId });
        }
    }

    if (missingIds.length > 0) {
        showLoading(false);
        await showModal("Error de Datos", `No se pudo encontrar el ID para:<br><b>${missingIds.join(', ')}</b>`, "error");
        return;
    }

    const yiQiItems = resolvedItems.map(i => ({
        "CANTIDAD": Number(i.qty),
        "DERI_CANTIDAD": String(i.qty),
        "DERI_NRO_SERIE": "",
        "CODIGO": i.sku,
        "NOMBRE": i.sku,
        "MATE_ID_MATE": i.mateId,
        "CODIGO_EN_EL_PROVEED": null,
        "COD_PROV_2": null,
        "ID_UNIVERSAL": null
    }));

    const success = await YiQi.saveChildInstances(activeRemito.id, yiQiItems);
    showLoading(false);

    if (success) {
        await showModal("Éxito", "Items guardados correctamente.", "success");
        activeRemitoItems = [];
        await fetchRemitoItems(activeRemito.id);
    } else {
        showModal("Error", "Error al guardar. Intenta nuevamente.", "error");
    }
}

function deletePendingItem(index) {
    activeRemitoItems.splice(index, 1);
    renderActiveRemitoItems();
}

async function deleteSavedItem(childId) {
    if (!await showConfirm("Confirmar", "¿Eliminar item de YiQi?")) return;
    showLoading(true);
    const success = await YiQi.deleteItem(childId);
    showLoading(false);
    if (success) {
        await fetchRemitoItems(activeRemito.id);
    } else {
        showModal("Error", "No se pudo eliminar el item.", "error");
    }
}

async function cancelarRemito(e, id) {
    e.stopPropagation();
    if (!await showConfirm("Cancelar", "¿Estás seguro de cancelar este remito completo?")) return;

    showLoading(true);
    await YiQi.executeTransition(id);
    showLoading(false);

    await fetchActiveRemitos();
    renderRemitos();
    if (activeRemito && activeRemito.id === id) {
        clearActiveRemito();
    }
}


// --- ALTA PRODUCCION ---

async function fetchGroupsAndArticles() {
    try {
        // User confirmed Group ID = 93
        enlozadasGroupId = 93;
        console.log(`🎯 Using Group ID: ${enlozadasGroupId} for "Bandejas Enlozadas"`);

        const allArticles = await YiQi.fetch(YIQI_CONFIG.smartieArticulos, YIQI_CONFIG.entityArticulos);
        if (allArticles) {
            enlozadasArticles = allArticles.filter(a => {
                const isGroup = String(a.MATE_GRUPO_IDEN || a.GRMA_ID) === String(enlozadasGroupId);
                const cole = String(a.COLE_DESCRIPCION || a.COLE_NOMBRE || a.Coleccion || "").toUpperCase().trim();
                return isGroup && cole === "SEMI ELABORADO";
            });

            if (enlozadasArticles.length === 0) {
                console.warn("⚠️ Filtro SEMI ELABORADO no devolvió resultados. Cargando todo el Grupo 93.");
                enlozadasArticles = allArticles.filter(a => String(a.MATE_GRUPO_IDEN || a.GRMA_ID) === String(enlozadasGroupId));
            }
            
            // Los artículos quedan cargados en enlozadasArticles para el Selector Premium
            console.log(`📦 Loaded ${enlozadasArticles.length} Articles for Alta (Group ${enlozadasGroupId})`);
        }
    } catch (e) {
        console.error("Error fetching Alta metadata:", e);
    }
}

// ========================================
// PREMIUM SKU SELECTOR (Mobile Optimized)
// ========================================
function openSkuSelector() {
    const overlay = document.getElementById('sku-selector-overlay');
    const searchInput = document.getElementById('sku-selector-search');
    if (overlay) {
        overlay.classList.add('active');
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => searchInput.focus(), 300);
        }
        renderSkuSelectorList();
    }
}

function closeSkuSelector() {
    const overlay = document.getElementById('sku-selector-overlay');
    if (overlay) overlay.classList.remove('active');
}

function filterSkuSelector() {
    renderSkuSelectorList();
}

function renderSkuSelectorList() {
    const list = document.getElementById('sku-selector-list');
    const query = (document.getElementById('sku-selector-search')?.value || "").toLowerCase().trim();
    if (!list) return;

    let filtered = enlozadasArticles;
    if (query.length > 0) {
        filtered = enlozadasArticles.filter(a => {
            const code = (a.CODIGO || a.MATE_CODIGO || "").toLowerCase();
            const name = (a.NOMBRE || a.MATE_NOMBRE || "").toLowerCase();
            return code.includes(query) || name.includes(query);
        });
    }

    // Sort by SKU
    filtered.sort((a,b) => (a.CODIGO || a.MATE_CODIGO || "").localeCompare(b.CODIGO || b.MATE_CODIGO || ""));

    list.innerHTML = filtered.map(a => {
        const id = a.ID || a.MATE_ID_MATE;
        const code = a.CODIGO || a.MATE_CODIGO || "S/C";
        const name = a.NOMBRE || a.MATE_NOMBRE || "Sin Nombre";
        return `
            <div class="sku-item-card" onclick="selectSkuItem('${id}', '${code}', '${name.replace(/'/g, "\\'")}')">
                <b>${code}</b>
                <span>${name}</span>
            </div>
        `;
    }).join('');
}

function selectSkuItem(id, code, name) {
    document.getElementById('alta-mate-id').value = id;
    document.getElementById('selected-sku-text').innerText = `${code} - ${name}`;
    document.getElementById('sku-selector-trigger').style.borderColor = "var(--primary-color)";
    closeSkuSelector();
}



async function registrarProduccion() {
    const mateId = document.getElementById('alta-mate-id').value;
    const skuText = document.getElementById('selected-sku-text').innerText;
    const sku = skuText.split(' - ')[0];
    const qty = document.getElementById('alta-qty').value;
    const obs = document.getElementById('alta-obs').value || "";

    if (!mateId || mateId === "" || !qty || qty <= 0) {
        await showModal("Datos Incompletos", "Por favor selecciona un artículo y especifica una cantidad válida.", "warning");
        return;
    }

    if (!enlozadasGroupId) {
        await showModal("Error de Configuración", "No se encontró el ID del grupo. Reinicie la app.", "error");
        return;
    }

    showLoading(true);
    updateStatus("Registrando producción...");

    const token = await YiQi.getToken();
    if (!token) { showLoading(false); return; }

    try {
        updateStatus("Sincronizando estado previo...");
        const initialRemitos = await YiQi.fetch(2698, 787);
        const existingIds = (initialRemitos || []).map(r => String(r.ID || r.id));

        // Mapeo: 12369=Grupo, 12370=Articulo, 12371=Cantidad, 12372=Obs
        const formStr = `12369=${enlozadasGroupId}&12370=${mateId}&12371=${qty}&12372=${encodeURIComponent(obs)}`;
        console.log("🚀 Payload Form:", formStr);

        const payload = {
            schemaId: YIQI_CONFIG.schemaId,
            entityId: String(YIQI_CONFIG.entityAlta),
            form: formStr,
            uploads: "",
            parentId: null,
            childId: null
        };

        let newId = null;
        for (const url of YIQI_CONFIG.saveUrls) {
            const r = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }, body: JSON.stringify(payload)
            });
            const res = await r.json();
            if (res.ok || res.success || res.newId) {
                newId = res.newId;
                break;
            }
        }

        if (newId) {
            recentAltas.unshift({ sku, qty, time: new Date().toLocaleTimeString(), id: newId });
            renderRecentAltas();

            // Limpiar formulario
            document.getElementById('alta-mate-id').value = "";
            document.getElementById('selected-sku-text').innerText = "Seleccione artículo...";
            document.getElementById('sku-selector-trigger').style.borderColor = "#cbd5e1";
            document.getElementById('alta-qty').value = "";
            document.getElementById('alta-obs').value = "";

            // PROCESAMIENTO AUTOMATICO del remito de compra
            let matchingRemitoId = null;
            for (let intento = 1; intento <= 7; intento++) {
                const overlayMsg = document.querySelector('#loading-overlay p');
                if (overlayMsg) overlayMsg.innerText = `Cazando remito proyectado (Intento ${intento} de 7)...`;
                
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const currentRemitos = await YiQi.fetch(2698, 787);
                if (currentRemitos) {
                    const matching = currentRemitos.find(r => {
                        const rid = String(r.ID || r.id);
                        if (existingIds.includes(rid)) return false;
                        const rQty = Number(r.REMI_UNIDADES_TOTALES || r.CANTIDAD || r.STOC_CANTIDAD || r.CANTI || 0);
                        const rMateId = String(r.MATE_ID || r.MATE_ID_MATE || r.RECO_MATE_ID || r.ARTICULO_ID || r.PRODUCTO_ID || "");
                        const qtyMatch = rQty === Number(qty);
                        const mateMatch = !rMateId || rMateId === "" || rMateId === String(mateId);
                        return qtyMatch && mateMatch;
                    });

                    if (matching) {
                        matchingRemitoId = String(matching.ID || matching.id);
                        console.log("🎯 Remito CAZADO:", matchingRemitoId);
                        break;
                    }
                }
            }

            if (matchingRemitoId) {
                updateStatus("Procesando remito cazado...");
                const tPayload = {
                    schemaId: YIQI_CONFIG.schemaId,
                    ids: [matchingRemitoId],
                    transitionId: 119014,
                    form: ""
                };

                const tResponse = await fetch(YIQI_CONFIG.executeTransitionUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                    body: JSON.stringify(tPayload)
                });

                if (tResponse.ok) {
                    console.log("✅ Remito de compra procesado automáticamente!");
                }
            }

            showLoading(false);
            await showModal("Éxito", `Producción registrada (Alta #${newId}).${matchingRemitoId ? ' El stock fue ingresado automáticamente.' : ' El servidor demora; quedará en pendientes.'}`, "success");

            startIntelligentSyncPulse();
        } else {
            throw new Error("No se pudo completar el registro en YiQi.");
        }
    } catch (e) {
        showLoading(false);
        console.error(e);
        await showModal("Error", `Fallo al registrar: ${e.message}`, "error");
    }
}

async function fetchAltasRecientes() {
    const btnRefresh = document.querySelector('button[onclick="fetchAltasRecientes()"]');
    if (btnRefresh) btnRefresh.classList.add('spin');

    try {
        const data = await YiQi.fetch(YIQI_CONFIG.smartieAltas, YIQI_CONFIG.entityAlta);
        if (data) {
            recentAltas = data.slice(0, 20).map(r => ({
                fechaHora: r.AUDI_FECHA_ALTA || r.AUDI_FECHA_INSERCION || "",
                sku: r.MATE_CODIGO || "-",
                name: r.MATE_NOMBRE || "-",
                qty: Number(r.ALDP_CANTIDAD || 0),
                obs: r.ALDP_OBSERVACIONES || ""
            }));
        }
        renderRecentAltas();
    } catch (e) {
        console.error("Error trayendo altas recientes:", e);
    } finally {
        if (btnRefresh) btnRefresh.classList.remove('spin');
    }
}

function renderRecentAltas() {
    const list = document.getElementById('alta-recent-list');
    if (recentAltas.length === 0) {
        list.innerHTML = '<p class="text-muted text-center italic">Sin registros</p>';
        return;
    }

    list.innerHTML = recentAltas.map(a => {
        let timeStr = "";
        if (a.fechaHora) {
            const parts = a.fechaHora.split('T');
            if (parts.length === 2) {
                const f = parts[0].split('-').reverse().join('/');
                const t = parts[1].substring(0, 5);
                timeStr = `${f} ${t}`;
            } else {
                timeStr = a.fechaHora;
            }
        }

        return `
        <div style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <span><b style="color:var(--primary-color);">${a.qty}</b> x ${a.sku}</span>
                <span class="text-muted" style="font-size: 0.7rem; white-space: nowrap; margin-left: 5px;">${timeStr}</span>
            </div>
            <div style="color: #475569; font-size: 0.75rem;">${a.name}</div>
            ${a.obs ? `<div style="color: #94a3b8; font-size: 0.7rem; font-style: italic; margin-top: 2px;">💬 ${a.obs}</div>` : ''}
        </div>`;
    }).join('');
}

async function fetchAltasPendientes() {
    const btnRefresh = document.querySelector('button[onclick="fetchAltasPendientes()"]');
    if (btnRefresh) btnRefresh.classList.add('spin');

    try {
        const data = await YiQi.fetch(YIQI_CONFIG.smartieAltasPendientes, YIQI_CONFIG.entityAlta);
        if (data) {
            pendientesAltas = data.map(r => ({
                id: r.ALDP_ID || r.ID || r.id,
                fechaHora: r.AUDI_FECHA_ALTA || r.AUDI_FECHA_INSERCION || "",
                sku: r.MATE_CODIGO || articlesIdMap[r.MATE_ID || r.ALDP_MATE_ID || r.MATE_ID_MATE] || "-",
                name: r.MATE_NOMBRE || "-",
                qty: Number(r.ALDP_CANTIDAD || 0),
                obs: r.ALDP_OBSERVACIONES || ""
            }));
        }
        renderAltasPendientes();
    } catch (e) {
        console.error("Error trayendo altas pendientes:", e);
    } finally {
        if (btnRefresh) btnRefresh.classList.remove('spin');
    }
}

function renderAltasPendientes() {
    const list = document.getElementById('alta-pendientes-list');
    if (!list) return; // Element not in DOM (mobile tab layout)
    if (pendientesAltas.length === 0) {
        list.innerHTML = '<p class="text-muted text-center italic">Sin pendientes</p>';
        return;
    }

    list.innerHTML = pendientesAltas.map(a => {
        let timeStr = "";
        if (a.fechaHora) {
            const parts = a.fechaHora.split('T');
            if (parts.length === 2) {
                const f = parts[0].split('-').reverse().join('/');
                const t = parts[1].substring(0, 5);
                timeStr = `${f} ${t}`;
            } else {
                timeStr = a.fechaHora;
            }
        }

        return `
        <div style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 0.85rem; background: #fffbeb;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <span><b style="color:#d97706;">${a.qty}</b> x ${a.sku}</span>
                <span class="badge bg-orange" style="font-size: 0.65rem; padding: 1px 4px;">Pendiente</span>
            </div>
            <div style="color: #475569; font-size: 0.75rem;">${a.name}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                ${a.obs ? `<div style="color: #94a3b8; font-size: 0.7rem; font-style: italic;">💬 ${a.obs}</div>` : '<div></div>'}
                <span class="text-muted" style="font-size: 0.65rem;">${timeStr}</span>
            </div>
        </div>`;
    }).join('');
}

async function procesarAltasPendientes() {
    if (pendientesAltas.length === 0) return;

    if (!await showConfirm("Procesar Pendientes", "¿Deseas intentar procesar manualmente los remitos de compra para ingresar el stock?")) return;

    showLoading(true, "Buscando remitos pendientes en YiQi...");
    updateStatus("Consultando remitos de compra proyectados...");

    try {
        const token = await YiQi.getToken();
        if (!token) { showLoading(false); return; }

        const remitosCompraPendientes = await YiQi.fetch(2698, 787);

        if (!remitosCompraPendientes || remitosCompraPendientes.length === 0) {
            showLoading(false);
            showModal("Sin Pendientes", "No se encontraron remitos de compra pendientes.", "info");
            return;
        }

        const idsStr = remitosCompraPendientes.map(r => String(r.ID || r.id));
        updateStatus(`Procesando ${idsStr.length} remito(s)...`);

        const tPayload = {
            schemaId: YIQI_CONFIG.schemaId,
            ids: idsStr,
            transitionId: 119014,
            form: ""
        };

        const res = await fetch(YIQI_CONFIG.executeTransitionUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify(tPayload)
        });

        const data = await res.json();

        if (data.ok !== false) {
            showModal("Éxito", "Los remitos fueron procesados correctamente.", "success");
            await Promise.all([
                fetchAltasPendientes(),
                fetchAltasRecientes(),
                fetchStock()
            ]);
        } else {
            showModal("Error", `YiQi retornó un error: ${data.error || 'Error desconocido'}`, "error");
        }
    } catch (e) {
        console.error("Error en procesamiento manual:", e);
        showModal("Error Crítico", "Falló la comunicación con el servidor.", "error");
    } finally {
        showLoading(false);
    }
}


// --- UTILITIES ---

function updateStatus(msg) {
    const el = document.getElementById('status-indicator');
    if (el) el.title = msg;
    
    const overlay = document.getElementById('loading-overlay');
    if (overlay && overlay.classList.contains('active')) {
        const p = overlay.querySelector('p');
        if (p) p.innerHTML = `<span style="font-size:1.1rem;">${msg}</span>
                              <div style="width:100%; height:4px; border-radius:2px; background:#e2e8f0; margin-top:10px; overflow:hidden;">
                                  <div style="width:100%; height:100%; background:var(--primary-color); animation: indeterminateProgress 1.5s infinite linear;"></div>
                              </div>`;
    }

    console.log("STATUS:", msg);
}

function showLoading(show, defaultMessage = "Procesando...") {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        if (show) {
            overlay.classList.add('active');
            const p = overlay.querySelector('p');
            if (p) p.innerText = defaultMessage;
        } else {
            overlay.classList.remove('active');
        }
    }
}

// Initial Load
document.addEventListener('DOMContentLoaded', init);
