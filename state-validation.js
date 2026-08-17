const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
    return typeof value === "string";
}

function isDate(value, optional = true) {
    if (optional && value === "") return true;
    if (!isString(value)) return false;
    const match = DATE_PATTERN.exec(value);
    if (!match) return false;
    const date = new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    return (
        date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() === Number(match[2]) - 1 &&
        date.getUTCDate() === Number(match[3])
    );
}

function isCreatedAt(value) {
    return isString(value) && Number.isFinite(Date.parse(value));
}

function hasRecordBase(value) {
    return (
        isObject(value) &&
        ID_PATTERN.test(value.id) &&
        isCreatedAt(value.createdAt)
    );
}

function allStrings(values) {
    return Array.isArray(values) && values.every(isString);
}

export function isValidState(state) {
    if (
        !isObject(state) ||
        !isObject(state.trip) ||
        !Array.isArray(state.destinations) ||
        !Array.isArray(state.itinerary) ||
        !Array.isArray(state.expenses) ||
        !Array.isArray(state.reservations) ||
        !Array.isArray(state.tasks)
    )
        return false;

    const trip = state.trip;
    if (
        !isString(trip.name) ||
        !isDate(trip.startDate) ||
        !isDate(trip.endDate) ||
        !["EUR", "COP", "USD", "GBP"].includes(trip.currency) ||
        !Number.isFinite(trip.budget) ||
        trip.budget < 0 ||
        !allStrings(trip.travelers)
    )
        return false;

    const destinationIds = new Set();
    for (const item of state.destinations) {
        if (
            !hasRecordBase(item) ||
            destinationIds.has(item.id) ||
            !isString(item.name) ||
            !isString(item.country) ||
            !isDate(item.from) ||
            !isDate(item.to) ||
            !isString(item.notes)
        )
            return false;
        destinationIds.add(item.id);
    }

    const recordIds = new Set(destinationIds);
    const addUniqueId = (item) => {
        if (!hasRecordBase(item) || recordIds.has(item.id)) return false;
        recordIds.add(item.id);
        return true;
    };

    for (const item of state.itinerary) {
        if (
            !addUniqueId(item) ||
            !isString(item.title) ||
            !isDate(item.date) ||
            !isString(item.time) ||
            (item.time && !TIME_PATTERN.test(item.time)) ||
            !isString(item.location) ||
            !isString(item.category) ||
            !isString(item.destinationId) ||
            (item.destinationId && !destinationIds.has(item.destinationId)) ||
            !isString(item.notes)
        )
            return false;
    }

    for (const item of state.expenses) {
        if (
            !addUniqueId(item) ||
            !isString(item.description) ||
            !Number.isFinite(item.amount) ||
            item.amount < 0 ||
            !isDate(item.date) ||
            !isString(item.paidBy) ||
            !isString(item.category)
        )
            return false;
    }

    for (const item of state.reservations) {
        if (
            !addUniqueId(item) ||
            !isString(item.title) ||
            !isString(item.type) ||
            !isDate(item.date) ||
            !isString(item.status) ||
            !isString(item.detail)
        )
            return false;
    }

    for (const item of state.tasks) {
        if (
            !addUniqueId(item) ||
            !isString(item.title) ||
            !isString(item.assignee) ||
            typeof item.done !== "boolean"
        )
            return false;
    }

    return true;
}

export function escapeHTML(value) {
    return String(value ?? "").replace(
        /[&<>'"]/g,
        (char) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "'": "&#039;",
                '"': "&quot;",
            })[char],
    );
}
