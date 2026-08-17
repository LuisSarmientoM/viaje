import { escapeHTML, isValidState } from "./state-validation.js";

const STORAGE_NAME = "europa-together-planner-v1";
const DIRTY_STORAGE_NAME = "europa-together-planner-dirty";
const DEFAULT_STATE = {
    trip: {
        name: "Un viaje por Europa",
        startDate: "",
        endDate: "",
        currency: "EUR",
        budget: 0,
        travelers: ["Luis", "Aura"],
    },
    destinations: [],
    itinerary: [],
    expenses: [],
    reservations: [],
    tasks: [],
};
let state = loadState();
let toastTimer;
let remoteSaveTimer;
let remoteVersion = 0;
let stateRevision = 0;
let lastSyncedVersion = Number(
    localStorage.getItem("europa-together-planner-version") || 0,
);
const sessionState = {
    canPersist: false,
    syncing: false,
    dirty: localStorage.getItem(DIRTY_STORAGE_NAME) === "1",
};

function clone(value) {
    return structuredClone(value);
}
function renderHTML(node, markup) {
    const parsed = new DOMParser().parseFromString(String(markup), "text/html");
    const urlAttributes = new Set([
        "action",
        "archive",
        "background",
        "cite",
        "classid",
        "codebase",
        "data",
        "formaction",
        "href",
        "icon",
        "longdesc",
        "manifest",
        "ping",
        "poster",
        "profile",
        "src",
        "srcset",
        "usemap",
        "xlink:href",
    ]);
    const safeStyles = new Set([
        "display",
        "font-size",
        "margin",
        "margin-top",
        "width",
    ]);
    const safeStyleValue =
        /^(?:block|inline|inline-block|none|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?(?:\s+-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?){0,3})$/;

    parsed
        .querySelectorAll(
            "script, iframe, frame, frameset, object, embed, applet, link, style, base, meta, template, svg, math",
        )
        .forEach(function (element) {
            element.remove();
        });
    parsed.querySelectorAll("*").forEach(function (element) {
        Array.from(element.attributes).forEach(function (attribute) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith("on") || urlAttributes.has(name))
                element.removeAttribute(attribute.name);
        });
        if (!element.hasAttribute("style")) return;
        Array.from(element.style).forEach(function (property) {
            if (
                !safeStyles.has(property) ||
                !safeStyleValue.test(
                    element.style.getPropertyValue(property).trim(),
                )
            )
                element.style.removeProperty(property);
        });
        if (!element.style.length) element.removeAttribute("style");
    });
    node.replaceChildren(...parsed.body.childNodes);
}
function uid(prefix) {
    return (
        prefix +
        "-" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 7)
    );
}
function normalizeState(stored) {
    if (!stored) return clone(DEFAULT_STATE);
    return {
        ...clone(DEFAULT_STATE),
        ...stored,
        trip: { ...clone(DEFAULT_STATE.trip), ...(stored.trip || {}) },
        destinations: Array.isArray(stored.destinations)
            ? stored.destinations
            : [],
        itinerary: Array.isArray(stored.itinerary) ? stored.itinerary : [],
        expenses: Array.isArray(stored.expenses) ? stored.expenses : [],
        reservations: Array.isArray(stored.reservations)
            ? stored.reservations
            : [],
        tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
    };
}
function loadState() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_NAME));
        return isValidState(stored)
            ? normalizeState(stored)
            : clone(DEFAULT_STATE);
    } catch (error) {
        return clone(DEFAULT_STATE);
    }
}
function saveLocalState() {
    localStorage.setItem(STORAGE_NAME, JSON.stringify(state));
}
function saveState() {
    stateRevision += 1;
    sessionState.dirty = true;
    localStorage.setItem(DIRTY_STORAGE_NAME, "1");
    saveLocalState();
    if (sessionState.canPersist) queueRemoteSave();
}
function hasMeaningfulData(value) {
    const trip = value.trip || {};
    return (
        value.destinations.length ||
        value.itinerary.length ||
        value.expenses.length ||
        value.reservations.length ||
        value.tasks.length ||
        trip.startDate ||
        trip.endDate ||
        Number(trip.budget || 0) > 0 ||
        (trip.name && trip.name !== DEFAULT_STATE.trip.name) ||
        trip.currency !== DEFAULT_STATE.trip.currency ||
        JSON.stringify(trip.travelers) !==
            JSON.stringify(DEFAULT_STATE.trip.travelers)
    );
}
function setSyncStatus(message, stateName) {
    const node = document.querySelector("#sync-status");
    node.textContent = message;
    node.dataset.state = stateName || "local";
}
async function activateWithInvite() {
    const invite = window.prompt("Introduce el token privado de invitación:");
    if (!invite) return;
    setSyncStatus("Activando…", "syncing");
    try {
        const response = await fetch("/api/session", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invite: invite.trim() }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.bootstrap)
            throw new Error(payload.error || "No se pudo activar");
        history.replaceState(
            {},
            document.title,
            location.pathname + location.hash,
        );
        location.reload();
    } catch (error) {
        setSyncStatus("Solo este navegador", "error");
        showToast(error.message || "No se pudo activar el respaldo");
    }
}
function queueRemoteSave() {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(function () {
        syncRemoteState();
    }, 500);
}
function detachRemotePersistence() {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = undefined;
    sessionState.canPersist = false;
    remoteVersion = 0;
    lastSyncedVersion = 0;
    localStorage.removeItem("europa-together-planner-version");
    renderHeader();
}
async function syncRemoteState() {
    if (!sessionState.canPersist || sessionState.syncing || !sessionState.dirty)
        return;
    const snapshot = clone(state);
    const snapshotRevision = stateRevision;
    let continueSaving = false;
    sessionState.syncing = true;
    setSyncStatus("Sincronizando…", "syncing");
    try {
        const response = await fetch("/api/trip", {
            method: "PUT",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                state: snapshot,
                expectedVersion: remoteVersion,
            }),
        });
        const payload = await response.json();
        if (!sessionState.canPersist) return;
        if (response.status === 409 && payload.state) {
            if (!isValidState(payload.state))
                throw new Error("El respaldo remoto no es válido");
            const useRemote =
                stateRevision === snapshotRevision &&
                confirm(
                    "El viaje compartido cambió y también hay cambios en este navegador. Aceptar reemplaza los datos locales con el viaje compartido; cancelar conserva los datos locales sin sincronizarlos.",
                );
            if (useRemote) {
                remoteVersion = Number(payload.version || 0);
                state = normalizeState(payload.state);
                sessionState.dirty = false;
                localStorage.removeItem(DIRTY_STORAGE_NAME);
                lastSyncedVersion = remoteVersion;
                localStorage.setItem(
                    "europa-together-planner-version",
                    String(remoteVersion),
                );
                saveLocalState();
                render();
                showToast("Se aplicaron los cambios del otro dispositivo.");
                setSyncStatus("Sincronizado", "remote");
            } else {
                detachRemotePersistence();
                setSyncStatus("Conflicto: cambios solo locales", "error");
                showToast(
                    "El viaje compartido cambió. Tus cambios siguen guardados solo en este navegador.",
                );
            }
            return;
        }
        if (!response.ok)
            throw new Error(payload.error || "No se pudo guardar");
        remoteVersion = Number(payload.version || remoteVersion);
        if (stateRevision === snapshotRevision) {
            sessionState.dirty = false;
            localStorage.removeItem(DIRTY_STORAGE_NAME);
            lastSyncedVersion = remoteVersion;
            localStorage.setItem(
                "europa-together-planner-version",
                String(remoteVersion),
            );
            setSyncStatus("Sincronizado", "remote");
        } else {
            continueSaving = sessionState.dirty;
        }
    } catch (error) {
        setSyncStatus("Cambios pendientes", "error");
    } finally {
        sessionState.syncing = false;
        if (continueSaving) queueRemoteSave();
    }
}
async function bootstrapRemoteState() {
    setSyncStatus("Comprobando respaldo…", "syncing");
    try {
        const params = new URLSearchParams(location.search);
        const invite = params.get("invite");
        const endpoint = invite
            ? "/api/session?invite=" + encodeURIComponent(invite)
            : "/api/session";
        const sessionResponse = await fetch(endpoint, {
            credentials: "same-origin",
            cache: "no-store",
        });
        const session = await sessionResponse.json();
        if (!sessionResponse.ok) {
            setSyncStatus("Solo este navegador", "error");
            return;
        }
        if (session.bootstrap) {
            history.replaceState(
                {},
                document.title,
                location.pathname + location.hash,
            );
            location.reload();
            return;
        }
        sessionState.canPersist = Boolean(session.canPersist);
        renderHeader();
        if (!sessionState.canPersist) {
            setSyncStatus("Solo este navegador", "local");
            return;
        }
        const tripResponse = await fetch("/api/trip", {
            credentials: "same-origin",
            cache: "no-store",
        });
        const remote = await tripResponse.json();
        if (!tripResponse.ok)
            throw new Error(remote.error || "No se pudo leer el viaje");
        remoteVersion = Number(remote.version || 0);
        if (remote.state && !isValidState(remote.state))
            throw new Error("El respaldo remoto no es válido");
        if (sessionState.dirty && remoteVersion === lastSyncedVersion) {
            await syncRemoteState();
            return;
        }
        let useRemote = false;
        if (
            remote.state &&
            ((sessionState.dirty &&
                (lastSyncedVersion === 0 ||
                    remoteVersion !== lastSyncedVersion)) ||
                (!sessionState.dirty &&
                    hasMeaningfulData(state) &&
                    lastSyncedVersion === 0))
        ) {
            useRemote = confirm(
                "Ya existe un viaje compartido y también hay datos en este navegador. Aceptar reemplaza los datos locales con el viaje compartido; cancelar conserva los datos locales sin sincronizarlos.",
            );
            if (!useRemote) {
                detachRemotePersistence();
                setSyncStatus("Conflicto: cambios solo locales", "error");
                return;
            }
        }
        if (
            remote.state &&
            (useRemote ||
                !hasMeaningfulData(state) ||
                lastSyncedVersion === 0 ||
                remoteVersion > lastSyncedVersion)
        ) {
            state = normalizeState(remote.state);
            sessionState.dirty = false;
            localStorage.removeItem(DIRTY_STORAGE_NAME);
            lastSyncedVersion = remoteVersion;
            localStorage.setItem(
                "europa-together-planner-version",
                String(remoteVersion),
            );
            saveLocalState();
            render();
            setSyncStatus("Sincronizado", "remote");
        } else if (!remote.state && hasMeaningfulData(state)) {
            sessionState.dirty = true;
            localStorage.setItem(DIRTY_STORAGE_NAME, "1");
            await syncRemoteState();
        } else {
            setSyncStatus("Sincronizado", "remote");
        }
    } catch (error) {
        sessionState.canPersist = false;
        setSyncStatus("Solo este navegador", "error");
    }
}
function formatMoney(value) {
    const amount = Number(value || 0);
    try {
        return new Intl.NumberFormat("es-CO", {
            style: "currency",
            currency: state.trip.currency || "EUR",
            maximumFractionDigits: 0,
        }).format(amount);
    } catch (error) {
        return (state.trip.currency || "EUR") + " " + Math.round(amount);
    }
}
function formatDate(value, options) {
    if (!value) return "Sin fecha";
    const date = new Date(value + "T12:00:00");
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(
        "es-CO",
        options || { day: "numeric", month: "short", year: "numeric" },
    ).format(date);
}
function dateLabel(value) {
    return formatDate(value, {
        weekday: "short",
        day: "numeric",
        month: "short",
    });
}
function daysBetween(start, end) {
    if (!start || !end) return "—";
    const diff =
        Math.round(
            (new Date(end + "T12:00:00") - new Date(start + "T12:00:00")) /
                86400000,
        ) + 1;
    return diff > 0 ? diff + (diff === 1 ? " día" : " días") : "—";
}
function showToast(message) {
    const node = document.querySelector("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        node.classList.remove("show");
    }, 2400);
}
function getDestinationName(id) {
    const destination = state.destinations.find(function (item) {
        return item.id === id;
    });
    return destination ? destination.name : "";
}
function emptyState(title, copy, action, label) {
    return (
        '<div class="empty"><strong>' +
        title +
        "</strong><span>" +
        copy +
        "</span>" +
        (action
            ? '<div style="margin-top:13px"><button class="text-button" type="button" data-action="' +
              action +
              '">' +
              label +
              "</button></div>"
            : "") +
        "</div>"
    );
}

function render() {
    renderHeader();
    renderOverview();
    renderItinerary();
    renderExpenses();
    renderReservations();
    renderTasks();
}
function renderHeader() {
    const trip = state.trip;
    document.querySelector("#trip-title").textContent =
        trip.name || "Un viaje por Europa";
    const dateCopy =
        trip.startDate && trip.endDate
            ? formatDate(trip.startDate) + " → " + formatDate(trip.endDate)
            : "Aún no han definido las fechas";
    const travelers = (trip.travelers || []).filter(Boolean).join(" y ");
    document.querySelector("#trip-copy").textContent =
        dateCopy +
        (travelers ? " · " + travelers : "") +
        (sessionState.canPersist
            ? ". El respaldo compartido está activo."
            : ". Los cambios se guardan localmente hasta activar el respaldo compartido.");
    document.querySelector("#budget-currency").textContent =
        trip.currency || "EUR";
    document.querySelector("#budget-total").textContent = formatMoney(
        trip.budget,
    );
    const spent = totalExpenses();
    const budget = Number(trip.budget || 0);
    document.querySelector("#budget-progress").style.width =
        (budget ? Math.min(100, (spent / budget) * 100) : 0) + "%";
    document.querySelector("#budget-spent").textContent =
        formatMoney(spent) + " gastados";
    document.querySelector("#budget-remaining").textContent =
        formatMoney(Math.max(0, budget - spent)) + " disponibles";
}
function totalExpenses() {
    return state.expenses.reduce(function (sum, item) {
        return sum + Number(item.amount || 0);
    }, 0);
}
function renderOverview() {
    document.querySelector("#stat-days").textContent = daysBetween(
        state.trip.startDate,
        state.trip.endDate,
    );
    document.querySelector("#stat-destinations").textContent =
        state.destinations.length;
    document.querySelector("#stat-spent").textContent = formatMoney(
        totalExpenses(),
    );
    document.querySelector("#stat-tasks").textContent = state.tasks.filter(
        function (item) {
            return !item.done;
        },
    ).length;

    const destinations = document.querySelector("#destinations-list");
    renderHTML(
        destinations,
        state.destinations.length
            ? state.destinations
                  .map(function (item) {
                      const dates =
                          item.from || item.to
                              ? formatDate(item.from, {
                                    day: "numeric",
                                    month: "short",
                                }) +
                                (item.to
                                    ? " → " +
                                      formatDate(item.to, {
                                          day: "numeric",
                                          month: "short",
                                      })
                                    : "")
                              : "Sin fechas";
                      return (
                          '<article class="destination"><div class="destination-actions"><button class="small-icon" type="button" data-action="edit-destination" data-id="' +
                          escapeHTML(item.id) +
                          '" aria-label="Editar destino">✎</button><button class="small-icon" type="button" data-action="delete-destination" data-id="' +
                          escapeHTML(item.id) +
                          '" aria-label="Eliminar destino">×</button></div><div class="destination-name">' +
                          escapeHTML(item.name) +
                          '</div><div class="destination-meta">' +
                          escapeHTML(item.country || "") +
                          (item.country ? " · " : "") +
                          escapeHTML(dates) +
                          "</div></article>"
                      );
                  })
                  .join("")
            : emptyState(
                  "Todavía no hay destinos",
                  "Añadan las ciudades de la ruta para empezar.",
                  "add-destination",
                  "+ Añadir primer destino",
              ),
    );

    const upcoming = state.itinerary
        .slice()
        .sort(function (a, b) {
            return (
                (a.date || "9999").localeCompare(b.date || "9999") ||
                (a.time || "").localeCompare(b.time || "")
            );
        })
        .slice(0, 4);
    renderHTML(
        document.querySelector("#next-list"),
        upcoming.length
            ? upcoming
                  .map(function (item) {
                      return (
                          '<div class="next-item"><div><div class="item-title">' +
                          escapeHTML(item.title) +
                          '</div><div class="item-meta">' +
                          escapeHTML(
                              item.date ? dateLabel(item.date) : "Sin fecha",
                          ) +
                          (item.time ? " · " + escapeHTML(item.time) : "") +
                          (getDestinationName(item.destinationId)
                              ? " · " +
                                escapeHTML(
                                    getDestinationName(item.destinationId),
                                )
                              : "") +
                          '</div></div><span class="pill">' +
                          escapeHTML(item.category || "Plan") +
                          "</span></div>"
                      );
                  })
                  .join("")
            : emptyState(
                  "El itinerario está vacío",
                  "Pueden añadir una actividad por día o dejar espacio para improvisar.",
                  "add-activity",
                  "+ Añadir actividad",
              ),
    );

    const tasks = state.tasks
        .filter(function (item) {
            return !item.done;
        })
        .slice(0, 4);
    renderHTML(
        document.querySelector("#quick-tasks"),
        tasks.length
            ? tasks.map(taskHTML).join("")
            : emptyState(
                  "No hay pendientes urgentes",
                  "Todo lo que añadan aquí aparecerá también en la pestaña Pendientes.",
                  "add-task",
                  "+ Añadir pendiente",
              ),
    );
    renderBalance();
}
function renderBalance() {
    const names = (state.trip.travelers || []).filter(Boolean);
    const people = names.length ? names : ["Luis", "Aura"];
    const total = totalExpenses();
    const each = people.length ? total / people.length : 0;
    const paid = people.map(function (name) {
        return {
            name: name,
            value: state.expenses
                .filter(function (item) {
                    return item.paidBy === name;
                })
                .reduce(function (sum, item) {
                    return sum + Number(item.amount || 0);
                }, 0),
        };
    });
    const max = Math.max(
        each,
        ...paid.map(function (item) {
            return item.value;
        }),
        1,
    );
    renderHTML(
        document.querySelector("#balance-list"),
        total
            ? paid
                  .map(function (item) {
                      const difference = item.value - each;
                      return (
                          '<div class="balance-row"><span>' +
                          escapeHTML(item.name) +
                          '</span><div class="balance-track"><i style="width:' +
                          Math.min(100, (item.value / max) * 100) +
                          '%"></i></div><strong>' +
                          escapeHTML(formatMoney(item.value)) +
                          '</strong></div><div class="item-meta" style="margin:-5px 0 4px 84px">' +
                          (difference >= 0
                              ? "Ha puesto " +
                                escapeHTML(formatMoney(difference)) +
                                " de más"
                              : "Le faltan " +
                                escapeHTML(formatMoney(Math.abs(difference)))) +
                          "</div>"
                      );
                  })
                  .join("")
            : '<p class="muted" style="margin:0;font-size:.88rem">Cuando registren gastos, aquí verán cuánto ha puesto cada uno.</p>',
    );
}
function renderItinerary() {
    renderHTML(
        document.querySelector("#itinerary-destinations"),
        state.destinations.length
            ? state.destinations
                  .map(function (item) {
                      return (
                          '<span class="pill">' +
                          escapeHTML(item.name) +
                          "</span>"
                      );
                  })
                  .join("")
            : '<span class="muted" style="font-size:.85rem">Añadan destinos para tenerlos a mano.</span>',
    );
    const list = document.querySelector("#itinerary-list");
    const sorted = state.itinerary.slice().sort(function (a, b) {
        return (
            (a.date || "9999").localeCompare(b.date || "9999") ||
            (a.time || "").localeCompare(b.time || "")
        );
    });
    if (!sorted.length) {
        renderHTML(
            list,
            emptyState(
                "Aún no hay actividades",
                "Construyan el viaje poco a poco: una reserva, una caminata o un restaurante.",
                "add-activity",
                "+ Añadir actividad",
            ),
        );
        return;
    }
    const groups = [];
    sorted.forEach(function (item) {
        const key = item.date || "sin-fecha";
        let group = groups.find(function (entry) {
            return entry.key === key;
        });
        if (!group) {
            group = { key: key, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    });
    renderHTML(
        list,
        groups
            .map(function (group) {
                const date =
                    group.key === "sin-fecha"
                        ? "Sin fecha"
                        : formatDate(group.key, {
                              day: "numeric",
                              month: "short",
                          });
                const day =
                    group.key === "sin-fecha"
                        ? "—"
                        : new Date(group.key + "T12:00:00").getDate();
                return (
                    '<div class="day-group"><div class="day-label">' +
                    escapeHTML(date.split(" ")[0]) +
                    "<strong>" +
                    escapeHTML(day) +
                    '</strong></div><div class="day-events">' +
                    group.items.map(eventHTML).join("") +
                    "</div></div>"
                );
            })
            .join(""),
    );
}
function eventHTML(item) {
    return (
        '<article class="event"><div class="event-top"><div><h3>' +
        escapeHTML(item.title) +
        '</h3><div class="item-meta">' +
        (item.time ? escapeHTML(item.time) + " · " : "") +
        (item.location ? escapeHTML(item.location) : "Ubicación por definir") +
        (getDestinationName(item.destinationId)
            ? " · " + escapeHTML(getDestinationName(item.destinationId))
            : "") +
        '</div></div><div class="event-actions"><button class="small-icon" type="button" data-action="edit-activity" data-id="' +
        escapeHTML(item.id) +
        '" aria-label="Editar actividad">✎</button><button class="small-icon" type="button" data-action="delete-activity" data-id="' +
        escapeHTML(item.id) +
        '" aria-label="Eliminar actividad">×</button></div></div>' +
        (item.notes ? "<p>" + escapeHTML(item.notes) + "</p>" : "") +
        "</article>"
    );
}
function renderExpenses() {
    const node = document.querySelector("#expenses-table");
    if (!state.expenses.length) {
        renderHTML(
            node,
            emptyState(
                "Todavía no hay gastos",
                "Registrar los primeros gastos les dará una visión real del presupuesto.",
                "add-expense",
                "+ Registrar primer gasto",
            ),
        );
        return;
    }
    const rows = state.expenses
        .slice()
        .sort(function (a, b) {
            return (b.date || "").localeCompare(a.date || "");
        })
        .map(function (item) {
            return (
                "<tr><td><strong>" +
                escapeHTML(item.description) +
                '</strong><div class="item-meta">' +
                escapeHTML(item.category || "General") +
                "</div></td><td>" +
                (item.date
                    ? escapeHTML(
                          formatDate(item.date, {
                              day: "numeric",
                              month: "short",
                          }),
                      )
                    : "—") +
                "</td><td>" +
                escapeHTML(item.paidBy || "—") +
                '</td><td class="amount">' +
                escapeHTML(formatMoney(item.amount)) +
                '</td><td><div class="table-actions"><button class="small-icon" type="button" data-action="edit-expense" data-id="' +
                escapeHTML(item.id) +
                '" aria-label="Editar gasto">✎</button><button class="small-icon" type="button" data-action="delete-expense" data-id="' +
                escapeHTML(item.id) +
                '" aria-label="Eliminar gasto">×</button></div></td></tr>'
            );
        })
        .join("");
    renderHTML(
        node,
        '<div class="table-wrap"><table><thead><tr><th>Concepto</th><th>Fecha</th><th>Pagó</th><th>Valor</th><th></th></tr></thead><tbody>' +
            rows +
            '</tbody></table></div><div class="total-row"><span>Total registrado</span><span>' +
            escapeHTML(formatMoney(totalExpenses())) +
            "</span></div>",
    );
}
function renderReservations() {
    const node = document.querySelector("#reservations-list");
    if (!state.reservations.length) {
        renderHTML(
            node,
            emptyState(
                "No hay reservas guardadas",
                "Guarden aquí los datos que normalmente terminan repartidos entre correos y capturas.",
                "add-reservation",
                "+ Añadir primera reserva",
            ),
        );
        return;
    }
    renderHTML(
        node,
        state.reservations
            .slice()
            .sort(function (a, b) {
                return (a.date || "9999").localeCompare(b.date || "9999");
            })
            .map(function (item) {
                const icons = {
                    Vuelo: "✈",
                    Hotel: "⌂",
                    Tren: "▰",
                    Restaurante: "◉",
                    Otro: "◇",
                };
                return (
                    '<div class="reservation"><div class="reservation-icon">' +
                    (icons[item.type] || "◇") +
                    '</div><div class="reservation-main"><div class="item-title">' +
                    escapeHTML(item.title) +
                    '</div><div class="item-meta">' +
                    escapeHTML(item.type || "Otro") +
                    (item.date
                        ? " · " + escapeHTML(formatDate(item.date))
                        : "") +
                    (item.detail ? " · " + escapeHTML(item.detail) : "") +
                    '</div></div><span class="pill status">' +
                    escapeHTML(item.status || "Pendiente") +
                    '</span><div class="reservation-actions"><button class="small-icon" type="button" data-action="edit-reservation" data-id="' +
                    escapeHTML(item.id) +
                    '" aria-label="Editar reserva">✎</button><button class="small-icon" type="button" data-action="delete-reservation" data-id="' +
                    escapeHTML(item.id) +
                    '" aria-label="Eliminar reserva">×</button></div></div>'
                );
            })
            .join(""),
    );
}
function taskHTML(item) {
    return (
        '<div class="task ' +
        (item.done ? "done" : "") +
        '"><label><input type="checkbox" data-action="toggle-task" data-id="' +
        escapeHTML(item.id) +
        '" ' +
        (item.done ? "checked" : "") +
        '><span><span class="item-title">' +
        escapeHTML(item.title) +
        "</span>" +
        (item.assignee
            ? '<span class="item-meta" style="display:block">' +
              escapeHTML(item.assignee) +
              "</span>"
            : "") +
        '</span></label><button class="small-icon" type="button" data-action="delete-task" data-id="' +
        escapeHTML(item.id) +
        '" aria-label="Eliminar pendiente">×</button></div>'
    );
}
function renderTasks() {
    const node = document.querySelector("#tasks-list");
    renderHTML(
        node,
        state.tasks.length
            ? state.tasks.map(taskHTML).join("")
            : emptyState(
                  "No hay pendientes",
                  "Añadan documentación, equipaje, reservas o cualquier tarea previa al viaje.",
                  "add-task",
                  "+ Añadir pendiente",
              ),
    );
}

const dialog = document.querySelector("#entry-dialog");
function openEntry(type, id) {
    const titles = {
        trip: "Editar datos del viaje",
        destination: id ? "Editar destino" : "Añadir destino",
        activity: id ? "Editar actividad" : "Añadir actividad",
        expense: id ? "Editar gasto" : "Registrar gasto",
        reservation: id ? "Editar reserva" : "Añadir reserva",
        task: id ? "Editar pendiente" : "Añadir pendiente",
    };
    document.querySelector("#dialog-title").textContent = titles[type];
    dialog.dataset.type = type;
    dialog.dataset.id = id || "";
    const existing = id
        ? state[
              type === "trip"
                  ? "trip"
                  : type === "destination"
                    ? "destinations"
                    : type === "activity"
                      ? "itinerary"
                      : type === "expense"
                        ? "expenses"
                        : type === "reservation"
                          ? "reservations"
                          : "tasks"
          ].find(function (item) {
              return item.id === id;
          })
        : null;
    renderHTML(
        document.querySelector("#dialog-fields"),
        fieldsFor(type, existing || (type === "trip" ? state.trip : {})),
    );
    dialog.showModal();
    const first = dialog.querySelector("input, select, textarea");
    if (first)
        setTimeout(function () {
            first.focus();
        }, 20);
}
function optionList(items, selected) {
    return items
        .map(function (item) {
            return (
                '<option value="' +
                escapeHTML(item) +
                '" ' +
                (item === selected ? "selected" : "") +
                ">" +
                escapeHTML(item) +
                "</option>"
            );
        })
        .join("");
}
function fieldsFor(type, item) {
    if (type === "trip")
        return (
            '<div class="form-grid"><div class="field full"><label for="f-name">Nombre del viaje</label><input id="f-name" name="name" required value="' +
            escapeHTML(item.name || "") +
            '" placeholder="Ej. Italia y Grecia"></div><div class="field"><label for="f-start">Fecha de inicio</label><input id="f-start" name="startDate" type="date" value="' +
            escapeHTML(item.startDate || "") +
            '"></div><div class="field"><label for="f-end">Fecha de finalización</label><input id="f-end" name="endDate" type="date" value="' +
            escapeHTML(item.endDate || "") +
            '"></div><div class="field"><label for="f-budget">Presupuesto</label><input id="f-budget" name="budget" type="number" min="0" step="1" value="' +
            Number(item.budget || 0) +
            '"></div><div class="field"><label for="f-currency">Moneda</label><select id="f-currency" name="currency">' +
            optionList(["EUR", "COP", "USD", "GBP"], item.currency || "EUR") +
            '</select></div><div class="field"><label for="f-traveler-1">Primer nombre</label><input id="f-traveler-1" name="traveler1" value="' +
            escapeHTML((item.travelers || [])[0] || "") +
            '" placeholder="Ej. Luis"></div><div class="field"><label for="f-traveler-2">Segundo nombre</label><input id="f-traveler-2" name="traveler2" value="' +
            escapeHTML((item.travelers || [])[1] || "") +
            '" placeholder="Ej. Aura"></div></div>'
        );
    if (type === "destination")
        return (
            '<div class="form-grid"><div class="field full"><label for="f-name">Ciudad o destino</label><input id="f-name" name="name" required value="' +
            escapeHTML(item.name || "") +
            '" placeholder="Ej. Roma"></div><div class="field"><label for="f-country">País</label><input id="f-country" name="country" value="' +
            escapeHTML(item.country || "") +
            '" placeholder="Ej. Italia"></div><div class="field"><label for="f-from">Llegada</label><input id="f-from" name="from" type="date" value="' +
            escapeHTML(item.from || "") +
            '"></div><div class="field"><label for="f-to">Salida</label><input id="f-to" name="to" type="date" value="' +
            escapeHTML(item.to || "") +
            '"></div><div class="field full"><label for="f-notes">Notas</label><textarea id="f-notes" name="notes" placeholder="Qué quieren hacer allí...">' +
            escapeHTML(item.notes || "") +
            "</textarea></div></div>"
        );
    if (type === "activity")
        return (
            '<div class="form-grid"><div class="field full"><label for="f-title">Actividad</label><input id="f-title" name="title" required value="' +
            escapeHTML(item.title || "") +
            '" placeholder="Ej. Visitar el Coliseo"></div><div class="field"><label for="f-date">Fecha</label><input id="f-date" name="date" type="date" value="' +
            escapeHTML(item.date || "") +
            '"></div><div class="field"><label for="f-time">Hora</label><input id="f-time" name="time" type="time" value="' +
            escapeHTML(item.time || "") +
            '"></div><div class="field"><label for="f-location">Ubicación</label><input id="f-location" name="location" value="' +
            escapeHTML(item.location || "") +
            '" placeholder="Ej. Piazza Navona"></div><div class="field"><label for="f-category">Tipo</label><select id="f-category" name="category">' +
            optionList(
                ["Plan", "Reserva", "Comida", "Transporte", "Descanso"],
                item.category || "Plan",
            ) +
            '</select></div><div class="field"><label for="f-destination">Destino</label><select id="f-destination" name="destinationId"><option value="">Sin asignar</option>' +
            state.destinations
                .map(function (destination) {
                    return (
                        '<option value="' +
                        escapeHTML(destination.id) +
                        '" ' +
                        (destination.id === item.destinationId
                            ? "selected"
                            : "") +
                        ">" +
                        escapeHTML(destination.name) +
                        "</option>"
                    );
                })
                .join("") +
            '</select></div><div class="field full"><label for="f-notes">Notas</label><textarea id="f-notes" name="notes" placeholder="Entradas, dirección, ideas...">' +
            escapeHTML(item.notes || "") +
            "</textarea></div></div>"
        );
    if (type === "expense")
        return (
            '<div class="form-grid"><div class="field full"><label for="f-description">Concepto</label><input id="f-description" name="description" required value="' +
            escapeHTML(item.description || "") +
            '" placeholder="Ej. Hotel en París"></div><div class="field"><label for="f-amount">Valor</label><input id="f-amount" name="amount" type="number" min="0" step="0.01" required value="' +
            Number(item.amount || 0) +
            '"></div><div class="field"><label for="f-date">Fecha</label><input id="f-date" name="date" type="date" value="' +
            escapeHTML(item.date || "") +
            '"></div><div class="field"><label for="f-paidby">Pagó</label><select id="f-paidby" name="paidBy">' +
            optionList(
                (state.trip.travelers || []).filter(Boolean).length
                    ? state.trip.travelers.filter(Boolean)
                    : ["Luis", "Aura"],
                item.paidBy || "",
            ) +
            '</select></div><div class="field"><label for="f-category">Categoría</label><select id="f-category" name="category">' +
            optionList(
                [
                    "Alojamiento",
                    "Transporte",
                    "Comida",
                    "Entradas",
                    "Compras",
                    "Otro",
                ],
                item.category || "Otro",
            ) +
            "</select></div></div>"
        );
    if (type === "reservation")
        return (
            '<div class="form-grid"><div class="field full"><label for="f-title">Nombre o proveedor</label><input id="f-title" name="title" required value="' +
            escapeHTML(item.title || "") +
            '" placeholder="Ej. Hotel Aurora"></div><div class="field"><label for="f-type">Tipo</label><select id="f-type" name="type">' +
            optionList(
                ["Vuelo", "Hotel", "Tren", "Restaurante", "Otro"],
                item.type || "Otro",
            ) +
            '</select></div><div class="field"><label for="f-date">Fecha</label><input id="f-date" name="date" type="date" value="' +
            escapeHTML(item.date || "") +
            '"></div><div class="field"><label for="f-status">Estado</label><select id="f-status" name="status">' +
            optionList(
                ["Pendiente", "Confirmada", "Pagada"],
                item.status || "Pendiente",
            ) +
            '</select></div><div class="field"><label for="f-detail">Código, enlace o dato clave</label><input id="f-detail" name="detail" value="' +
            escapeHTML(item.detail || "") +
            '" placeholder="Localizador o URL"></div></div>'
        );
    return (
        '<div class="form-grid"><div class="field full"><label for="f-title">Pendiente</label><input id="f-title" name="title" required value="' +
        escapeHTML(item.title || "") +
        '" placeholder="Ej. Revisar pasaportes"></div><div class="field"><label for="f-assignee">Responsable</label><select id="f-assignee" name="assignee"><option value="">Cualquiera</option>' +
        optionList(
            (state.trip.travelers || []).filter(Boolean),
            item.assignee || "",
        ) +
        "</select></div></div>"
    );
}

function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
}
function saveEntry(type, id, values) {
    if (type === "trip") {
        state.trip = {
            ...state.trip,
            name: values.name,
            startDate: values.startDate,
            endDate: values.endDate,
            budget: Number(values.budget || 0),
            currency: values.currency || "EUR",
            travelers: [values.traveler1, values.traveler2].filter(Boolean),
        };
        return;
    }
    const config = {
        destination: [
            "destinations",
            {
                name: values.name,
                country: values.country,
                from: values.from,
                to: values.to,
                notes: values.notes,
            },
        ],
        activity: [
            "itinerary",
            {
                title: values.title,
                date: values.date,
                time: values.time,
                location: values.location,
                category: values.category,
                destinationId: values.destinationId,
                notes: values.notes,
            },
        ],
        expense: [
            "expenses",
            {
                description: values.description,
                amount: Number(values.amount || 0),
                date: values.date,
                paidBy: values.paidBy,
                category: values.category,
            },
        ],
        reservation: [
            "reservations",
            {
                title: values.title,
                type: values.type,
                date: values.date,
                status: values.status,
                detail: values.detail,
            },
        ],
        task: [
            "tasks",
            { title: values.title, assignee: values.assignee, done: false },
        ],
    }[type];
    const collection = state[config[0]];
    const record = id
        ? collection.find(function (item) {
              return item.id === id;
          })
        : null;
    if (record) Object.assign(record, config[1]);
    else
        collection.push({
            id: uid(type),
            createdAt: new Date().toISOString(),
            ...config[1],
        });
}

document.addEventListener("click", function (event) {
    const target = event.target.closest("[data-action], [data-tab]");
    if (!target) return;
    const action = target.dataset.action;
    if (target.dataset.tab) {
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.classList.toggle("active", tab === target);
        });
        document.querySelectorAll(".panel").forEach(function (panel) {
            panel.classList.toggle(
                "active",
                panel.id === "panel-" + target.dataset.tab,
            );
        });
        return;
    }
    if (action === "edit-trip") openEntry("trip");
    if (action === "activate") activateWithInvite();
    if (action === "add-destination") openEntry("destination");
    if (action === "edit-destination")
        openEntry("destination", target.dataset.id);
    if (
        action === "delete-destination" &&
        confirm(
            "¿Eliminar este destino? Las actividades asociadas quedarán sin destino.",
        )
    ) {
        state.destinations = state.destinations.filter(function (item) {
            return item.id !== target.dataset.id;
        });
        state.itinerary.forEach(function (item) {
            if (item.destinationId === target.dataset.id) item.destinationId = "";
        });
        saveState();
        render();
        showToast("Destino eliminado");
    }
    if (action === "add-activity") openEntry("activity");
    if (action === "edit-activity") openEntry("activity", target.dataset.id);
    if (action === "delete-activity" && confirm("¿Eliminar esta actividad?")) {
        state.itinerary = state.itinerary.filter(function (item) {
            return item.id !== target.dataset.id;
        });
        saveState();
        render();
        showToast("Actividad eliminada");
    }
    if (action === "add-expense") openEntry("expense");
    if (action === "edit-expense") openEntry("expense", target.dataset.id);
    if (action === "delete-expense" && confirm("¿Eliminar este gasto?")) {
        state.expenses = state.expenses.filter(function (item) {
            return item.id !== target.dataset.id;
        });
        saveState();
        render();
        showToast("Gasto eliminado");
    }
    if (action === "add-reservation") openEntry("reservation");
    if (action === "edit-reservation")
        openEntry("reservation", target.dataset.id);
    if (action === "delete-reservation" && confirm("¿Eliminar esta reserva?")) {
        state.reservations = state.reservations.filter(function (item) {
            return item.id !== target.dataset.id;
        });
        saveState();
        render();
        showToast("Reserva eliminada");
    }
    if (action === "add-task") openEntry("task");
    if (action === "delete-task" && confirm("¿Eliminar este pendiente?")) {
        state.tasks = state.tasks.filter(function (item) {
            return item.id !== target.dataset.id;
        });
        saveState();
        render();
        showToast("Pendiente eliminado");
    }
    if (action === "close-dialog") dialog.close();
    if (action === "export") exportState();
    if (action === "import") document.querySelector("#import-file").click();
    if (
        action === "reset" &&
        confirm("Se borrará el viaje guardado en este navegador. ¿Continuar?")
    ) {
        state = clone(DEFAULT_STATE);
        stateRevision += 1;
        sessionState.dirty = false;
        localStorage.removeItem(DIRTY_STORAGE_NAME);
        detachRemotePersistence();
        localStorage.removeItem(STORAGE_NAME);
        setSyncStatus("Solo este navegador", "local");
        render();
        showToast("Viaje reiniciado");
    }
});
document.addEventListener("change", function (event) {
    const target = event.target.closest('[data-action="toggle-task"]');
    if (!target) return;
    const task = state.tasks.find(function (item) {
        return item.id === target.dataset.id;
    });
    if (task) {
        task.done = target.checked;
        saveState();
        render();
    }
});
document
    .querySelector("#entry-form")
    .addEventListener("submit", function (event) {
        event.preventDefault();
        const type = dialog.dataset.type;
        saveEntry(type, dialog.dataset.id, formValues(event.currentTarget));
        saveState();
        render();
        dialog.close();
        showToast(
            type === "trip"
                ? "Datos del viaje guardados"
                : "Guardado correctamente",
        );
    });
document
    .querySelector("#import-file")
    .addEventListener("change", function (event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const imported = JSON.parse(reader.result);
                if (!isValidState(imported)) throw new Error("Formato");
                state = normalizeState(imported);
                saveState();
                render();
                showToast("Viaje importado correctamente");
            } catch (error) {
                alert("No se pudo importar este archivo.");
            }
            event.target.value = "";
        };
        reader.readAsText(file);
    });
function exportState() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "viaje-europa.json";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Copia de seguridad descargada");
}
render();
bootstrapRemoteState();
